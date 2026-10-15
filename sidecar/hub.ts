import type { ServerEvent } from "../shared/protocol";

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
    } catch {}
  }
}

export function clientCount() {
  return listeners.size;
}
