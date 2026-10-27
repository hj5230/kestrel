// Memory has one required retrieval pipeline. Missing models disable it; endpoint errors never select another path.
import type { AppSettings, MemoryEmbeddingEndpoint, MemoryModelEndpoint } from "../shared/protocol";

export function memoryConfigured(s: AppSettings): boolean {
  return !!(s.memoryEmbedding?.url?.trim() && s.memoryEmbedding?.model?.trim() && s.memoryReranker?.url?.trim() && s.memoryReranker?.model?.trim());
}

export function validateMemoryEndpoint(value: unknown, embedding: true): MemoryEmbeddingEndpoint;
export function validateMemoryEndpoint(value: unknown, embedding?: false): MemoryModelEndpoint;
export function validateMemoryEndpoint(value: unknown, embedding = false): MemoryModelEndpoint | MemoryEmbeddingEndpoint {
  const v = value as MemoryEmbeddingEndpoint;
  if (!v || typeof v.url !== "string" || typeof v.model !== "string" || typeof v.apiKey !== "string") throw new Error("Invalid memory model configuration");
  if (v.url.trim()) {
    const url = new URL(v.url.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error("Use an HTTP(S) endpoint without credentials, query or fragment");
  }
  if (embedding && v.api !== "ollama" && v.api !== "openai") throw new Error("Unknown embedding API");
  return { url: v.url.trim(), model: v.model.trim(), apiKey: v.apiKey.trim(), ...(embedding ? { api: v.api } : {}) };
}
