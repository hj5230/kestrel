// App settings (one JSON row in meta) and the configured MCP servers.
import type { AppSettings, McpServerConfig } from "../../shared/protocol";
import { HOME } from "../env";
import { validateMemoryEndpoint } from "../memory-config";
import { BASH_WHITELIST_ADDED_V2, DEFAULT_BASH_WHITELIST } from "../permissions";
import { db, json } from "./connection";

export const DEFAULT_SETTINGS: AppSettings = {
  language: "en",
  theme: "system",
  accent: "neutral",
  defaultCwd: HOME,
  defaultProviderId: "",
  defaultModelId: "",
  defaultThinking: "medium",
  defaultPermissionMode: "auto",
  titleModel: "",
  compactModel: "",
  historySources: ["claude-code", "codex", "cursor"],
  autoCompact: true,
  compactThreshold: 0.8,
  keepRecentTokens: 24000,
  systemPromptAppend: "",
  instructionFiles: ["~/.kestrel/AGENTS.md", "~/.claude/CLAUDE.md"],
  loadProjectInstructions: true,
  skillDirs: ["~/.kestrel/skills", "~/.claude/skills", "~/.agents/skills"],
  disabledSkills: [],
  commandDirs: ["~/.kestrel/commands", "~/.claude/commands"],
  memoryEnabled: true,
  memoryAutoSave: true,
  memoryEmbedding: { api: "ollama", url: "", model: "", apiKey: "" },
  memoryReranker: { url: "", model: "", apiKey: "" },
  memoryMinScore: 0.1,
  proxyMode: "env",
  proxyUrl: "",
  tavilyApiKey: "",
  bashTimeoutSec: 120,
  ffmpegPath: "",
  bashWhitelist: DEFAULT_BASH_WHITELIST,
  toolWhitelist: [],
  autoModel: "",
  autoEnvironment: "",
  autoBlockRules: "",
  autoAllowRules: "",
  notifyOnFinish: true,
  sendKey: "enter",
  transcriptView: "compact",
  remoteEnabled: false,
  remotePort: 47830,
};

/** A saved allowlist is the user's own and stays as it is, except that entries added to the defaults later are
 *  merged in once. Entries the user removed from an earlier default list stay removed. */
export function mergeBashDefaults() {
  const done = db.query("SELECT value FROM meta WHERE key = 'bash_defaults_rev'").get() as { value: string } | null;
  if (Number(done?.value ?? 1) >= 2) return;
  const row = db.query("SELECT value FROM meta WHERE key = 'settings'").get() as { value: string } | null;
  const saved = json<Partial<AppSettings>>(row?.value, {});
  db.transaction(() => {
    if (Array.isArray(saved.bashWhitelist)) {
      const have = new Set(saved.bashWhitelist);
      saveSettings({ bashWhitelist: [...saved.bashWhitelist, ...BASH_WHITELIST_ADDED_V2.filter((e) => !have.has(e))] });
    }
    db.run("INSERT INTO meta (key, value) VALUES ('bash_defaults_rev', '2') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  })();
}

export const PERMISSION_MODES = new Set(["manual", "acceptEdits", "auto", "bypass"]);

export function getSettings(): AppSettings {
  const row = db.query("SELECT value FROM meta WHERE key = 'settings'").get() as { value: string } | null;
  const s = { ...DEFAULT_SETTINGS, ...json<Partial<AppSettings>>(row?.value, {}) };
  // "whitelist" was renamed to "auto" (the allowlist now feeds a smarter mode).
  if ((s.defaultPermissionMode as string) === "whitelist") s.defaultPermissionMode = "auto";
  if (!PERMISSION_MODES.has(s.defaultPermissionMode)) s.defaultPermissionMode = "auto";
  return s;
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch };
  if (patch.memoryEmbedding !== undefined) next.memoryEmbedding = validateMemoryEndpoint(patch.memoryEmbedding, true) as AppSettings["memoryEmbedding"];
  if (patch.memoryReranker !== undefined) next.memoryReranker = validateMemoryEndpoint(patch.memoryReranker);
  if (!Number.isFinite(next.memoryMinScore) || next.memoryMinScore < 0 || next.memoryMinScore > 1) throw new Error("Memory relevance threshold must be between 0 and 1");
  db.run("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
    JSON.stringify(next),
  ]);
  return next;
}

export const rowToMcp = (r: any): McpServerConfig => ({
  id: r.id,
  name: r.name,
  transport: r.transport,
  command: r.command,
  args: json(r.args, []),
  env: json(r.env, {}),
  url: r.url,
  headers: json(r.headers, {}),
  enabled: !!r.enabled,
});

export function listMcpServers(): McpServerConfig[] {
  return db.query("SELECT * FROM mcp_servers ORDER BY created_at").all().map(rowToMcp);
}

export function upsertMcpServer(s: McpServerConfig) {
  db.run(
    `INSERT INTO mcp_servers (id, name, transport, command, args, env, url, headers, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, transport = excluded.transport, command = excluded.command,
       args = excluded.args, env = excluded.env, url = excluded.url, headers = excluded.headers, enabled = excluded.enabled`,
    [s.id, s.name, s.transport, s.command, JSON.stringify(s.args), JSON.stringify(s.env), s.url, JSON.stringify(s.headers), s.enabled ? 1 : 0, Date.now()],
  );
}

export function deleteMcpServer(id: string) {
  db.run("DELETE FROM mcp_servers WHERE id = ?", [id]);
}
