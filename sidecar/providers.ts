import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getModels, getProviders, type Model } from "@mariozechner/pi-ai";
import type { LanguageModel } from "ai";
import type { ModelConfig, ProviderConfig, ProviderKind, RemoteModel } from "../shared/protocol";
import * as store from "./db";
import { getShellEnv } from "./env";
import { lookupFacts } from "./catalog";
import { sortEfforts } from "../shared/effort";
import { st } from "./i18n";
import { AmazonQClient, amazonQEfforts, AMAZON_Q_BASE_URL } from "./llm/amazon-q-api";
import { AmazonQLanguageModel } from "./llm/amazon-q";

export const PROVIDER_PRESETS: Record<ProviderKind, { name: string; baseUrl: string; needsKey: boolean }> = {
  anthropic: { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", needsKey: true },
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1", needsKey: true },
  "openai-compatible": { name: "OpenAI-compatible", baseUrl: "http://127.0.0.1:8000/v1", needsKey: false },
  google: { name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", needsKey: true },
  deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", needsKey: true },
  openrouter: { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", needsKey: true },
  "amazon-q": { name: "Amazon Q", baseUrl: AMAZON_Q_BASE_URL, needsKey: true },
  ollama: { name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", needsKey: false },
};

function isLocalHost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost");
}

function noProxyMatch(host: string, noProxy: string) {
  return noProxy
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => rule === "*" || host === rule.replace(/^\./, "") || host.endsWith(rule.startsWith(".") ? rule : "." + rule));
}

export function proxyFor(url: string): string | undefined {
  const settings = store.getSettings();
  if (settings.proxyMode === "none") return undefined;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (isLocalHost(host)) return undefined;
  if (settings.proxyMode === "custom") return settings.proxyUrl || undefined;
  const env = getShellEnv();
  const noProxy = env.NO_PROXY || env.no_proxy || "";
  if (noProxy && noProxyMatch(host, noProxy)) return undefined;
  const isHttps = url.startsWith("https:");
  return (
    (isHttps ? env.HTTPS_PROXY || env.https_proxy : env.HTTP_PROXY || env.http_proxy) ||
    env.ALL_PROXY ||
    env.all_proxy ||
    undefined
  );
}

export const proxiedFetch: typeof fetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const proxy = proxyFor(url);
    return fetch(input as any, { ...(init as any), proxy } as any);
  },
  { preconnect: fetch.preconnect },
) as typeof fetch;

const amazonQClients = new Map<string, { sig: string; client: AmazonQClient }>();
function amazonQClient(p: ProviderConfig): AmazonQClient {
  const sig = JSON.stringify([p.baseUrl, p.apiKey, p.headers]);
  let entry = amazonQClients.get(p.id);
  if (!entry || entry.sig !== sig) {
    entry = { sig, client: new AmazonQClient({ apiKey: p.apiKey, baseURL: p.baseUrl, headers: p.headers, fetch: proxiedFetch }) };
    amazonQClients.set(p.id, entry);
  }
  return entry.client;
}

function createProvider(p: ProviderConfig): (modelId: string) => LanguageModel {
  const baseURL = p.baseUrl || PROVIDER_PRESETS[p.kind].baseUrl;
  const common = { apiKey: p.apiKey || undefined, baseURL, headers: p.headers, fetch: proxiedFetch };
  switch (p.kind) {
    case "amazon-q": {
      const client = amazonQClient(p);
      return (id) => new AmazonQLanguageModel(id, client);
    }
    case "anthropic": {
      const prov = createAnthropic({ ...common, apiKey: p.apiKey || "missing" });
      return (id) => prov(id);
    }
    case "openai": {
      const prov = createOpenAI({ ...common, apiKey: p.apiKey || "missing" });
      return (id) => prov(id);
    }
    case "google": {
      const prov = createGoogleGenerativeAI({ ...common, apiKey: p.apiKey || "missing" });
      return (id) => prov(id);
    }
    case "deepseek": {
      const prov = createDeepSeek({ ...common, apiKey: p.apiKey || "missing" });
      return (id) => prov(id);
    }
    default: {
      const prov = createOpenAICompatible({
        name: p.kind === "openrouter" ? "openrouter" : p.kind === "ollama" ? "ollama" : "compatible",
        baseURL,
        apiKey: p.apiKey || undefined,
        headers: p.headers,
        includeUsage: true,
        fetch: proxiedFetch,
      });
      return (id) => prov(id);
    }
  }
}

const cache = new Map<string, { sig: string; make: (id: string) => LanguageModel }>();

export function languageModel(providerId: string, modelId: string): LanguageModel {
  const p = store.getProvider(providerId);
  if (!p) throw new Error(st("providerNotFound", { id: providerId }));
  const sig = JSON.stringify([p.kind, p.baseUrl, p.apiKey, p.headers]);
  let entry = cache.get(providerId);
  if (!entry || entry.sig !== sig) {
    entry = { sig, make: createProvider(p) };
    cache.set(providerId, entry);
  }
  return entry.make(modelId);
}

const PI_PROVIDER: Partial<Record<ProviderKind, string>> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  deepseek: "deepseek",
  openrouter: "openrouter",
};

let catalog: Model<any>[] | null = null;
function allKnownModels(): Model<any>[] {
  if (!catalog) {
    catalog = [];
    for (const prov of getProviders()) {
      try {
        catalog.push(...getModels(prov as any));
      } catch {}
    }
  }
  return catalog;
}

/** `claude-opus-5-5[1m]`: proxies mark the long-context variant with a suffix. */
const LONG_CONTEXT = /\[1m\]$/i;

export function lookupKnownModel(kind: ProviderKind, id: string): Model<any> | null {
  const piProv = PI_PROVIDER[kind];
  const pool = allKnownModels();
  const preferred = piProv ? pool.filter((m) => m.provider === piProv) : [];
  const plain = id.replace(LONG_CONTEXT, "");
  const bare = plain.includes("/") && kind !== "openrouter" ? plain.split("/").pop()! : plain;
  for (const list of [preferred, pool]) {
    const exact = list.find((m) => m.id === plain) ?? list.find((m) => m.id === bare);
    if (exact) return exact;
  }
  const undated = bare.replace(/-\d{4}-?\d{2}-?\d{2}$/, "").replace(/-\d{8}$/, "");
  for (const list of [preferred, pool]) {
    const hit = list.find((m) => m.id === undated);
    if (hit) return hit;
  }
  return null;
}

export interface ModelHint {
  metadataSource?: "catalog" | "codex";
  baseUrl?: string;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
  /** Effort list reported by this endpoint. Used only when it is non-empty; it beats the catalog. */
  efforts?: string[];
  effortDefault?: string | null;
  cost?: ModelConfig["cost"];
}

export function modelDefaults(kind: ProviderKind, id: string, name?: string, contextHint?: number, hint?: ModelHint): Omit<ModelConfig, "providerId"> {
  const facts = lookupFacts(kind, hint?.baseUrl ?? "", id, hint?.metadataSource === "codex" ? "codex" : undefined);
  const known = kind === "amazon-q" ? null : lookupKnownModel(kind, id);
  const long = LONG_CONTEXT.test(id);
  const lower = id.toLowerCase();
  const claude = /(^|\/)claude-/.test(lower);
  let contextWindow = facts?.contextWindow ?? known?.contextWindow ?? (long ? 1_000_000 : claude ? 200_000 : 128_000);
  if (long) contextWindow = Math.max(contextWindow, 1_000_000);
  if (contextHint) contextWindow = contextHint;
  const efforts = hint?.efforts !== undefined ? sortEfforts(hint.efforts) : (facts?.efforts ?? null);
  let effortDefault = hint?.effortDefault ?? facts?.effortDefault ?? null;
  if (effortDefault && efforts && !efforts.includes(effortDefault)) effortDefault = null;
  const cost = hint?.cost ?? facts?.cost ?? known?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return {
    id,
    name: name || facts?.name || known?.name || id,
    contextWindow,
    maxTokens: hint?.maxTokens ?? (facts?.maxTokens || known?.maxTokens || 16384),
    reasoning: hint?.reasoning ?? ((efforts?.length ?? 0) > 0 || (facts ? !!facts.reasoning : known ? known.reasoning : kind !== "amazon-q" && /reason|think|o\d|gpt-[5-9]|r1|qwq|claude|gemini-2\.5|gemini-3/.test(lower))),
    vision: hint?.vision ?? facts?.vision ?? known?.input.includes("image") ?? (kind !== "amazon-q" && /vision|gpt-4o|gpt-[5-9]|claude|gemini|vl/.test(lower)),
    cost: { input: cost.input, output: cost.output, cacheRead: cost.cacheRead, cacheWrite: cost.cacheWrite },
    enabled: true,
    efforts,
    effortDefault,
    locked: [],
    metadataSource: hint?.metadataSource ?? "catalog",
    metadata: facts ? { source: hint?.metadataSource === "codex" ? "codex" : "catalog", checkedAt: Date.now(), values: { ...facts, cost: facts.cost ?? undefined } } : undefined,
  };
}

export async function fetchRemoteModels(p: ProviderConfig): Promise<RemoteModel[]> {
  if (p.kind === "amazon-q") {
    return (await amazonQClient(p).models(undefined, true)).map((model) => ({
      id: model.modelId,
      name: model.modelName || model.modelId,
      contextWindow: model.tokenLimits?.maxInputTokens,
      maxTokens: model.tokenLimits?.maxOutputTokens,
      vision: model.supportedInputTypes?.includes("IMAGE") ?? false,
      reasoning: !!model.additionalModelRequestFieldsSchema?.properties?.thinking || !!model.additionalModelRequestFieldsSchema?.properties?.reasoning,
      ...amazonQEfforts(model),
      // Amazon Q bills credits, not USD per token; public provider prices do not apply.
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      known: true,
    }));
  }
  const base = (p.baseUrl || PROVIDER_PRESETS[p.kind].baseUrl).replace(/\/+$/, "");
  let url = `${base}/models`;
  const headers: Record<string, string> = { ...p.headers };
  if (p.kind === "anthropic") {
    headers["x-api-key"] = p.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    url += "?limit=1000";
  } else if (p.kind === "google") {
    url += `?key=${encodeURIComponent(p.apiKey)}&pageSize=1000`;
  } else if (p.apiKey) {
    headers.Authorization = `Bearer ${p.apiKey}`;
  }
  const res = await proxiedFetch(url, { headers, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  const raw: any[] = body.data ?? body.models ?? [];
  return raw
    .map((m) => {
      const id: string = p.kind === "google" ? String(m.name ?? "").replace(/^models\//, "") : String(m.id ?? m.name ?? "");
      const pr = m.pricing;
      const perM = (v: unknown) => (v === undefined || v === null || v === "" ? 0 : Number(v) * 1e6);
      const cost =
        pr && (Number(pr.prompt) > 0 || Number(pr.completion) > 0)
          ? { input: perM(pr.prompt), output: perM(pr.completion), cacheRead: perM(pr.input_cache_read), cacheWrite: perM(pr.input_cache_write) }
          : undefined;
      const reported = Array.isArray(m.reasoning?.supported_efforts) ? m.reasoning.supported_efforts.filter((v: unknown): v is string => typeof v === "string" && !!v) : [];
      return {
        id,
        name: m.display_name ?? m.displayName ?? m.name ?? id,
        contextWindow: m.context_length ?? m.inputTokenLimit ?? m.context_window ?? undefined,
        cost,
        efforts: reported.length ? reported : undefined,
        effortDefault: typeof m.reasoning?.default_effort === "string" ? m.reasoning.default_effort : undefined,
        known: !!lookupKnownModel(p.kind, id) || !!lookupFacts(p.kind, base, id),
      } as RemoteModel;
    })
    .filter((m) => m.id && !/embed|tts|whisper|dall-e|image|audio|moderation|realtime|transcribe/i.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function toPiModel(m: ModelConfig): Model<any> {
  return {
    id: m.id,
    name: m.name,
    api: "vercel-ai",
    provider: m.providerId,
    baseUrl: "",
    reasoning: m.reasoning,
    input: m.vision ? ["text", "image"] : ["text"],
    cost: { ...m.cost },
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
  };
}

export function resolveModel(providerId: string, modelId: string): ModelConfig {
  const m = store.getModel(providerId, modelId);
  if (m) return m;
  const p = store.getProvider(providerId);
  if (!p) throw new Error(st("configureProvider"));
  return { providerId, ...modelDefaults(p.kind, modelId, undefined, undefined, { baseUrl: p.baseUrl }) };
}
