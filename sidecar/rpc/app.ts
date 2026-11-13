// The app itself: info, settings, history indexing, media conversion, usage and the default allowlist.
import { spawnSync } from "node:child_process";
import * as store from "../db";
import { expandHome, which } from "../env";
import { memoryConfigured } from "../memory-config";
import { cancelMemoryWork, memoryConfigKey, prepareMemory } from "../memory-retrieval";
import { drainMemoryJobs } from "../memory-jobs";
import { DEFAULT_BASH_WHITELIST } from "../permissions";
import { historyStatus, rebuildHistory, setHistorySources, syncHistory } from "../history";
import { convertImage, mediaStatus } from "../media";
import type { Handler } from "./types";
import { appInfo } from "../app-info";
import { logger, setVerbosity } from "../log";

const log = logger("settings");

export const appHandlers: Record<string, Handler> = {
  "app.info": () => ({ ...appInfo(), ripgrep: !!which("rg") }),
  "app.open": ({ path: p, reveal }: { path: string; reveal?: boolean }) => {
    const target = expandHome(p);
    spawnSync("open", reveal ? ["-R", target] : [target]);
    return true;
  },
  "settings.get": () => store.getSettings(),
  "settings.update": (patch) => {
    const previousMemory = memoryConfigKey(store.getSettings());
    const s = store.saveSettings(patch);
    // Names only: values can be keys or long prompts.
    log.info("settings changed", { keys: Object.keys(patch) });
    if ("logLevel" in patch) setVerbosity(s.logLevel);
    if (previousMemory !== memoryConfigKey(s)) cancelMemoryWork();
    if (Object.keys(patch).some((k) => k.startsWith("memory"))) {
      if (s.memoryEnabled && memoryConfigured(s)) void prepareMemory(s).then(() => drainMemoryJobs()).catch((e) => log.warn("memory could not be prepared", e));
    }
    if ("historySources" in patch) {
      setHistorySources(s.historySources);
      syncHistory().catch((e) => log.warn("history sync failed", e));
    }
    return s;
  },
  "history.status": () => historyStatus(),
  "history.rebuild": () => {
    rebuildHistory().catch((e) => log.warn("history rebuild failed", e));
    return true;
  },
  "media.status": () => mediaStatus(),
  "media.image": ({ data, name }: { data: string; name?: string }) => convertImage(data, name),
  "permissions.defaults": () => ({ bashWhitelist: DEFAULT_BASH_WHITELIST }),
  "usage.summary": ({ days }) => store.usageSummary(days ?? 30),
};
