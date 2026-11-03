// Live questions retain local selections across reloads, scoped to the paired host and request.
import { useState } from "preact/hooks"
import { draftKeyForHost } from "@/lib/store"
import { CheckIcon, CircleHelpIcon } from "lucide-react"
import { toast } from "sonner"
import type { AskDetails, Question, QuestionAnswer, QuestionRequest } from "@shared/protocol"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { rpc } from "@/lib/api"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface Draft {
  picked: string[]
  other: string
}

const answered = (d: Draft | undefined) => !!d && (d.picked.length > 0 || d.other.trim().length > 0)

function OptionRow({ q, option, on, onToggle }: { q: Question; option: Question["options"][number]; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role={q.allowMultiple ? "checkbox" : "radio"}
      aria-checked={on}
      onClick={onToggle}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors pointer-coarse:min-h-11",
        on ? "border-primary bg-primary/5" : "hover:bg-muted/60",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center border",
          q.allowMultiple ? "rounded-[4px]" : "rounded-full",
          on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
        )}
      >
        {on && <CheckIcon className="size-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          {option.label}
          {option.recommended && (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
              {t("ask.recommended")}
            </Badge>
          )}
        </span>
        {option.description && <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>}
      </span>
    </button>
  )
}

/** The live question, in place in the transcript. readOnly: a subagent's transcript, where nobody can answer. */
export function QuestionCard({ req, readOnly }: { req: QuestionRequest; readOnly?: boolean }) {
  const [busy, setBusy] = useState(false)
  const key = draftKeyForHost(`question:${req.sessionId}:${req.id}`)
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "{}")
      return Object.fromEntries(Object.entries(value).filter(([, v]: [string, any]) => Array.isArray(v?.picked) && v.picked.every((x: unknown) => typeof x === "string") && typeof v.other === "string")) as Record<string, Draft>
    } catch { return {} }
  })
  const draft = (q: Question): Draft => drafts[q.id] ?? { picked: [], other: "" }
  const set = (q: Question, next: Draft) => setDrafts((d) => {
    const value = { ...d, [q.id]: next }
    try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
    return value
  })
  const ready = req.questions.every((q) => answered(drafts[q.id]))

  const toggle = (q: Question, id: string) => {
    const cur = draft(q)
    if (q.allowMultiple) set(q, { ...cur, picked: cur.picked.includes(id) ? cur.picked.filter((x) => x !== id) : [...cur.picked, id] })
    // single choice: picking an option replaces any typed answer, and the other way round
    else set(q, { picked: cur.picked[0] === id ? [] : [id], other: "" })
  }

  const send = async (answers: QuestionAnswer[] | null) => {
    setBusy(true)
    try {
      await rpc("questions.respond", { id: req.id, answers })
      try { localStorage.removeItem(key) } catch {}
    } catch (e: any) {
      toast.error(e.message)
      setBusy(false)
    }
  }
  const submit = () => {
    if (!ready || busy) return
    send(req.questions.map((q) => ({ questionId: q.id, optionIds: draft(q).picked, other: draft(q).other.trim() || undefined })))
  }

  return (
    <form
      className="overflow-hidden rounded-xl border border-primary/40 bg-card shadow-sm ring-4 ring-primary/10"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="flex items-center gap-2 border-b bg-primary/10 px-4 py-2.5">
        <CircleHelpIcon className="size-4 text-primary" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{req.title || t("ask.title")}</span>
      </div>
      <div className="grid gap-4 px-4 py-3">
        {req.questions.map((q) => {
          const cur = draft(q)
          return (
            <fieldset key={q.id} className="grid gap-2" disabled={busy || readOnly}>
              <legend className="mb-0.5 text-sm font-medium">
                {q.prompt}
                {q.allowMultiple && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{t("ask.multiple")}</span>}
              </legend>
              <div role={q.allowMultiple ? "group" : "radiogroup"} className="grid gap-1.5">
                {q.options.map((o) => (
                  <OptionRow key={o.id} q={q} option={o} on={cur.picked.includes(o.id)} onToggle={() => toggle(q, o.id)} />
                ))}
              </div>
              <Input
                value={cur.other}
                placeholder={t("ask.other")}
                onInput={(e) => set(q, { picked: q.allowMultiple ? cur.picked : [], other: e.currentTarget.value })}
              />
            </fieldset>
          )
        })}
      </div>
      <div className="flex items-center gap-2 border-t px-3 py-2.5">
        <Button size="sm" type="submit" disabled={!ready || busy || readOnly}>
          {t("ask.submit")}
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" type="button" disabled={busy || readOnly} onClick={() => send(null)}>
          {t("ask.dismiss")}
        </Button>
      </div>
    </form>
  )
}

/** What was asked and answered, for the transcript once the question is closed. */
export function QuestionSummary({ details, running }: { details?: AskDetails; running?: boolean }) {
  // Stored records come from older versions and from failed calls too: never assume their shape.
  const questions = Array.isArray(details?.questions) ? details.questions : []
  if (!details || !questions.length) return null
  const answers = Array.isArray(details.answers) ? details.answers : null
  return (
    <div className="rounded-xl border bg-card px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <CircleHelpIcon className="size-3.5" />
        {details.title || t("ask.title")}
        {!answers && !running && <span className="font-normal">· {t("ask.dismissed")}</span>}
      </div>
      <dl className="grid gap-1.5">
        {questions.map((q) => {
          const a = answers?.find((x) => x.questionId === q.id)
          const parts = [
            ...(a?.optionIds ?? []).map((id) => q.options?.find((o) => o.id === id)?.label).filter((l): l is string => !!l),
            ...(a?.other ? [a.other] : []),
          ]
          return (
            <div key={q.id} className="text-[13px]">
              <dt className="text-muted-foreground">{q.prompt}</dt>
              <dd className={cn("font-medium", !parts.length && "font-normal text-muted-foreground")}>{parts.length ? parts.join(" · ") : "—"}</dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}
