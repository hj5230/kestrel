import type { ServerEvent } from "../shared/protocol";
import { logger } from "./log";

type Listener = (e: ServerEvent) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(e: ServerEvent) {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch (err) {
      logger("hub").warn("an event listener threw", { event: e.type, error: err });
    }
  }
}

export function clientCount() {
  return listeners.size;
}
