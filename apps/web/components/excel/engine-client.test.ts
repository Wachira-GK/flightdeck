import { evaluateSheet, validateSubmission } from "@flightdeck/excel-engine";
import { describe, expect, it } from "vitest";
import exercise from "../../../../content/excel/exercises/sum-relative-refs.json";
import {
  createEngineClient,
  EngineCrashError,
  EngineTimeoutError,
  type Timers,
  type WorkerLike,
} from "./engine-client";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import type { ExerciseDefinition } from "@flightdeck/excel-engine";

/** In-process fake Worker that runs the real engine; `hang` simulates a runaway calculation. */
class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  hang = false;
  received: WorkerRequest[] = [];

  postMessage(msg: WorkerRequest): void {
    this.received.push(msg);
    if (this.hang) return;
    const res: WorkerResponse =
      msg.type === "evaluate"
        ? { id: msg.id, type: "evaluated", values: evaluateSheet(msg.cells, msg.limits) }
        : { id: msg.id, type: "validated", result: validateSubmission(msg.exercise, msg.submission, msg.key) };
    queueMicrotask(() => this.onmessage?.({ data: res }));
  }
  terminate(): void {
    this.terminated = true;
  }
}

/** Manual timers so timeouts are deterministic. */
function manualTimers() {
  let next = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  const timers: Timers = {
    set(fn, ms) {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clear(h) {
      pending.delete(h as number);
    },
  };
  return {
    timers,
    fireAll() {
      for (const [id, t] of [...pending]) {
        pending.delete(id);
        t.fn();
      }
    },
    lastMs: () => [...pending.values()].at(-1)?.ms,
    size: () => pending.size,
  };
}

describe("engine client", () => {
  it("evaluates through the worker and clears its timer", async () => {
    const workers: FakeWorker[] = [];
    const t = manualTimers();
    const client = createEngineClient({
      createWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w;
      },
      timers: t.timers,
    });
    const values = await client.evaluate({ A1: "2", A2: "=A1*21" }, {});
    expect(values.A2).toBe(42);
    expect(t.size()).toBe(0);
    expect(client.workersStarted).toBe(1);
  });

  it("caps the timeout at the 500 ms hard limit", () => {
    const t = manualTimers();
    const client = createEngineClient({ createWorker: () => Object.assign(new FakeWorker(), { hang: true }), timeoutMs: 5000, timers: t.timers });
    void client.evaluate({}, {}).catch(() => undefined);
    expect(t.lastMs()).toBe(500);
  });

  it("terminates a hung worker on timeout and recovers with a fresh one", async () => {
    const workers: FakeWorker[] = [];
    const t = manualTimers();
    const client = createEngineClient({
      createWorker: () => {
        const w = new FakeWorker();
        w.hang = workers.length === 0; // the first worker never answers
        workers.push(w);
        return w;
      },
      timers: t.timers,
    });
    const p = client.evaluate({ A1: "1" }, {});
    t.fireAll();
    await expect(p).rejects.toBeInstanceOf(EngineTimeoutError);
    expect(workers[0]!.terminated).toBe(true);

    const values = await client.evaluate({ A1: "1", B1: "=A1+1" }, {});
    expect(values.B1).toBe(2);
    expect(client.workersStarted).toBe(2);
  });

  it("rejects pending requests when the worker errors", async () => {
    let worker: FakeWorker | null = null;
    const client = createEngineClient({
      createWorker: () => (worker = Object.assign(new FakeWorker(), { hang: true })),
      timers: manualTimers().timers,
    });
    const p = client.evaluate({}, {});
    worker!.onerror?.(new Error("boom"));
    await expect(p).rejects.toBeInstanceOf(EngineCrashError);
  });

  it("runs the practice validation in the worker", async () => {
    const client = createEngineClient({ createWorker: () => new FakeWorker(), timers: manualTimers().timers });
    const ex = exercise as unknown as ExerciseDefinition;
    const result = await client.validate(ex, {
      exerciseId: ex.id,
      exerciseVersion: ex.version,
      cells: { B5: "=SUM(B2:B4)", C5: "=SUM(C2:C4)" },
    });
    expect(result.mode).toBe("structure-only");
    expect(result.passed).toBe(true);
  });

  it("rejects after dispose", async () => {
    const client = createEngineClient({ createWorker: () => new FakeWorker(), timers: manualTimers().timers });
    client.dispose();
    await expect(client.evaluate({}, {})).rejects.toBeInstanceOf(EngineCrashError);
  });
});
