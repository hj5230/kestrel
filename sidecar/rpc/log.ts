// Logging over RPC. The desktop window and the phone's own layer write through the Rust shell; this is for what has
// no shell of its own: a paired phone sending its records to the Mac, and the browser development build. The records
// go out on the sidecar's log channel, tagged with who sent them, and the shell files them.
import type { ClientLogRecord } from "../../shared/protocol";
import { ingest } from "../log";
import type { Handler } from "./types";

export const logHandlers: Record<string, Handler> = {
  "log.write": ({ records }: { records: ClientLogRecord[] }, caller) => {
    if (Array.isArray(records)) ingest(records, caller.remote ? "phone" : "ui");
    return true;
  },
};
