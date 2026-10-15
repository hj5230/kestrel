import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig, McpServerStatus } from "../shared/protocol";
import * as store from "./db";
import { expandHome, getShellEnv } from "./env";
import { emit } from "./hub";
import { st } from "./i18n";
import { proxiedFetch } from "./providers";
import type { HelmTool } from "./tools/types";

interface Conn {
  config: McpServerConfig;
  client: Client | null;
  state: McpServerStatus["state"];
  error: string | null;
  tools: { name: string; description: string; inputSchema: any }[];
}

const conns = new Map<string, Conn>();

function sanitize(s: string) {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function mcpStatuses(): McpServerStatus[] {
  return store.listMcpServers().map((cfg) => {
    const c = conns.get(cfg.id);
    return {
      id: cfg.id,
      name: cfg.name,
      state: !cfg.enabled ? "disabled" : (c?.state ?? "connecting"),
      error: c?.error ?? null,
      tools: (c?.tools ?? []).map((t) => ({ name: t.name, description: t.description })),
    };
  });
}

function broadcast() {
  emit({ type: "mcp_status", servers: mcpStatuses() });
}

async function connect(cfg: McpServerConfig) {
  const conn: Conn = { config: cfg, client: null, state: "connecting", error: null, tools: [] };
  conns.set(cfg.id, conn);
  broadcast();
  try {
    const client = new Client({ name: "helm", version: "0.1.0" }, { capabilities: {} });
    let transport;
    if (cfg.transport === "stdio") {
      transport = new StdioClientTransport({
        command: expandHome(cfg.command),
        args: cfg.args.map(expandHome),
        env: { ...getShellEnv(), ...cfg.env },
        stderr: "ignore",
      });
    } else if (cfg.transport === "sse") {
      transport = new SSEClientTransport(new URL(cfg.url), {
        requestInit: { headers: cfg.headers },
        eventSourceInit: { fetch: (u: any, init: any) => proxiedFetch(u, { ...init, headers: { ...init?.headers, ...cfg.headers } }) } as any,
        fetch: proxiedFetch,
      } as any);
    } else {
      transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
        requestInit: { headers: cfg.headers },
        fetch: proxiedFetch,
      } as any);
    }
    await Promise.race([
      client.connect(transport),
      new Promise((_, rej) => setTimeout(() => rej(new Error(st("mcpTimeout"))), 30000)),
    ]);
    const tools: Conn["tools"] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      for (const t of page.tools) tools.push({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema });
      cursor = page.nextCursor;
    } while (cursor);
    if (conns.get(cfg.id) !== conn) {
      await client.close().catch(() => {});
      return;
    }
    conn.client = client;
    conn.tools = tools;
    conn.state = "connected";
    client.onclose = () => {
      if (conns.get(cfg.id) === conn && conn.state === "connected") {
        conn.state = "error";
        conn.error = st("mcpClosed");
        conn.client = null;
        broadcast();
      }
    };
  } catch (e: any) {
    conn.state = "error";
    conn.error = e?.message ?? String(e);
  }
  broadcast();
}

async function disconnect(id: string) {
  const c = conns.get(id);
  conns.delete(id);
  if (c?.client) await c.client.close().catch(() => {});
}

export async function startMcp() {
  await Promise.all(store.listMcpServers().filter((s) => s.enabled).map((s) => connect(s)));
}

export async function restartMcp(id: string) {
  await disconnect(id);
  const cfg = store.listMcpServers().find((s) => s.id === id);
  if (cfg?.enabled) await connect(cfg);
  else broadcast();
}

export async function removeMcp(id: string) {
  await disconnect(id);
  broadcast();
}

export async function stopAllMcp() {
  await Promise.all([...conns.keys()].map(disconnect));
}

export function mcpTools(): HelmTool[] {
  const out: HelmTool[] = [];
  for (const conn of conns.values()) {
    if (conn.state !== "connected" || !conn.client) continue;
    for (const t of conn.tools) {
      const name = `mcp__${sanitize(conn.config.name)}__${sanitize(t.name)}`.slice(0, 64);
      const schema = t.inputSchema && typeof t.inputSchema === "object" ? { ...t.inputSchema } : { type: "object", properties: {} };
      if (!schema.type) schema.type = "object";
      if (!schema.properties) schema.properties = {};
      out.push({
        name,
        label: `${conn.config.name} · ${t.name}`,
        category: "mcp",
        description: t.description || `${t.name} (MCP server ${conn.config.name})`,
        parameters: schema as any,
        async execute(_id, params, signal) {
          const client = conn.client;
          if (!client) throw new Error(`MCP server ${conn.config.name} is not connected`);
          const res: any = await client.callTool({ name: t.name, arguments: (params ?? {}) as Record<string, unknown> }, undefined, {
            signal,
            timeout: 600_000,
            resetTimeoutOnProgress: true,
          });
          const content: any[] = [];
          for (const c of res.content ?? []) {
            if (c.type === "text") content.push({ type: "text", text: c.text });
            else if (c.type === "image") content.push({ type: "image", data: c.data, mimeType: c.mimeType });
            else if (c.type === "resource") content.push({ type: "text", text: c.resource?.text ?? `[resource ${c.resource?.uri}]` });
            else if (c.type === "resource_link") content.push({ type: "text", text: `[resource ${c.uri}] ${c.name ?? ""}` });
            else content.push({ type: "text", text: JSON.stringify(c) });
          }
          if (!content.length && res.structuredContent) content.push({ type: "text", text: JSON.stringify(res.structuredContent, null, 2) });
          if (!content.length) content.push({ type: "text", text: "(empty result)" });
          if (res.isError) throw new Error(content.map((c) => (c.type === "text" ? c.text : "")).join("\n"));
          return { content, details: { server: conn.config.name, tool: t.name } };
        },
      });
    }
  }
  return out;
}
