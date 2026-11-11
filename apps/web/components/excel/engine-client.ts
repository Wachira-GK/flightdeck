import type {
  CellValue,
  ExerciseDefinition,
  ExerciseKey,
  Limits,
  Submission,
  ValidationResult,
} from "@flightdeck/excel-engine";
import { BOOT_TIMEOUT_MS, HARD_TIMEOUT_MS, type WorkerRequest, type WorkerResponse } from "./protocol";

/** The subset of the Worker API the client needs (lets tests inject a fake). */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export class EngineTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The calculation took longer than ${timeoutMs} ms and was stopped`);
    this.name = "EngineTimeoutError";
  }
}

/** The Worker never reported "ready" (blocked, offline, or too slow to download). Callers may fall back. */
export class EngineBootError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The calculation engine did not start within ${timeoutMs} ms`);
    this.name = "EngineBootError";
  }
}

export class EngineCrashError extends Error {
  constructor(message = "The calculation engine stopped unexpectedly") {
    super(message);
    this.name = "EngineCrashError";
  }
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface EngineClientOptions {
  createWorker: () => WorkerLike;
  /** Per-calculation limit, capped at the 500 ms hard timeout. Starts only once the Worker is ready. */
  timeoutMs?: number;
  /** Start-up allowance for the Worker (download + parse). Default 15 s. */
  bootTimeoutMs?: number;
  timers?: Timers;
}

export interface EngineClient {
  evaluate(cells: Record<string, string>, limits: Partial<Limits>): Promise<Record<string, CellValue>>;
  validate(exercise: ExerciseDefinition, submission: Submission, key?: ExerciseKey): Promise<ValidationResult>;
  /** Number of Workers started so far (a new one replaces a terminated one). */
  readonly workersStarted: number;
  dispose(): void;
}

/** Omit that distributes over a union (plain Omit collapses unions to their common keys). */
type RequestBody = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, "id"> : never) : never;

interface Pending {
  resolve(r: WorkerResponse): void;
  reject(e: Error): void;
  timer: unknown;
  /** Message waiting for the Worker to become ready. */
  queued?: WorkerRequest;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Main-thread wrapper around the engine Worker. A new Worker first gets a start-up allowance
 * (bootTimeoutMs); requests sent meanwhile are queued. Once it reports "ready", every request has the
 * hard calculation timeout: if it expires, the Worker is terminated (stopping any runaway calculation),
 * all pending requests reject, and a fresh Worker is started lazily on the next request.
 */
export function createEngineClient(options: EngineClientOptions): EngineClient {
  const timeoutMs = Math.min(options.timeoutMs ?? HARD_TIMEOUT_MS, HARD_TIMEOUT_MS);
  const bootTimeoutMs = options.bootTimeoutMs ?? BOOT_TIMEOUT_MS;
  const timers = options.timers ?? defaultTimers;
  let worker: WorkerLike | null = null;
  let ready = false;
  let bootTimer: unknown = null;
  let started = 0;
  let nextId = 1;
  let disposed = false;
  const pending = new Map<number, Pending>();

  function kill(error: Error) {
    if (bootTimer !== null) {
      timers.clear(bootTimer);
      bootTimer = null;
    }
    ready = false;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      worker = null;
    }
    for (const p of pending.values()) {
      timers.clear(p.timer);
      p.reject(error);
    }
    pending.clear();
  }

  function ensureWorker(): WorkerLike {
    if (worker) return worker;
    const w = options.createWorker();
    started++;
    ready = false;
    w.onmessage = (event) => {
      const res = event.data;
      if (res.type === "ready") {
        if (worker !== w || ready) return;
        ready = true;
        if (bootTimer !== null) timers.clear(bootTimer);
        bootTimer = null;
        for (const [id, p] of pending) {
          if (!p.queued) continue;
          const msg = p.queued;
          delete p.queued;
          dispatch(w, id, p, msg);
        }
        return;
      }
      const p = pending.get(res.id);
      if (!p) return;
      pending.delete(res.id);
      timers.clear(p.timer);
      p.resolve(res);
    };
    w.onerror = () => kill(ready ? new EngineCrashError() : new EngineBootError(bootTimeoutMs));
    worker = w;
    bootTimer = timers.set(() => kill(new EngineBootError(bootTimeoutMs)), bootTimeoutMs);
    return w;
  }

  function dispatch(w: WorkerLike, id: number, p: Pending, msg: WorkerRequest) {
    p.timer = timers.set(() => kill(new EngineTimeoutError(timeoutMs)), timeoutMs);
    try {
      w.postMessage(msg);
    } catch (e) {
      pending.delete(id);
      timers.clear(p.timer);
      p.reject(e instanceof Error ? e : new EngineCrashError());
    }
  }

  function send(req: RequestBody): Promise<WorkerResponse> {
    if (disposed) return Promise.reject(new EngineCrashError("The calculation engine was closed"));
    const id = nextId++;
    return new Promise<WorkerResponse>((resolve, reject) => {
      const w = ensureWorker();
      const msg = { ...req, id } as WorkerRequest;
      const p: Pending = { resolve, reject, timer: null };
      pending.set(id, p);
      if (ready) dispatch(w, id, p, msg);
      else p.queued = msg;
    });
  }

  return {
    async evaluate(cells, limits) {
      const res = await send({ type: "evaluate", cells, limits });
      if (res.type === "evaluated") return res.values;
      throw new EngineCrashError(res.type === "error" ? res.message : "Unexpected engine response");
    },
    async validate(exercise, submission, key) {
      const res = await send({ type: "validate", exercise, submission, key });
      if (res.type === "validated") return res.result;
      throw new EngineCrashError(res.type === "error" ? res.message : "Unexpected engine response");
    },
    get workersStarted() {
      return started;
    },
    dispose() {
      disposed = true;
      kill(new EngineCrashError("The calculation engine was closed"));
    },
  };
}

/** Creates the real module Worker. Call only in the browser (e.g. inside useEffect). */
export function createBrowserEngineWorker(): WorkerLike {
  return new Worker(new URL("./engine.worker.ts", import.meta.url), {
    type: "module",
    name: "flightdeck-excel-engine",
  }) as unknown as WorkerLike;
}
