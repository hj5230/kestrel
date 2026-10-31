// The transcript as rows: messages flattened into items, then grouped per view (process steps folded together
// in compact view), with the per-turn totals a reply's details show.
import type { AssistantMsg, CompactionInfo, StoredMessage, ThinkingBlock, ToolCallBlock, ToolResultMsg, TranscriptView } from "@shared/protocol"
import { type ReplyMeta, type TurnStats } from "./messages"
import { type ToolState } from "./tool-call"
import { t, type MessageKey } from "@/lib/i18n"
import type { DetailState } from "@/lib/store"

export interface Runtime {
  results: Map<string, ToolResultMsg>
  running: DetailState["runningTools"]
  runActive: boolean
}

export type Step =
  | { k: "thinking"; key: string; block: ThinkingBlock; streaming: boolean }
  | { k: "tool"; key: string; block: ToolCallBlock; msg: AssistantMsg; streaming: boolean }

/** Questions to the user are part of the conversation, not process: they stay in place in every view. */
export type Ask = { k: "ask"; key: string; block: ToolCallBlock }

export type Item =
  | { k: "user"; key: string; stored: StoredMessage }
  | { k: "compaction"; key: string; c: CompactionInfo }
  | { k: "text"; key: string; text: string; streaming: boolean }
  | { k: "meta"; key: string; meta: ReplyMeta }
  | { k: "aborted"; key: string }
  | Ask
  | Step

export type Row =
  | Exclude<Item, Step | { k: "text" }>
  | { k: "text"; key: string; text: string; streaming: boolean; meta?: ReplyMeta }
  | { k: "group"; key: string; steps: Step[]; last: boolean }

export function toolState(step: Extract<Step, { k: "tool" }>, rt: Runtime): ToolState {
  const id = step.block.id
  const r = rt.results.get(id)
  if (r) {
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("")
    if (r.isError && /^The user denied|^Operation aborted/.test(text)) return "denied"
    return r.isError ? "error" : "done"
  }
  if (rt.running[id]) return "running"
  if (step.streaming) return "pending"
  if (rt.runActive && step.msg.stopReason === "toolUse") return "pending"
  return "interrupted"
}

export const freshTurn = (): TurnStats => ({ calls: 0, tools: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 })

export function assistantItems(msg: AssistantMsg, keyBase: string, streaming: boolean, seq = -1, turn: TurnStats = freshTurn()): Item[] {
  const out: Item[] = []
  const lastIdx = msg.content.length - 1
  msg.content.forEach((c, i) => {
    const key = `${keyBase}:${i}`
    const live = streaming && i === lastIdx
    if (c.type === "thinking") {
      if (c.thinking.trim()) out.push({ k: "thinking", key, block: c, streaming: live })
    } else if (c.type === "text") {
      if (c.text.trim()) out.push({ k: "text", key, text: c.text, streaming: live })
    } else if (c.type === "toolCall") {
      if (c.name === "ask_user") out.push({ k: "ask", key: c.id || key, block: c })
      else out.push({ k: "tool", key: c.id || key, block: c, msg, streaming })
    }
  })
  if (streaming) return out
  if (msg.stopReason === "aborted") out.push({ k: "aborted", key: `${keyBase}:aborted` })
  if (msg.stopReason !== "toolUse" && msg.content.some((c) => c.type === "text" && c.text.trim())) {
    out.push({ k: "meta", key: `${keyBase}:meta`, meta: { msg, seq, turn: { ...turn } } })
  }
  return out
}

export function buildItems(d: DetailState): Item[] {
  const items: Item[] = []
  const byCut = new Map<number, CompactionInfo[]>()
  for (const c of d.compactions) byCut.set(c.cutSeq, [...(byCut.get(c.cutSeq) ?? []), c])
  let maxSeq = -1
  let turn = freshTurn()
  for (const s of d.messages) {
    maxSeq = s.seq
    for (const c of byCut.get(s.seq) ?? []) items.push({ k: "compaction", key: `c${c.id}`, c })
    const m = s.message
    if (m.role === "user") {
      if (!m.merge) turn = freshTurn()
      items.push({ k: "user", key: `u${s.seq}`, stored: s })
    } else if (m.role === "assistant") {
      const u = m.usage
      turn = {
        calls: turn.calls + 1,
        tools: turn.tools + m.content.filter((c) => c.type === "toolCall").length,
        input: turn.input + u.input,
        output: turn.output + u.output,
        cacheRead: turn.cacheRead + u.cacheRead,
        cacheWrite: turn.cacheWrite + u.cacheWrite,
        cost: turn.cost + u.cost.total,
      }
      items.push(...assistantItems(m, `a${s.seq}`, false, s.seq, turn))
    }
  }
  for (const c of d.compactions) if (c.cutSeq > maxSeq) items.push({ k: "compaction", key: `c${c.id}`, c })
  if (d.streaming) items.push(...assistantItems(d.streaming, "stream", true))
  return items
}

export function attachMeta(rows: Row[]): Row[] {
  const out: Row[] = []
  for (const row of rows) {
    const prev = out[out.length - 1]
    if (row.k === "meta" && prev?.k === "text" && !prev.meta) prev.meta = row.meta
    else out.push(row.k === "text" ? { ...row } : row)
  }
  return out
}

export function toRows(items: Item[], view: TranscriptView): Row[] {
  if (view === "detailed" || view === "verbose") {
    return attachMeta(items.map((it) => (it.k === "thinking" || it.k === "tool" ? { k: "group", key: it.key, steps: [it], last: false } : it)))
  }
  const rows: Row[] = []
  let current: Step[] = []
  const flush = () => {
    if (current.length) rows.push({ k: "group", key: `g:${current[0].key}`, steps: current, last: false })
    current = []
  }
  for (const it of items) {
    if (it.k === "thinking" || it.k === "tool") current.push(it)
    else if (it.k === "meta" || it.k === "aborted") rows.push(it)
    else {
      flush()
      rows.push(it)
    }
  }
  flush()
  rows.splice(0, rows.length, ...attachMeta(rows))
  const lastGroup = rows.length && rows[rows.length - 1].k === "group" ? (rows[rows.length - 1] as Extract<Row, { k: "group" }>) : null
  if (lastGroup) lastGroup.last = true
  return rows
}

export const CATEGORY: Record<string, string> = {
  bash: "commands",
  bash_output: "commands",
  kill_shell: "commands",
  read: "reads",
  ls: "searches",
  glob: "searches",
  grep: "searches",
  search_sessions: "searches",
  read_session: "reads",
  edit: "edits",
  write: "edits",
  web_fetch: "web",
  web_search: "web",
  task: "subagents",
  memory_search: "memory",
  memory_read: "memory",
  memory_write: "memory",
  memory_delete: "memory",
  todo_write: "plan",
  ask_user: "questions",
}

export const ORDER = ["commands", "reads", "searches", "edits", "web", "subagents", "memory", "questions", "mcp", "other", "plan"]

export function plural(base: string, n: number) {
  return t(`group.${base}.${n === 1 ? "one" : "other"}` as MessageKey, { n })
}

export function describeGroup(steps: Step[]): string {
  const counts = new Map<string, number>()
  const editPaths = new Set<string>()
  for (const s of steps) {
    if (s.k !== "tool") continue
    const name = s.block.name
    const cat = name.startsWith("mcp__") ? "mcp" : (CATEGORY[name] ?? "other")
    if (cat === "edits") {
      editPaths.add(String(s.block.arguments?.path ?? s.key))
      counts.set("edits", editPaths.size)
    } else counts.set(cat, (counts.get(cat) ?? 0) + 1)
  }
  if (!counts.size) return t("group.thought")
  const parts = ORDER.filter((c) => counts.has(c)).map((c) => (c === "plan" ? t("group.plan") : plural(c, counts.get(c)!)))
  const text = parts.join(", ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}
