// Updates: the status anyone may read (the phone shows whether its own app is behind), and checking,
// which only the Mac itself may start. Installing is the app shell's job (install_update in Tauri).
import { checkForUpdate, updateStatus } from "../update/updater";
import type { Handler } from "./types";

export const updateHandlers: Record<string, Handler> = {
  "update.status": () => updateStatus(),
  "update.check": () => checkForUpdate(),
};
