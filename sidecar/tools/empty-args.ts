import type { KestrelTool } from "./types";

/**
 * Some OpenAI-compatible gateways (seen with a Codex subscription proxy) lose the arguments of tool calls
 * when the model issues several in one turn: every call arrives with `arguments: ""`. Validation then says
 * "must have required property" about `{}`, which tells the model nothing, so it usually repeats the same
 * parallel batch and fails again. This says what actually happened and what to do about it.
 */
export function emptyArgsHint(tool: { name: string; parameters?: any }): string {
  const required: string[] = tool.parameters?.required ?? [];
  return (
    `The call to ${tool.name} arrived with no arguments, but it needs: ${required.join(", ")}. ` +
    "Some providers drop the arguments of tool calls that are issued together in one turn. " +
    "Repeat this call by itself, with its arguments, and make only one tool call per turn until the results come back."
  );
}

/** Adds the hint above to a tool; tools with no required arguments are returned as they were. */
export function withEmptyArgsHint<T extends KestrelTool>(tool: T): T {
  const required: unknown = (tool.parameters as any)?.required;
  if (!Array.isArray(required) || required.length === 0) return tool;
  const prepare = tool.prepareArguments;
  return {
    ...tool,
    prepareArguments: (args: unknown) => {
      if (args && typeof args === "object" && !Array.isArray(args) && Object.keys(args).length === 0) throw new Error(emptyArgsHint(tool));
      return prepare ? prepare(args) : args;
    },
  } as T;
}
