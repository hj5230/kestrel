// Network tools: web_fetch reads a page, web_search (Tavily) finds pages. Neither runs JavaScript.
import { Type } from "typebox";
import { proxiedFetch } from "../providers";
import { defineTool, text, type KestrelTool, type ToolContext } from "./types";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decode(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9#]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? m);
}

export function htmlToMarkdown(html: string, base?: string): string {
  let s = html;
  const title = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const main = s.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
  if (main && main.length > 500) s = main;
  s = s
    .replace(/<(script|style|noscript|svg|iframe|template|head|nav|footer)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, t) => `\n\n${"#".repeat(Number(l))} ${t.replace(/<[^>]+>/g, "").trim()}\n\n`)
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => {
      const label = t.replace(/<[^>]+>/g, "").trim();
      if (!label) return "";
      let url = href;
      try {
        url = base ? new URL(href, base).href : href;
      } catch {}
      return url.startsWith("javascript:") ? label : `[${label}](${url})`;
    })
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(pre)[^>]*>([\s\S]*?)<\/pre>/gi, (_, __, t) => `\n\`\`\`\n${t.replace(/<[^>]+>/g, "")}\n\`\`\`\n`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => `\`${t.replace(/<[^>]+>/g, "")}\``)
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|tr|table|ul|ol|blockquote)>/gi, "\n\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, "");
  s = decode(s)
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return title ? `# ${decode(title)}\n\n${s}` : s;
}

export function createWebFetchTool(): KestrelTool {
  return defineTool({
    name: "web_fetch",
    label: "Fetch page",
    category: "network",
    description:
      "Fetch a URL and return its content. HTML is converted to Markdown; JSON and plain text are returned as-is. " +
      "Content is truncated to max_chars (default 40000). Does not run JavaScript and cannot access pages requiring login.",
    parameters: Type.Object({
      url: Type.String({ description: "Absolute http(s) URL" }),
      max_chars: Type.Optional(Type.Integer({ minimum: 1000, maximum: 200000 })),
    }),
    async execute(_id, params, signal) {
      let url = params.url.trim();
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      const res = await proxiedFetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.5" },
        redirect: "follow",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      });
      const type = res.headers.get("content-type") ?? "";
      const raw = await res.text();
      let body = /html/i.test(type) || /^\s*<(!doctype|html)/i.test(raw) ? htmlToMarkdown(raw, res.url) : raw;
      const max = params.max_chars ?? 40000;
      const truncated = body.length > max;
      if (truncated) body = body.slice(0, max) + `\n\n[Truncated: ${body.length - max} more characters]`;
      const header = `URL: ${res.url}\nStatus: ${res.status}\nContent-Type: ${type}\n\n`;
      if (!res.ok) throw new Error(header + body.slice(0, 2000));
      return { content: text(header + body), details: { url: res.url, status: res.status, chars: body.length, truncated } };
    },
  });
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const TAVILY_URL = "https://api.tavily.com/search";

/** Tavily puts the reason in `detail.error` (or a bare string) on failure. */
function tavilyError(status: number, raw: string) {
  let reason = "";
  try {
    const j = JSON.parse(raw);
    reason = typeof j?.detail === "string" ? j.detail : (j?.detail?.error ?? j?.error ?? "");
  } catch {}
  return new Error(`Tavily search failed (HTTP ${status})${reason ? `: ${reason}` : ""}`);
}

/** Only registered while a Tavily key is configured (see Runner.buildTools), so the model never sees a tool that cannot work. */
export function createWebSearchTool(ctx: Pick<ToolContext, "settings">): KestrelTool {
  return defineTool({
    name: "web_search",
    label: "Web search",
    category: "network",
    description:
      "Search the web and return a list of results (title, URL, snippet). Use web_fetch to read a result in full. " +
      "Include specific terms, product names or dates in the query for fresher results.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    }),
    async execute(_id, params, signal) {
      const key = ctx.settings().tavilyApiKey.trim();
      if (!key) throw new Error("Web search is not configured: no Tavily API key in settings.");
      const res = await proxiedFetch(TAVILY_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: params.query, max_results: params.limit ?? 10, search_depth: "basic" }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      });
      const raw = await res.text();
      if (!res.ok) throw tavilyError(res.status, raw);
      let data: any;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error("Tavily returned a response that is not JSON.");
      }
      const results: SearchResult[] = (Array.isArray(data?.results) ? data.results : [])
        .filter((r: any) => r?.url)
        .map((r: any) => ({
          title: String(r.title ?? r.url).replace(/\s+/g, " ").trim(),
          url: String(r.url),
          snippet: String(r.content ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
        }));
      if (!results.length) return { content: text("No results."), details: { results } };
      const body = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
      return { content: text(body), details: { results } };
    },
  });
}
