import { Type } from "typebox";
import { proxiedFetch } from "../providers";
import { defineTool, text, type KestrelTool } from "./types";

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

function strip(s: string) {
  return decode(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

async function searchBing(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await proxiedFetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-Hans&count=15`, {
    headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });
  const html = await res.text();
  const out: SearchResult[] = [];
  const blocks = html.split(/<li class="b_algo"/).slice(1);
  for (const b of blocks) {
    const a = b.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    let url = decode(a[1]);
    const u = url.match(/[?&]u=a1([^&]+)/);
    if (u) {
      try {
        url = Buffer.from(u[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      } catch {}
    }
    const snip = b.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? b.match(/class="b_caption"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
    out.push({ title: strip(a[2]), url, snippet: strip(snip).slice(0, 300) });
  }
  return out;
}

async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await proxiedFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": UA },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });
  const html = await res.text();
  const out: SearchResult[] = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let url = decode(m[1]);
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    out.push({ title: strip(m[2]), url, snippet: strip(m[3]).slice(0, 300) });
  }
  return out;
}

export function createWebSearchTool(): KestrelTool {
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
      let results: SearchResult[] = [];
      let engine = "bing";
      const errors: string[] = [];
      try {
        results = await searchBing(params.query, signal);
      } catch (e: any) {
        errors.push(`bing: ${e.message}`);
      }
      if (!results.length) {
        engine = "duckduckgo";
        try {
          results = await searchDuckDuckGo(params.query, signal);
        } catch (e: any) {
          errors.push(`duckduckgo: ${e.message}`);
        }
      }
      if (!results.length) throw new Error(`No results. ${errors.join("; ")}`);
      const shown = results.slice(0, params.limit ?? 10);
      const body = shown.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
      return { content: text(body), details: { engine, results: shown } };
    },
  });
}
