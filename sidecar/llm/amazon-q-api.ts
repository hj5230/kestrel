// Amazon Q API-key transport. Discovery is authoritative; credentials never enter request diagnostics.
import { APICallError } from "@ai-sdk/provider";
import { EventStreamCodec } from "@smithy/core/event-streams";

export const AMAZON_Q_BASE_URL = "https://q.us-east-1.amazonaws.com/";
const decoder = new TextDecoder();
export const eventCodec = new EventStreamCodec((b) => decoder.decode(b), (s) => new TextEncoder().encode(s));

export interface AmazonQModelInfo {
  modelId: string;
  modelName?: string;
  supportedInputTypes?: string[];
  tokenLimits?: { maxInputTokens?: number; maxOutputTokens?: number };
  additionalModelRequestFieldsSchema?: {
    properties?: Record<string, any>;
  };
}

export interface AmazonQConfig {
  apiKey: string;
  baseURL?: string;
  headers?: Record<string, string>;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function amazonQEfforts(model: AmazonQModelInfo): { efforts: string[]; effortDefault?: string } {
  const props = model.additionalModelRequestFieldsSchema?.properties;
  const effort = props?.output_config?.properties?.effort ?? props?.reasoning?.properties?.effort;
  return {
    efforts: Array.isArray(effort?.enum) ? effort.enum.filter((v: unknown) => typeof v === "string") : [],
    effortDefault: typeof effort?.default === "string" ? effort.default : undefined,
  };
}

export class AmazonQClient {
  readonly url: string;
  private discovery?: { expires: number; task: Promise<AmazonQModelInfo[]> };

  constructor(readonly config: AmazonQConfig) {
    const url = new URL(config.baseURL || AMAZON_Q_BASE_URL);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error("Amazon Q requires a service root URL, such as https://q.us-east-1.amazonaws.com/");
    }
    this.url = url.href;
  }

  async request(operation: "ListAvailableModels" | "GenerateAssistantResponse", body: unknown, signal?: AbortSignal, extraHeaders?: Record<string, string | undefined>): Promise<Response> {
    const key = this.config.apiKey.trim();
    if (!key) throw new Error("Amazon Q API key is required");
    signal?.throwIfAborted();
    const headers = new Headers(this.config.headers);
    for (const [name, value] of Object.entries(extraHeaders ?? {})) if (value !== undefined) headers.set(name, value);
    headers.set("Content-Type", "application/x-amz-json-1.0");
    headers.set("Authorization", `Bearer ${key}`);
    headers.set("tokentype", "API_KEY");
    headers.set("X-Amz-Target", `${operation === "ListAvailableModels" ? "AmazonCodeWhispererService" : "AmazonCodeWhispererStreamingService"}.${operation}`);
    headers.set("x-amzn-codewhisperer-optout", "true");
    headers.set("amz-sdk-invocation-id", crypto.randomUUID());
    headers.set("amz-sdk-request", "attempt=1; max=1");
    headers.set("x-amzn-kiro-agent-mode", "vibe");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Amazon Q response headers timed out")), 90_000);
    let response: Response;
    try {
      response = await (this.config.fetch ?? fetch)(this.url, {
        method: "POST", headers, body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
        redirect: "error",
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const detail = (await response.text()).replaceAll(key, "[REDACTED]").slice(0, 2000);
      throw new APICallError({
        message: `Amazon Q HTTP ${response.status}: ${detail}`,
        url: this.url, statusCode: response.status, responseBody: detail,
        requestBodyValues: undefined,
      });
    }
    return response;
  }

  models(signal?: AbortSignal, refresh = false): Promise<AmazonQModelInfo[]> {
    if (refresh || !this.discovery || this.discovery.expires <= Date.now()) {
      const task = this.request("ListAvailableModels", { origin: "AI_EDITOR" }, AbortSignal.timeout(20_000))
        .then((r) => r.json()).then((data) => {
          const models = (data.models ?? []).filter((m: AmazonQModelInfo) => typeof m?.modelId === "string" && m.modelId.length > 0);
          if (!models.length) throw new Error("Amazon Q returned no models for this API key");
          return models as AmazonQModelInfo[];
        });
      this.discovery = { expires: Date.now() + 5 * 60_000, task };
      task.catch(() => { if (this.discovery?.task === task) this.discovery = undefined; });
    }
    return abortable(this.discovery.task, signal);
  }
}

/** Decode complete, CRC-checked AWS frames; never scan arbitrary payload text for JSON or tools. */
export async function* amazonQEvents(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal) {
  let buffer = new Uint8Array(0);
  try {
    while (true) {
      signal?.throwIfAborted();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const idle = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error("Amazon Q stream timed out")); void reader.cancel(); }, 300_000);
      });
      const result = await abortable(Promise.race([reader.read(), idle]), signal).finally(() => clearTimeout(timer));
      if (result.done) break;
      const joined = new Uint8Array(buffer.length + result.value.length);
      joined.set(buffer);
      joined.set(result.value, buffer.length);
      buffer = joined;
      while (buffer.length >= 12) {
        const view = new DataView(buffer.buffer, buffer.byteOffset);
        const length = view.getUint32(0);
        const headerLength = view.getUint32(4);
        if (length < 16 || length > 16 * 1024 * 1024 || headerLength > length - 16) throw new Error("Invalid Amazon Q EventStream frame length");
        if (buffer.length < length) break;
        const message = eventCodec.decode(buffer.subarray(0, length));
        buffer = buffer.subarray(length);
        const header = (name: string) => message.headers[name]?.value;
        const data = JSON.parse(decoder.decode(message.body));
        if (header(":message-type") === "exception" || header(":message-type") === "error") {
          throw new Error(`Amazon Q ${header(":exception-type") ?? header(":error-code") ?? "stream error"}: ${data.message ?? data.Message ?? JSON.stringify(data)}`);
        }
        yield { type: String(header(":event-type") ?? "unknown"), data };
      }
    }
    if (buffer.length) throw new Error("Truncated Amazon Q EventStream frame");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
