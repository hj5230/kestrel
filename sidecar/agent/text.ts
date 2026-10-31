// Small readers and formatters over messages and attachments that several runner modules share.
import { type AgentMessage } from "@mariozechner/pi-agent-core";
import type { FileAttachment } from "../../shared/protocol";

/** A block the transcript shows; reasoning that arrives without text (redacted or hidden) shows nothing yet. */
export function visibleBlock(c: any): boolean {
  if (c.type === "text") return !!c.text.trim();
  if (c.type === "thinking") return !!c.thinking.trim();
  return c.type === "toolCall";
}

export function textOf(m: AgentMessage | undefined): string {
  if (!m || (m as any).role !== "assistant") return "";
  return (m as any).content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n")
    .trim();
}

export function brief(toolName: string, args: any): string {
  if (!args) return toolName;
  const v = args.command ?? args.path ?? args.pattern ?? args.query ?? args.url ?? args.description ?? args.name;
  return v ? `${toolName} ${String(v).slice(0, 80)}` : toolName;
}

export function usageCost(u: any) {
  return {
    input: u?.input ?? 0,
    output: u?.output ?? 0,
    cacheRead: u?.cacheRead ?? 0,
    cacheWrite: u?.cacheWrite ?? 0,
    cost: u?.cost?.total ?? 0,
  };
}

export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

export function fileAttachmentMarkdown(files: FileAttachment[]): string {
  return files
    .map(
      (file) =>
        `[Attached file]\n- path: ${file.path}\n- name: ${file.name}\n- type: ${file.mimeType || "application/octet-stream"}\n- size: ${formatFileSize(file.size)}`,
    )
    .join("\n\n");
}
