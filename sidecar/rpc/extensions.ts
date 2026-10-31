// What extends the agent: MCP servers, skills, slash commands and memory.
import type { McpServerConfig } from "../../shared/protocol";
import * as store from "../db";
import { expandHome } from "../env";
import { emit } from "../hub";
import { st } from "../i18n";
import { mcpStatuses, removeMcp, restartMcp } from "../mcp";
import { memoryConfigured, validateMemoryEndpoint } from "../memory-config";
import { memoryConfigKey, testMemoryModels, memoryStatus, prepareMemory, resetMemoryIndex } from "../memory-retrieval";
import { memoryJobCounts, retryMemoryJobs } from "../memory-jobs";
import { deleteMemory, getMemory, listMemories, writeMemory, type MemoryInput } from "../memory";
import { newId } from "../sessions";
import { discoverSkills, listSlashCommands } from "../skills";
import type { Handler } from "./types";

export const extensionHandlers: Record<string, Handler> = {
  "mcp.list": () => ({ configs: store.listMcpServers(), statuses: mcpStatuses() }),
  "mcp.upsert": async (cfg: McpServerConfig) => {
    const next = { ...cfg, id: cfg.id || newId("m_") };
    store.upsertMcpServer(next);
    await restartMcp(next.id);
    return next;
  },
  "mcp.delete": async ({ id }) => {
    store.deleteMcpServer(id);
    await removeMcp(id);
    return true;
  },
  "mcp.restart": async ({ id }) => {
    await restartMcp(id);
    return true;
  },
  "mcp.import": async ({ json }: { json: string }) => {
    const parsed = JSON.parse(json);
    const servers = parsed.mcpServers ?? parsed.servers ?? parsed;
    const existing = new Map(store.listMcpServers().map((s) => [s.name, s]));
    let count = 0;
    for (const [name, v] of Object.entries<any>(servers)) {
      const transport = v.url ? (v.type === "sse" || v.transport === "sse" ? "sse" : "http") : "stdio";
      const cfg: McpServerConfig = {
        id: existing.get(name)?.id ?? newId("m_"),
        name,
        transport,
        command: v.command ?? "",
        args: v.args ?? [],
        env: v.env ?? {},
        url: v.url ?? "",
        headers: v.headers ?? {},
        enabled: v.disabled ? false : true,
      };
      store.upsertMcpServer(cfg);
      await restartMcp(cfg.id);
      count++;
    }
    return count;
  },
  "skills.list": ({ cwd }) => discoverSkills(expandHome(cwd || store.getSettings().defaultCwd), true),
  "commands.list": ({ cwd }) => listSlashCommands(expandHome(cwd || store.getSettings().defaultCwd)),
  "memory.status": () => ({ ...memoryStatus(store.getSettings()), ...memoryJobCounts() }),
  "memory.test": async ({ embedding, reranker }) => {
    const s = { ...store.getSettings(), memoryEnabled: true, memoryEmbedding: validateMemoryEndpoint(embedding, true), memoryReranker: validateMemoryEndpoint(reranker, false) };
    if (!memoryConfigured(s)) throw new Error(st("memoryUnconfigured"));
    await testMemoryModels(s);
    // A successful test of the saved configuration also clears a previous startup failure.
    if (store.getSettings().memoryEnabled && memoryConfigKey(s) === memoryConfigKey(store.getSettings())) await prepareMemory(s);
    return true;
  },
  "memory.rebuild": async () => {
    resetMemoryIndex();
    await prepareMemory(store.getSettings());
    return { ...memoryStatus(store.getSettings()), ...memoryJobCounts() };
  },
  "memory.retry": () => { retryMemoryJobs(); return true; },
  "memory.list": () => listMemories(),
  "memory.get": ({ id }: { id: string }) => {
    const m = getMemory(id);
    if (!m) throw new Error(`No memory ${id}`);
    return m;
  },
  "memory.save": ({ input, from, revision }: { input: MemoryInput; from?: string; revision?: string }) => {
    const { entry } = writeMemory(input, { from, expectedRevision: revision });
    emit({ type: "memory_changed" });
    const s = store.getSettings();
    if (s.memoryEnabled && memoryConfigured(s)) void prepareMemory(s).catch(() => {});
    return entry;
  },
  "memory.delete": ({ id }: { id: string }) => {
    deleteMemory(id);
    emit({ type: "memory_changed" });
    return true;
  },
};
