// Per-message disclosure is ephemeral: transcripts and compaction keep the original user input.
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AppSettings } from "../shared/protocol";
import { memoryConfigured } from "./memory-config";
import { hashMemory, memorySnapshot } from "./memory";
import { discloseMemory, memoryConfigKey, recallMemory } from "./memory-retrieval";
import { st } from "./i18n";

export class MemoryContext {
  readonly read = new Map<string, string>();
  private cached: { key: string; text: string } | null = null;

  async inject(s: AppSettings, context: AgentMessage[], original: AgentMessage[], signal?: AbortSignal): Promise<AgentMessage[]> {
    if (!s.memoryEnabled || !memoryConfigured(s)) { this.cached = null; this.read.clear(); return context; }
    const users = original.filter((m) => m.role === "user").slice(-3);
    const latest = users.at(-1);
    if (!latest) return context;
    const textOf = (m: any): string => typeof m.content === "string" ? m.content : m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    // Keep the latest request dominant while resolving pronouns from the preceding turns.
    const query = users.slice(0, -1).map((m) => textOf(m).slice(-1500)).join("\n") + "\nLatest request: " + textOf(latest).slice(-9000);
    let key = hashMemory(JSON.stringify(latest)) + memoryConfigKey(s) + memorySnapshot();
    if (this.cached?.key !== key) {
      try {
        const recall = await recallMemory(s, query, { signal });
        key = hashMemory(JSON.stringify(latest)) + memoryConfigKey(s) + recall.snapshot;
        this.cached = { key, text: discloseMemory(recall, s.memoryMinScore, this.read) };
      } catch (e) { throw new Error(st("memoryFailed", { reason: e instanceof Error ? e.message : String(e) })); }
    }
    const overlay = this.cached!.text;
    const i = context.indexOf(latest);
    if (i < 0) return [...context, { role: "user", content: overlay, timestamp: Date.now() }];
    const content = (latest as any).content;
    const injected = { ...latest, content: typeof content === "string" ? `${overlay}\n\n${content}` : [{ type: "text", text: overlay }, ...content] } as AgentMessage;
    return context.map((m, index) => index === i ? injected : m);
  }
}
