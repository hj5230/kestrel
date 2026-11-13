// Model warmup and indexing survive an individual caller's cancellation, but settings changes revoke all work.
// Sharing these operations prevents concurrent requests from repeatedly loading or indexing the same model.
import { logger } from "./log";

export class SharedMemoryWork {
  private tasks = new Map<string, { promise: Promise<void>; controller: AbortController }>();

  get active() { return this.tasks.size; }

  run(key: string, task: (signal: AbortSignal) => Promise<void>, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    let work = this.tasks.get(key);
    if (!work) {
      const controller = new AbortController();
      const promise = Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return task(controller.signal);
      }).finally(() => {
        if (this.tasks.get(key)?.promise === promise) this.tasks.delete(key);
      });
      // The shared task may finish after its last caller stops waiting.
      void promise.catch((e) => { if (!controller.signal.aborted) logger("memory").debug("shared memory task failed", { key, error: e }); });
      work = { promise, controller };
      this.tasks.set(key, work);
    }
    return this.waitFor(work.promise, signal);
  }

  wait(key: string, signal?: AbortSignal): Promise<void> {
    return this.waitFor(this.tasks.get(key)?.promise ?? Promise.resolve(), signal);
  }

  cancel() {
    for (const work of this.tasks.values()) work.controller.abort(new Error("Memory configuration changed"));
    this.tasks.clear();
  }

  private waitFor(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(signal.reason);
    let abort: () => void;
    const stopped = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    });
    return Promise.race([promise, stopped]).finally(() => signal.removeEventListener("abort", abort));
  }
}
