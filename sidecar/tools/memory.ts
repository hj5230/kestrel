// Tools for the agent's cross-session notes (see ../memory.ts). All are category "meta": writing a note
// doesn't need an approval prompt, since the user sees every change in the transcript and can undo it in Settings → Memory.
import { Type } from "typebox";
import { emit } from "../hub";
import { ageLabel, deleteMemory, getMemory, MEMORY_TYPES, searchMemories, writeMemory } from "../memory";
import { text, defineTool, type KestrelTool, type ToolContext } from "./types";

const TYPE = Type.Union(MEMORY_TYPES.map((t) => Type.Literal(t)));

export function createMemorySearchTool(): KestrelTool {
  return defineTool({
    name: "memory_search",
    label: "Search memory",
    category: "meta",
    description:
      "Find saved notes by keywords (matched against id, description and content). Leave query empty to list the most recent notes, " +
      "optionally within one topic. Returns ids and descriptions; open one with memory_read.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Keywords; any match counts, more matches rank higher" })),
      topic: Type.Optional(Type.String({ description: "Only notes in this topic" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    }),
    async execute(_id, params) {
      const hits = searchMemories(params.query ?? "", { topic: params.topic, limit: params.limit });
      if (!hits.length) return { content: text("No matching notes."), details: { hits: [] } };
      const body = hits.map((m) => `- ${m.id} [${m.type}] ${m.description} (${ageLabel(m.modifiedAt)})`).join("\n");
      return { content: text(body), details: { hits } };
    },
  });
}

export function createMemoryReadTool(): KestrelTool {
  return defineTool({
    name: "memory_read",
    label: "Read memory",
    category: "meta",
    description: "Read one saved note in full by its id (topic/name, as listed in the memory index or by memory_search).",
    parameters: Type.Object({ id: Type.String({ description: "topic/name" }) }),
    async execute(_id, params) {
      const m = getMemory(params.id);
      if (!m) throw new Error(`No memory ${params.id}. Use memory_search to find the right id.`);
      const head = `${m.id} [${m.type}] saved ${ageLabel(m.modifiedAt)}\n${m.description}\n\n`;
      return { content: text(head + m.content), details: { id: m.id } };
    },
  });
}

export function createMemoryWriteTool(ctx: ToolContext): KestrelTool {
  return defineTool({
    name: "memory_write",
    label: "Save memory",
    category: "meta",
    description:
      "Save a note that future sessions should know, or replace an existing one (same topic and name). " +
      "To update a note, memory_read it first and send its full revised content: this replaces the old content entirely. " +
      "Keep notes short and about one thing. Never store secrets, tokens or passwords.",
    parameters: Type.Object({
      topic: Type.String({ description: "Short lowercase category, e.g. preferences, workflow, people. Reuse an existing topic when one fits." }),
      name: Type.String({ description: "Short identifier within the topic, e.g. prefers-pnpm" }),
      type: TYPE,
      description: Type.String({ description: "One line (under 200 characters) saying what the note is; shown in the index to decide when to open it" }),
      content: Type.String({ description: "The note itself. Lead with the fact, then why it matters or how to apply it." }),
    }),
    async execute(_id, params) {
      const { entry, created } = writeMemory(params, { source: ctx.sessionId });
      emit({ type: "memory_changed" });
      return {
        content: text(`${created ? "Saved" : "Updated"} memory ${entry.id}.`),
        details: { id: entry.id, created },
      };
    },
  });
}

export function createMemoryDeleteTool(): KestrelTool {
  return defineTool({
    name: "memory_delete",
    label: "Delete memory",
    category: "meta",
    description: "Delete a saved note that is wrong, obsolete or that the user asked you to forget. Use the id from the index.",
    parameters: Type.Object({ id: Type.String({ description: "topic/name" }) }),
    async execute(_id, params) {
      const m = deleteMemory(params.id);
      emit({ type: "memory_changed" });
      return { content: text(`Deleted memory ${m.id}.`), details: { id: m.id } };
    },
  });
}

/** Subagents get the read tools only: parallel agents writing the same notes is how a store gets scrambled. */
export function memoryTools(ctx: ToolContext, opts: { readOnly: boolean }): KestrelTool[] {
  const read = [createMemorySearchTool(), createMemoryReadTool()];
  return opts.readOnly ? read : [...read, createMemoryWriteTool(ctx), createMemoryDeleteTool()];
}
