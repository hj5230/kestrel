// Calls to the memory models: embeddings (Ollama or OpenAI-style) and the reranker, with their answers checked.
// Memory text is cut into overlapping chunks so every piece fits the embedding model's window.
import type { AppSettings, MemoryEntry } from "../../shared/protocol";
import { proxiedFetch } from "../providers";
import { st } from "../i18n";

export async function post(url: string, apiKey: string, body: unknown, signal?: AbortSignal, timeoutMs = 90000): Promise<any> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await proxiedFetch(url, {
      method: "POST", redirect: "error",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body), signal: requestSignal,
    });
    if (!response.ok) throw new Error(`Memory model HTTP ${response.status}`);
    // Do not echo provider bodies: they may contain credentials or the private input.
    return await response.json().catch((e) => {
      if (requestSignal.aborted) throw e;
      throw new Error("Memory model returned invalid JSON");
    });
  } catch (e) {
    if (timeout.aborted && !signal?.aborted) throw new Error(st("memoryModelTimeout", { seconds: timeoutMs / 1000 }));
    throw e;
  }
}

export async function embedTexts(s: AppSettings, inputs: string[], signal?: AbortSignal): Promise<number[][]> {
  const cfg = s.memoryEmbedding;
  // Ollama otherwise unloads the model after five idle minutes. Cancelling its next cold load at 30s
  // kills the load itself and traps later requests in the same loop, especially during Metal compilation.
  const result = await post(cfg.url, cfg.apiKey, { model: cfg.model, input: inputs, ...(cfg.api === "ollama" ? { truncate: false, keep_alive: -1, options: { num_ctx: 4096 } } : { encoding_format: "float" }) }, signal, cfg.api === "ollama" ? 300000 : 90000).catch((e) => { throw new Error(`Embedding: ${e instanceof Error ? e.message : String(e)}`); });
  let vectors: unknown;
  if (cfg.api === "ollama") vectors = result.embeddings;
  else {
    if (!Array.isArray(result.data) || result.data.length !== inputs.length || result.data.some((v: any) => !Number.isInteger(v.index)) || new Set(result.data.map((v: any) => v.index)).size !== inputs.length) throw new Error("Embedding model returned invalid indices");
    vectors = [...result.data].sort((a: any, b: any) => a.index - b.index).map((v: any, i: number) => {
      if (v.index !== i) throw new Error("Embedding model returned invalid indices");
      return v.embedding;
    });
  }
  if (!Array.isArray(vectors) || vectors.length !== inputs.length) throw new Error("Embedding model returned the wrong number of vectors");
  const dim = vectors[0]?.length;
  if (!Number.isInteger(dim) || dim < 1 || dim > 32768 || vectors.some((v) => !Array.isArray(v) || v.length !== dim || v.some((n) => typeof n !== "number" || !Number.isFinite(n)) || !v.some((n) => n !== 0))) throw new Error("Embedding model returned invalid vectors");
  return vectors.map((v: number[]) => {
    const norm = Math.hypot(...v);
    if (!Number.isFinite(norm)) throw new Error("Embedding vector magnitude is invalid");
    return v.map((n) => n / norm);
  });
}

export async function rerankTexts(s: AppSettings, query: string, documents: string[], signal?: AbortSignal): Promise<{ index: number; score: number }[]> {
  const cfg = s.memoryReranker;
  const body = await post(cfg.url, cfg.apiKey, { model: cfg.model, query, documents, top_n: documents.length, return_documents: false }, signal).catch((e) => { throw new Error(`Reranker: ${e instanceof Error ? e.message : String(e)}`); });
  if (!Array.isArray(body.results) || body.results.length !== documents.length) throw new Error("Reranker must return one result per document");
  const seen = new Set<number>();
  const results = body.results.map((r: any) => {
    if (!Number.isInteger(r.index) || r.index < 0 || r.index >= documents.length || seen.has(r.index) || typeof r.relevance_score !== "number" || !Number.isFinite(r.relevance_score) || r.relevance_score < 0 || r.relevance_score > 1) throw new Error("Reranker returned invalid indices or scores (expected 0–1)");
    seen.add(r.index);
    return { index: r.index, score: r.relevance_score };
  });
  return results.sort((a: { score: number }, b: { score: number }) => b.score - a.score);
}

// Fixed chunking is used for every input, not as a retry path. Even four-byte codepoints fit the
// 4096-token runtime window, with overlap across boundaries; reranking still receives the whole note.
export function memoryChunks(text: string): string[] {
  const chars = [...text];
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += 810) {
    chunks.push(chars.slice(i, i + 900).join(""));
    if (i + 900 >= chars.length) break;
  }
  return chunks.length ? chunks : ["Saved personal context"];
}

export async function embedChunks(s: AppSettings, inputs: string[], signal?: AbortSignal): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < inputs.length; i += 16) vectors.push(...await embedTexts(s, inputs.slice(i, i + 16), signal));
  if (vectors.some((v) => v.length !== vectors[0].length)) throw new Error("Embedding dimensions changed within a batch");
  return vectors;
}

export function memoryDocument(m: MemoryEntry): string {
  return `${m.locator}\n${m.description}\nAliases: ${m.aliases.join(", ")}\nLast edited: ${new Date(m.modifiedAt).toISOString()}\n${m.content}`;
}
