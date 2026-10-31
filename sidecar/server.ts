// The sidecar's HTTP and WebSocket API: one RPC endpoint dispatching to the handlers in rpc/, uploads, and
// the event stream. The desktop app calls it on localhost; paired phones reach it through remote.ts.
import type { Server, WebSocketHandler } from "bun";
import * as store from "./db";
import { HOME, SHELL, which } from "./env";
import { subscribe } from "./hub";
import { st } from "./i18n";
import { mcpStatuses } from "./mcp";
import { storeUpload, UploadError } from "./uploads";
import { appInfo, setAppInfo } from "./app-info";
import { appHandlers } from "./rpc/app";
import { modelHandlers } from "./rpc/models";
import { sessionHandlers } from "./rpc/sessions";
import { extensionHandlers } from "./rpc/extensions";
import { fileHandlers } from "./rpc/files";
import type { Caller, Handler } from "./rpc/types";

export type { Caller } from "./rpc/types";

import { version as VERSION } from "../package.json";

const handlers: Record<string, Handler> = { ...appHandlers, ...modelHandlers, ...sessionHandlers, ...extensionHandlers, ...fileHandlers };

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
      dataDir: appInfo().dataDir,
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
  setAppInfo({
    version: VERSION,
    dataDir: opts.dataDir,
    dbPath: store.dbPath,
    home: HOME,
    platform: process.platform,
    dev: opts.dev,
    ripgrep: !!which("rg"),
    shell: SHELL,
  });

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
