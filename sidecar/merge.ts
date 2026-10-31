// Merging one session into another. Transcripts can't be interleaved, and copying one onto the other would
// double the target's context with history it may already share, so the source is summarized instead: for a
// fork merged back into its source, only what happened after the fork point; for any other session, all of
// it. The summary is added to the target as a note the model reads with the next message, and the source is
// archived with a pointer to where it went, so nothing is lost.
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ChatMessage, SessionInfo } from "../shared/protocol";
import { getRunner, peekRunner } from "./agent/runner";
import { MERGE_PROMPT, summarize } from "./agent/compaction";
import * as store from "./db";
import { st } from "./i18n";
import { costOf, sideModel } from "./side-model";

export async function mergeSession(sourceId: string, targetId: string, instructions?: string): Promise<{ source: SessionInfo; target: SessionInfo }> {
  if (sourceId === targetId) throw new Error(st("mergeSelf"));
  const src = store.getSession(sourceId);
  const dst = store.getSession(targetId);
  if (!src || !dst || src.kind !== "main" || dst.kind !== "main") throw new Error(st("sessionNotFound"));
  if (peekRunner(sourceId)?.busy || peekRunner(targetId)?.busy) throw new Error(st("sessionBusy"));

  const stored = store.loadMessages(sourceId);
  const branch = src.forkOf === targetId && src.forkSeq !== null;
  const from = branch ? src.forkSeq! + 1 : 0;
  // A whole session merged elsewhere starts from its latest compaction summary, like the session itself would.
  const compaction = branch ? null : store.listCompactions(sourceId).at(-1) ?? null;
  const start = Math.max(from, compaction?.cutSeq ?? 0);
  const messages = stored.filter((m) => m.seq >= start).map((m) => m.message as AgentMessage);
  if (!messages.some((m: any) => m.role === "user" || m.role === "assistant")) throw new Error(st("nothingToMerge"));

  const settings = store.getSettings();
  const side = sideModel(settings.compactModel, dst);
  const { summary, usage } = await summarize({
    providerId: side.providerId,
    modelId: side.modelId,
    contextWindow: side.config.contextWindow,
    previousSummary: compaction?.summary ?? null,
    messages,
    instructions,
    system: MERGE_PROMPT,
  });
  if (!summary) throw new Error(st("emptySummary"));
  const cost = costOf(usage, side.config);
  store.recordUsage({ sessionId: targetId, providerId: side.providerId, modelId: side.modelId, ...usage, cost, purpose: "merge" });
  store.addSessionUsage(targetId, { ...usage, cost }, null);

  const title = src.title || st("untitled");
  const count = stored.filter((m) => m.seq >= from && (m.message.role === "user" || m.message.role === "assistant")).length;
  const note: ChatMessage = {
    role: "user",
    content: `<merged_session title="${title.replace(/"/g, "'")}">\n${summary}\n</merged_session>\n\n${st("mergedNote")}`,
    merge: { sessionId: sourceId, title, messages: count, summary },
    timestamp: Date.now(),
  };
  getRunner(targetId).appendNote(note);
  store.updateSession(sourceId, { archived: true, mergedInto: targetId }, true);
  return { source: store.getSession(sourceId)!, target: store.getSession(targetId)! };
}
