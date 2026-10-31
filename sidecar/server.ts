import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AppInfo, FileAttachment, McpServerConfig, ModelConfig, ProviderConfig, RemoteModel, SessionInfo } from "../shared/protocol";
import { dropRunner, getRunner, peekRunner, respondApproval, respondQuestion, sessionDetail } from "./agent/runner";
import { collectInstructions } from "./agent/prompt";
import * as store from "./db";
import { collapseHome, expandHome, HOME, SHELL, which } from "./env";
import { emit, subscribe } from "./hub";
import { st } from "./i18n";
import { mcpStatuses, removeMcp, restartMcp } from "./mcp";
import { memoryConfigured, validateMemoryEndpoint } from "./memory-config";
import { cancelMemoryWork, memoryConfigKey, testMemoryModels, memoryStatus, prepareMemory, resetMemoryIndex } from "./memory-retrieval";
import { drainMemoryJobs, memoryJobCounts, retryMemoryJobs } from "./memory-jobs";
import { deleteMemory, getMemory, listMemories, writeMemory, type MemoryInput } from "./memory";
import { DEFAULT_BASH_WHITELIST } from "./permissions";
import { sortEfforts } from "../shared/effort";
import { locksFor, lookupFacts } from "./catalog";
import { fetchRemoteModels, modelDefaults, PROVIDER_PRESETS } from "./providers";
import { createSession, exportMarkdown, forkSession, newId } from "./sessions";
import { mergeSession } from "./merge";
import { historyStatus, rebuildHistory, setHistorySources, syncHistory } from "./history";
import { discoverSkills, listSlashCommands } from "./skills";
import { describeLocalFiles, importLocalFile, removeSessionUploads, storeUpload, UploadError } from "./uploads";
import { convertImage, mediaStatus } from "./media";
import type { Server, WebSocketHandler } from "bun";
import { generateText } from "ai";
import { languageModel } from "./providers";

type Handler = (params: any, caller: Caller) => any;

const VERSION = "0.1.0";
let appInfo: AppInfo;

const fileCache = new Map<string, { at: number; files: string[] }>();

function listProjectFiles(cwd: string): string[] {
  const hit = fileCache.get(cwd);
  if (hit && Date.now() - hit.at < 15000) return hit.files;
  let files: string[] = [];
  const rg = which("rg");
  if (rg) {
    const r = spawnSync(rg, ["--files", "--hidden", "--glob", "!.git", "--max-depth", "12"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 5000 });
    files = (r.stdout || "").split("\n").filter(Boolean).slice(0, 50000);
  } else {
    const r = spawnSync("find", [".", "-type", "f", "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 5000 });
    files = (r.stdout || "").split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, "")).slice(0, 50000);
  }
  fileCache.set(cwd, { at: Date.now(), files });
  return files;
}

function fuzzyScore(target: string, query: string): number {
  const t = target.toLowerCase();
  const q = query.toLowerCase();
  const base = path.basename(t);
  if (base === q) return 1000;
  if (base.startsWith(q)) return 800 - base.length;
  const i = t.indexOf(q);
  if (i >= 0) return 600 - i - t.length * 0.1;
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    const j = t.indexOf(ch, ti);
    if (j < 0) return -1;
    score += j === ti ? 3 : 1;
    ti = j + 1;
  }
  return score - t.length * 0.05;
}

const handlers: Record<string, Handler> = {
  "app.info": () => ({ ...appInfo, ripgrep: !!which("rg") }),
  "app.open": ({ path: p, reveal }: { path: string; reveal?: boolean }) => {
    const target = expandHome(p);
    spawnSync("open", reveal ? ["-R", target] : [target]);
    return true;
  },

  "settings.get": () => store.getSettings(),
  "settings.update": (patch) => {
    const previousMemory = memoryConfigKey(store.getSettings());
    const s = store.saveSettings(patch);
    if (previousMemory !== memoryConfigKey(s)) cancelMemoryWork();
    if (Object.keys(patch).some((k) => k.startsWith("memory"))) {
      if (s.memoryEnabled && memoryConfigured(s)) void prepareMemory(s).then(() => drainMemoryJobs()).catch(() => {});
    }
    if ("historySources" in patch) {
      setHistorySources(s.historySources);
      syncHistory().catch(() => {});
    }
    return s;
  },
  "history.status": () => historyStatus(),
  "history.rebuild": () => {
    rebuildHistory().catch(() => {});
    return true;
  },

  "providers.presets": () => PROVIDER_PRESETS,
  "providers.list": () => store.listProviders(),
  "providers.upsert": (p: ProviderConfig) => {
    const next = { ...p, id: p.id || newId("p_"), createdAt: p.createdAt || Date.now() };
    store.upsertProvider(next);
    return store.getProvider(next.id);
  },
  "providers.delete": ({ id }) => store.deleteProvider(id),
  "providers.remoteModels": async ({ id, draft }: { id?: string; draft?: ProviderConfig }) => {
    const p = draft ?? store.getProvider(id!);
    if (!p) throw new Error(st("providerNotFound", { id: id ?? "" }));
    return fetchRemoteModels(p);
  },
  "providers.test": async ({ providerId, modelId }) => {
    const started = Date.now();
    const r = await generateText({ model: languageModel(providerId, modelId), prompt: "Reply with exactly: ok", maxRetries: 0, abortSignal: AbortSignal.timeout(60000) });
    return { ok: true, text: r.text.slice(0, 200), ms: Date.now() - started };
  },

  "media.status": () => mediaStatus(),
  "media.image": ({ data, name }: { data: string; name?: string }) => convertImage(data, name),

  "models.list": ({ providerId } = {}) => store.listModels(providerId),
  "models.defaults": async ({ providerId, id, name, contextWindow, metadataSource }) => {
    const p = store.getProvider(providerId);
    if (p?.kind === "amazon-q") {
      const remote = (await fetchRemoteModels(p)).find((m) => m.id === id);
      if (!remote) throw new Error(`Amazon Q model is unavailable for this API key: ${id}`);
      return { providerId, ...modelDefaults(p.kind, id, name || remote.name, contextWindow ?? remote.contextWindow, remote) };
    }
    return { providerId, ...modelDefaults(p?.kind ?? "openai-compatible", id, name, contextWindow, { baseUrl: p?.baseUrl, metadataSource }) };
  },
  "models.upsert": (m: ModelConfig & { resetAutomatic?: boolean }) => {
    const p = store.getProvider(m.providerId);
    const facts = p ? lookupFacts(p.kind, p.baseUrl, m.id, m.metadataSource === "codex" ? "codex" : undefined) : null;
    const efforts = m.efforts == null ? null : sortEfforts(m.efforts);
    store.upsertModel({ ...m, efforts, locked: m.resetAutomatic ? locksFor({ ...m, efforts }, facts) : locksFor({ ...m, efforts }, facts, store.getModel(m.providerId, m.id)) });
  },
  "models.addMany": async ({ providerId, models }: { providerId: string; models: (Partial<RemoteModel> & { id: string })[] }) => {
    const p = store.getProvider(providerId);
    if (!p) throw new Error(st("providerNotFound", { id: providerId }));
    let incoming = models;
    if (p.kind === "amazon-q") {
      const discovered = new Map((await fetchRemoteModels(p)).map((m) => [m.id, m]));
      incoming = models.map((m) => {
        const remote = discovered.get(m.id);
        if (!remote) throw new Error(`Amazon Q model is unavailable for this API key: ${m.id}`);
        return remote;
      });
    }
    for (const m of incoming) {
      if (store.getModel(providerId, m.id)) continue;
      const d = modelDefaults(p.kind, m.id, m.name, m.contextWindow, { ...m, baseUrl: p.baseUrl });
      store.upsertModel({ providerId, ...d });
    }
    return store.listModels(providerId);
  },
  "models.delete": ({ providerId, id }) => store.deleteModel(providerId, id),

  "sessions.list": ({ archived } = {}) => store.listSessions({ archived }),
  "sessions.get": ({ id }) => sessionDetail(id),
  "sessions.create": (input: Partial<SessionInfo>) => {
    const s = createSession(input);
    emit({ type: "session_updated", session: s });
    return s;
  },
  "sessions.update": ({ id, patch }: { id: string; patch: Partial<SessionInfo> }) => {
    if (patch.cwd) {
      patch.cwd = expandHome(patch.cwd);
      if (!fs.existsSync(patch.cwd)) throw new Error(st("dirNotFound", { path: patch.cwd }));
    }
    const allowed: (keyof SessionInfo)[] = ["title", "cwd", "providerId", "modelId", "thinking", "permissionMode", "pinned", "archived"];
    const clean: Partial<SessionInfo> = {};
    for (const k of allowed) if (k in patch) (clean as any)[k] = (patch as any)[k];
    store.updateSession(id, clean);
    const s = store.getSession(id)!;
    emit({ type: "session_updated", session: s });
    return s;
  },
  "sessions.delete": ({ id }) => {
    dropRunner(id);
    const deleted = store.deleteSession(id);
    for (const sessionId of deleted) removeSessionUploads(appInfo.dataDir, sessionId);
    emit({ type: "session_deleted", id });
    return true;
  },
  "sessions.fork": ({ id, seq }) => {
    const s = forkSession(id, seq, appInfo.dataDir);
    emit({ type: "session_updated", session: s });
    return s;
  },
  "sessions.merge": async ({ id, into, instructions }) => {
    const { source, target } = await mergeSession(id, into, instructions?.trim() || undefined);
    emit({ type: "session_updated", session: source });
    emit({ type: "session_updated", session: target });
    return target;
  },
  "sessions.export": ({ id }) => exportMarkdown(id),
  // One stored message per line, as the session's own record (no rendering), for pasting into other tools.
  "sessions.jsonl": ({ id }) => {
    if (!store.getSession(id)) throw new Error(st("sessionNotFound"));
    return store.loadMessages(id).map((m) => JSON.stringify({ seq: m.seq, ...m.message })).join("\n");
  },
  "sessions.contextBreakdown": ({ id }) => getRunner(id).contextBreakdown(),
  "sessions.search": ({ query, limit }) => store.searchMessages(query, limit ?? 40),
  "sessions.context": ({ id }) => {
    const s = store.getSession(id);
    if (!s) throw new Error(st("sessionNotFound"));
    return {
      instructions: collectInstructions(s.cwd).map((f) => ({ path: collapseHome(f.path), scope: f.scope, chars: f.content.length })),
      skills: discoverSkills(s.cwd).length,
      mcp: mcpStatuses().filter((m) => m.state === "connected").map((m) => ({ name: m.name, tools: m.tools.length })),
    };
  },

  "chat.send": async ({ sessionId, text, images, files, mode }: { sessionId: string; text: string; images?: any[]; files?: FileAttachment[]; mode?: "auto" | "steer" | "followUp" }) => {
    await getRunner(sessionId).send(text, images ?? [], files ?? [], mode ?? "auto");
    return true;
  },
  "chat.abort": ({ sessionId }) => {
    peekRunner(sessionId)?.abort();
    return true;
  },
  "chat.retry": async ({ sessionId }) => {
    await getRunner(sessionId).retry();
    return true;
  },
  "chat.edit": async ({ sessionId, seq, text, images, files }: { sessionId: string; seq: number; text: string; images?: any[]; files?: FileAttachment[] }) => {
    await getRunner(sessionId).editAndResend(seq, text, images ?? [], files ?? []);
    return true;
  },
  "chat.compact": async ({ sessionId, instructions }) => {
    await getRunner(sessionId).manualCompact(instructions);
    return true;
  },
  "chat.cancelQueued": ({ sessionId, id }) => {
    peekRunner(sessionId)?.cancelQueued(id);
    return true;
  },

  "approvals.respond": ({ id, decision, reason, pattern }) => {
    respondApproval(id, decision, reason, pattern);
    return true;
  },

  /** `answers: null` dismisses the question. */
  "questions.respond": ({ id, answers }) => {
    respondQuestion(id, answers ?? null);
    return true;
  },

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

  "permissions.defaults": () => ({ bashWhitelist: DEFAULT_BASH_WHITELIST }),

  "usage.summary": ({ days }) => store.usageSummary(days ?? 30),

  "fs.complete": ({ cwd, query, limit }: { cwd: string; query: string; limit?: number }) => {
    const root = expandHome(cwd);
    const files = listProjectFiles(root);
    const q = (query ?? "").trim();
    if (!q) return files.slice(0, limit ?? 30);
    return files
      .map((f) => ({ f, s: fuzzyScore(f, q) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit ?? 30)
      .map((x) => x.f);
  },
  "fs.dirs": ({ path: p }: { path: string }) => {
    const raw = expandHome(p || "~/");
    const dir = raw.endsWith("/") ? raw : path.dirname(raw);
    const prefix = raw.endsWith("/") ? "" : path.basename(raw).toLowerCase();
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith(".") && e.name.toLowerCase().startsWith(prefix))
        .slice(0, 40)
        .map((e) => collapseHome(path.join(dir, e.name)));
    } catch {
      return [];
    }
  },
  "fs.writeText": ({ path: p, content }: { path: string; content: string }) => {
    fs.writeFileSync(expandHome(p), content);
    return true;
  },
  "files.describe": ({ paths }: { paths: string[] }) => {
    if (!Array.isArray(paths) || !paths.length) return [];
    return describeLocalFiles(paths);
  },
  /** Copies a file the desktop user picked into the session. A phone uploads bytes instead; it must not name Mac paths. */
  "files.import": ({ sessionId, path: filePath }: { sessionId: string; path: string }) => importLocalFile(appInfo.dataDir, sessionId, filePath),
  "fs.recentDirs": () => {
    const rows = store.listSessions({}).map((s) => s.cwd);
    return [...new Set(rows)].slice(0, 12).map(collapseHome);
  },
};

export interface Caller {
  /** True for requests arriving over the LAN listener from a paired device. */
  remote: boolean;
  deviceId?: string;
}

export interface SocketData {
  caller: Caller;
  unsub?: () => void;
}

export function registerHandlers(extra: Record<string, Handler>) {
  Object.assign(handlers, extra);
}

// A paired phone gets the full agent API, but must not be able to pair or revoke devices.
// files.describe turns an arbitrary path into a file's name and size, so it stays on the desktop:
// a paired phone uploads through /upload instead, and must not be able to probe the Mac's files.
const localOnly = (method: string) => method.startsWith("remote.") || method === "files.describe" || method === "files.import";

async function dispatch(body: any, caller: Caller, headers: Record<string, string>): Promise<Response> {
  const method = String(body?.method ?? "");
  const h = handlers[method];
  if (!h || (caller.remote && localOnly(method))) {
    return Response.json({ error: `unknown method ${method}` }, { status: 404, headers });
  }
  try {
    const result = await h(body.params ?? {}, caller);
    return Response.json({ result: result ?? null }, { headers });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { headers });
  }
}

async function upload(req: Request, headers: Record<string, string>): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "invalid multipart body" }, { status: 400, headers });
  }
  const sessionId = String(form.get("sessionId") ?? "");
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: st("uploadMissingFile") }, { status: 400, headers });
  try {
    const result = await storeUpload({
      dataDir: appInfo.dataDir,
      sessionId,
      fileName: file.name || "file",
      mimeType: file.type || undefined,
      stream: file.stream(),
      sizeHint: Number.isFinite(file.size) ? file.size : undefined,
    });
    return Response.json(result, { headers });
  } catch (e: any) {
    if (e instanceof UploadError) return Response.json({ error: e.message }, { status: e.status, headers });
    return Response.json({ error: e?.message ?? String(e) }, { status: 500, headers });
  }
}

/** Serves /events, /rpc, /upload and /health for a caller that has already been authenticated. */
export async function handleApi(
  req: Request,
  server: Server<SocketData>,
  caller: Caller,
  headers: Record<string, string> = {},
): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname === "/events") {
    if (server.upgrade(req, { data: { caller } })) return undefined;
    return new Response("upgrade failed", { status: 400, headers });
  }
  if (url.pathname === "/rpc" && req.method === "POST") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400, headers });
    }
    return dispatch(body, caller, headers);
  }
  if (url.pathname === "/upload" && req.method === "POST") return upload(req, headers);
  if (url.pathname === "/health") return new Response("ok", { headers });
  return new Response("not found", { status: 404, headers });
}

export const socketHandlers: WebSocketHandler<SocketData> = {
  open(ws) {
    ws.data.unsub = subscribe((e) => ws.send(JSON.stringify(e)));
    ws.send(JSON.stringify({ type: "mcp_status", servers: mcpStatuses() }));
  },
  message() {},
  close(ws) {
    ws.data.unsub?.();
  },
};

export function startServer(opts: { port: number; token: string; dataDir: string; dev: boolean }) {
  appInfo = {
    version: VERSION,
    dataDir: opts.dataDir,
    dbPath: store.dbPath,
    home: HOME,
    platform: process.platform,
    dev: opts.dev,
    ripgrep: !!which("rg"),
    shell: SHELL,
  };

  const cors = (req: Request) => ({
    "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    "Access-Control-Allow-Headers": "content-type, x-kestrel-token",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  });

  return Bun.serve<SocketData>({
    hostname: "127.0.0.1",
    port: opts.port,
    idleTimeout: 255,
    fetch(req, server) {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
      const url = new URL(req.url);
      const token = req.headers.get("x-kestrel-token") ?? url.searchParams.get("token");
      if (token !== opts.token) return new Response("unauthorized", { status: 401, headers: cors(req) });
      return handleApi(req, server, { remote: false }, cors(req));
    },
    websocket: socketHandlers,
  });
}
