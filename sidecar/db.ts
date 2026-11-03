// The store: one SQLite database for settings, providers, sessions and their messages, usage and paired
// devices. Callers use it as one namespace (`import * as store from "./db"`); each domain lives in db/.
import { connect } from "./db/connection";
import { recoverQuestions } from "./db/questions";
import { mergeBashDefaults } from "./db/settings";

export { db, dbPath } from "./db/connection";
export { DEFAULT_SETTINGS, getSettings, saveSettings, listMcpServers, upsertMcpServer, deleteMcpServer } from "./db/settings";
export { listProviders, getProvider, upsertProvider, deleteProvider, listModels, getModel, upsertModel, backfillModels, deleteModel } from "./db/providers";
export { listSessions, getSession, insertSession, updateSession, addSessionUsage, setContextTokens, deleteSession } from "./db/sessions";
export { loadMessages, appendMessage, truncateMessages, copyMessages, rewriteSessionPathPrefix, listCompactions, addCompaction, searchMessages } from "./db/messages";
export { recordUsage, recordToolEvent, usageSummary } from "./db/usage";
export { listDevices, addDevice, deviceByTokenHash, touchDevice, deleteDevice, deleteAllDevices, type DeviceRow } from "./db/devices";

export function openDb(dataDir: string, dev: boolean) {
  connect(dataDir, dev);
  mergeBashDefaults();
  recoverQuestions();
}
