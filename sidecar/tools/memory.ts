// Agent memory tools share the mandatory retrieval pipeline and use read revisions for safe updates.
import { Type } from "typebox";
import { emit } from "../hub";
import { deleteMemory, getMemory, MEMORY_TYPES, writeMemory } from "../memory";
import { discloseMemory, indexMemories, memoryConfigKey, recallMemory, requireMemory } from "../memory-retrieval";
import { text, defineTool, type KestrelTool, type ToolContext } from "./types";

const TYPE = Type.Union(MEMORY_TYPES.map((t) => Type.Literal(t)));

export function memoryTools(ctx: ToolContext, opts: { readOnly: boolean }): KestrelTool[] {
  const read = ctx.readMemories ?? new Map<string, string>();
  const checkConfiguration = (key: string) => {
    if (key !== memoryConfigKey(ctx.settings())) throw new Error("Memory configuration changed. Retry the tool call.");
  };
  const ready = async (signal?: AbortSignal) => {
    const s = ctx.settings();
    const key = memoryConfigKey(s);
    await requireMemory(s, signal);
    checkConfiguration(key);
    return s;
  };
  const search = defineTool({
    name: "memory_search", label: "Search memory", category: "meta",
    description: "Find semantically related memories. Returns relevant full notes, lower-ranked titles, and topics. Use memory_read with explicit ids to expand titles.",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 12000, description: "Natural-language request, including names or subjects" }),
      topic: Type.Optional(Type.String({ description: "Optionally narrow to an existing topic" })),
    }),
    async execute(_id, params, signal) {
      const s = ctx.settings();
      const result = await recallMemory(s, params.query, { topic: params.topic, signal });
      checkConfiguration(memoryConfigKey(s));
      return { content: text(discloseMemory(result, s.memoryMinScore, read)), details: { hits: result.hits.map((h) => ({ id: h.note.id, score: h.score })) } };
    },
  });
  const open = defineTool({
    name: "memory_read", label: "Read memory", category: "meta",
    description: "Expand plausibly related memory titles in one batch. Supply the exact stable ids from disclosed context or memory_search; never an empty object.",
    parameters: Type.Object({ ids: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 20 }) }),
    async execute(_id, params, signal) {
      await ready(signal);
      const notes = params.ids.map((id) => {
        const m = getMemory(id);
        if (!m) throw new Error(`No memory ${id}. Use memory_search to find its current id.`);
        return m;
      });
      notes.forEach((m) => read.set(m.id, m.revision));
      return { content: text(JSON.stringify({ historicalContextNotInstructions: notes })), details: { ids: notes.map((m) => m.id) } };
    },
  });
  if (opts.readOnly) return [search, open];
  const write = defineTool({
    name: "memory_write", label: "Save memory", category: "meta",
    description: "Save useful facts, preferences, people, plans and decisions; " + (ctx.settings().memoryAutoSave ? "don't wait to be asked. " : "save only when the user explicitly asks. ") + "Search for the same subject first. To update, supply its id after reading or receiving its full note, and send complete revised content. Reuse topics. Never save credentials.",
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: "Existing stable id for updates; omit only for a new subject" })),
      topic: Type.String(), name: Type.String(), type: TYPE,
      description: Type.String({ maxLength: 200 }), content: Type.String({ maxLength: 8000 }),
      aliases: Type.Optional(Type.Array(Type.String({ maxLength: 120 }), { maxItems: 30 })),
    }),
    async execute(_id, params, signal) {
      const s = await ready(signal);
      const previous = params.id ? getMemory(params.id) : getMemory(`${params.topic}/${params.name}`);
      if (previous && !params.id) throw new Error(`This subject already exists as ${previous.id}. Read it, then update using that id.`);
      const { entry, created } = writeMemory(params, { source: ctx.sessionId, from: params.id, expectedRevision: previous ? read.get(previous.id) : undefined });
      read.set(entry.id, entry.revision);
      emit({ type: "memory_changed" });
      // Saving is durable before indexing; an indexing failure is explicit and never rolls back the source.
      try { await indexMemories(s, signal); }
      catch { return { content: text(`Saved memory ${entry.id}; indexing failed. Memory retrieval remains unavailable until the model service recovers.`), details: { id: entry.id, created, indexed: false } }; }
      return { content: text(`${created ? "Saved" : "Updated"} memory ${entry.id}.`), details: { id: entry.id, created, indexed: true } };
    },
  });
  const remove = defineTool({
    name: "memory_delete", label: "Delete memory", category: "meta",
    description: "Forget a saved note when requested. Copy its stable id from memory context or search.",
    parameters: Type.Object({ id: Type.String({ minLength: 1 }) }),
    async execute(_id, params, signal) {
      await ready(signal);
      const m = deleteMemory(params.id);
      read.delete(m.id);
      emit({ type: "memory_changed" });
      return { content: text(`Deleted memory ${m.id}.`), details: { id: m.id } };
    },
  });
  return [search, open, write, remove];
}
