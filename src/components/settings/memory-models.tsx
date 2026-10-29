// Both endpoints are required. Configuration and service failures stay visible beside the saved notes.
import { useEffect, useState } from "preact/hooks"
import { toast } from "sonner"
import type { AppSettings, MemoryStatus } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { rpc } from "@/lib/api"
import { t, type MessageKey } from "@/lib/i18n"
import { updateSettings, memoryRev } from "@/lib/store"
import { Panel, Section } from "./layout"

export function MemoryModels({ s }: { s: AppSettings }) {
  const [embedding, setEmbedding] = useState(s.memoryEmbedding)
  const [reranker, setReranker] = useState(s.memoryReranker)
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [statusError, setStatusError] = useState("")
  useEffect(() => { setEmbedding(s.memoryEmbedding); setReranker(s.memoryReranker) }, [s.memoryEmbedding, s.memoryReranker])
  const load = () => rpc<MemoryStatus>("memory.status").then((v) => { setStatus(v); setStatusError("") }).catch((e) => setStatusError(e.message))
  useEffect(() => {
    let live = true
    const refresh = () => rpc<MemoryStatus>("memory.status").then((v) => { if (live) { setStatus(v); setStatusError("") } }).catch((e) => live && setStatusError(e.message))
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => { live = false; clearInterval(timer) }
  }, [s.memoryEnabled, s.memoryEmbedding, s.memoryReranker, memoryRev.value])
  const action = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true)
    try { await fn(); if (success) toast.success(success); await load() }
    catch (e: any) { toast.error(e.message); await load() }
    finally { setBusy(false) }
  }
  return (
    <Section title={t("memory.models")} desc={t("memory.modelsDesc")}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void action(() => updateSettings({ memoryEmbedding: embedding, memoryReranker: reranker }), t("memory.configSaved")) }}>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {(["embedding", "reranker"] as const).map((kind) => {
            const cfg = kind === "embedding" ? embedding : reranker
            const set = (patch: Partial<typeof cfg>) => kind === "embedding" ? setEmbedding((v) => ({ ...v, ...patch })) : setReranker((v) => ({ ...v, ...patch }))
            return (
              <Panel key={kind} className="min-w-0">
                <div className="grid gap-4 p-4">
                  <h3 className="text-sm font-semibold">{kind === "embedding" ? "Embedding" : "Reranker"}</h3>
                  <p className="text-xs text-muted-foreground">{t(kind === "embedding" ? "memory.embeddingDesc" : "memory.rerankerDesc")}</p>
                  {kind === "embedding" && <Field>
                    <FieldLabel htmlFor="memory-embedding-api">{t("memory.api")}</FieldLabel>
                    <Select value={embedding.api} onValueChange={(v) => setEmbedding((cur) => ({ ...cur, api: v as "ollama" | "openai" }))}>
                      <SelectTrigger id="memory-embedding-api" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ollama">Ollama /api/embed</SelectItem>
                        <SelectItem value="openai">OpenAI-compatible /v1/embeddings</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>}
                  <Field>
                    <FieldLabel htmlFor={`memory-${kind}-url`}>{t("memory.endpoint")}</FieldLabel>
                    <Input id={`memory-${kind}-url`} type="url" value={cfg.url} placeholder={kind === "embedding" ? "http://127.0.0.1:11434/api/embed" : "http://127.0.0.1:8081/v1/rerank"} onInput={(e) => set({ url: e.currentTarget.value })} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`memory-${kind}-model`}>{t("memory.modelName")}</FieldLabel>
                    <Input id={`memory-${kind}-model`} value={cfg.model} placeholder={kind === "embedding" ? "qwen3-embedding:0.6b" : "qwen3-reranker-0.6b"} onInput={(e) => set({ model: e.currentTarget.value })} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`memory-${kind}-key`}>{t("memory.apiKey")}</FieldLabel>
                    <Input id={`memory-${kind}-key`} type="password" autoComplete="new-password" value={cfg.apiKey} onInput={(e) => set({ apiKey: e.currentTarget.value })} />
                  </Field>
                </div>
              </Panel>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>{busy && <Spinner />}{t("common.save")}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => action(() => rpc("memory.test", { embedding, reranker }), t("memory.testPassed"))}>{t("memory.testModels")}</Button>
          <Button type="button" variant="outline" disabled={busy || !s.memoryEnabled || !s.memoryEmbedding.url || !s.memoryReranker.url} onClick={() => action(() => rpc("memory.rebuild"))}>{t("memory.reindex")}</Button>
          {!!status?.failed && <Button type="button" variant="outline" disabled={busy} onClick={() => action(() => rpc("memory.retry"))}>{t("memory.retry")}</Button>}
        </div>
      </form>
      <div role="status" className="grid gap-1 break-words rounded-lg border p-3 text-sm">
        <span>{status ? t(`memory.state.${status.state}` as MessageKey) : t("memory.checking")}</span>
        {status && <span className="text-xs text-muted-foreground">{t("memory.progress", { indexed: status.indexed, total: status.total, pending: status.pending, failed: status.failed })}</span>}
        {(statusError || status?.error) && <span className="text-xs text-destructive">{statusError || status?.error}</span>}
        {status?.saveError && <span className="text-xs text-destructive">{t("memory.saveError", { reason: status.saveError })}</span>}
        {!!status?.migrated && <span className="text-xs text-muted-foreground">{t("memory.migrated", { n: status.migrated })}</span>}
      </div>
    </Section>
  )
}
