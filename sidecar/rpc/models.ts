// Model providers and their models: presets, discovery, defaults from the catalog, and a test call.
import type { ModelConfig, ProviderConfig, RemoteModel } from "../../shared/protocol";
import * as store from "../db";
import { st } from "../i18n";
import { sortEfforts } from "../../shared/effort";
import { locksFor, lookupFacts } from "../catalog";
import { fetchRemoteModels, modelDefaults, PROVIDER_PRESETS } from "../providers";
import { newId } from "../sessions";
import { generateText } from "ai";
import { languageModel } from "../providers";
import type { Handler } from "./types";

export const modelHandlers: Record<string, Handler> = {
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
};
