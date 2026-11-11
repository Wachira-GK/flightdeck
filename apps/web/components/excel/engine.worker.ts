/**
 * Excel engine Web Worker (trust boundary TB7). Runs formula evaluation and the practice check
 * off the main thread. The main thread terminates this Worker if a request exceeds the 500 ms
 * hard timeout.
 *
 * The engine itself never touches the network, storage or clipboard and never evaluates code.
 * As defence in depth, the network and storage globals are removed from this Worker scope before
 * any message is handled.
 */
import { evaluateSheet, validateSubmission } from "@flightdeck/excel-engine";
import type { WorkerRequest, WorkerResponse } from "./protocol";

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
}

const scope = self as unknown as WorkerScope;

const BLOCKED_GLOBALS = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "WebTransport",
  "EventSource",
  "BroadcastChannel",
  "indexedDB",
  "caches",
  "navigator",
];

for (const name of BLOCKED_GLOBALS) {
  try {
    Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false });
  } catch {
    // Some globals are non-configurable in some browsers; the engine never uses them anyway.
  }
}

scope.onmessage = (event) => {
  const msg = event.data;
  let response: WorkerResponse;
  try {
    if (msg.type === "evaluate") {
      response = { id: msg.id, type: "evaluated", values: evaluateSheet(msg.cells, msg.limits) };
    } else if (msg.type === "validate") {
      response = { id: msg.id, type: "validated", result: validateSubmission(msg.exercise, msg.submission, msg.key) };
    } else {
      response = { id: (msg as { id: number }).id, type: "error", message: "Unknown request" };
    }
  } catch (err) {
    response = { id: msg.id, type: "error", message: err instanceof Error ? err.message : "Engine error" };
  }
  scope.postMessage(response);
};

// Tell the main thread the engine is loaded, so its 500 ms per-calculation watchdog starts now.
scope.postMessage({ id: 0, type: "ready" });
