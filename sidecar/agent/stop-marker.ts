// Some aborts happen between model messages, so the SDK emits no aborted assistant record. Store a
// zero-content marker for the transcript without adding a fake textual reply to future model context.
import type { AssistantMsg } from "../../shared/protocol";
import * as store from "../db";
import { emit } from "../hub";

export function appendStopMarker(sessionId: string, since: number) {
  const messages = store.loadMessages(sessionId);
  if (messages.slice(since).some(({ message: m }) => m.role === "assistant" && m.stopReason === "aborted")) return;
  const session = store.getSession(sessionId);
  if (!session) return;
  const marker: AssistantMsg = {
    role: "assistant", content: [], provider: session.providerId, model: session.modelId,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "aborted", timestamp: Date.now(),
  };
  const stored = store.appendMessage(sessionId, marker);
  emit({ type: "message_appended", sessionId, stored });
}
