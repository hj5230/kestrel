// The task tool: a child session that runs a prompt to the end and reports back to the agent that started it.
import type { SubagentDetails } from "../../shared/protocol";
import { createSession } from "../sessions";
import type { SubagentRequest } from "../tools/types";
import { SessionRunner } from "./session-runner";
import { textOf, brief } from "./text";
import { runners } from "./runner";

export async function runSubagent(runner: SessionRunner, req: SubagentRequest, signal: AbortSignal | undefined, onProgress: (d: SubagentDetails) => void): Promise<string> {
  const parent = runner.info();
  const childInfo = createSession({
    kind: "subagent",
    parentId: runner.id,
    title: req.description,
    cwd: parent.cwd,
    providerId: parent.providerId,
    modelId: parent.modelId,
    thinking: parent.thinking,
    permissionMode: parent.permissionMode,
  });
  const child = new SessionRunner(childInfo, runner);
  runners.set(childInfo.id, child);
  let toolCalls = 0;
  let last = "";
  const report = (status: SubagentDetails["status"]) => onProgress({ sessionId: childInfo.id, status, lastActivity: last, toolCalls });
  report("running");
  const unsub = child.agent.subscribe((e: any) => {
    if (e.type === "tool_execution_start") {
      toolCalls++;
      last = brief(e.toolName, e.args);
      report("running");
    } else if (e.type === "message_end" && e.message.role === "assistant") {
      const t = textOf(e.message);
      if (t) {
        last = t.split("\n")[0].slice(0, 120);
        report("running");
      }
    }
  });
  const onAbort = () => child.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await child.sendAndWait(req.prompt);
    const msgs = child.agent.state.messages;
    const final = msgs[msgs.length - 1] as any;
    if (signal?.aborted) throw new Error("Subagent aborted");
    if (final?.role === "assistant" && final.stopReason === "error") {
      report("error");
      throw new Error(`Subagent failed: ${final.errorMessage}`);
    }
    report("done");
    const text = textOf(final);
    return text || "(The subagent finished without a text report.)";
  } finally {
    unsub();
    signal?.removeEventListener("abort", onAbort);
    runners.delete(childInfo.id);
  }
}
