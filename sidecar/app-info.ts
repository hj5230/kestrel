// What the running sidecar is: version, data folder, platform. Set once by startServer, read by the RPC handlers.
import type { AppInfo } from "../shared/protocol";

let info: AppInfo | null = null;

export function setAppInfo(next: AppInfo) {
  info = next;
}

export function appInfo(): AppInfo {
  if (!info) throw new Error("The server has not started");
  return info;
}
