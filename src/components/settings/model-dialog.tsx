// Editing one model: context window, output limit, prices, vision, reasoning efforts, and resetting to the catalog.
import { useEffect, useState } from "preact/hooks"
import { toast } from "sonner"
import type { ModelConfig } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { rpc } from "@/lib/api"
import { formatTokens } from "@/lib/format"
import { refreshProviders } from "@/lib/store"
import { t } from "@/lib/i18n"

/**
 * A number field that keeps what is typed as text ("0.", "0.00") and hands up the number. Any decimal
 * is valid: a fixed step made values like 0.008 "invalid", and a controlled number would rewrite
 * the text mid-typing.
 */
export function NumField({ value, onValue, as: Comp = Input }: { value: number; onValue: (n: number) => void; as?: typeof Input }) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    if (Number(text) !== value) setText(String(value))
  }, [value])
  return (
    <Comp
      type="number"
      step="any"
      min={0}
      inputMode="decimal"
      value={text}
      onInput={(e) => {
        setText(e.currentTarget.value)
        const n = Number(e.currentTarget.value)
        onValue(e.currentTarget.value === "" || !Number.isFinite(n) ? 0 : n)
      }}
    />
  )
}

export function parseEfforts(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean)
}

export function ModelDialog({ model, onClose }: { model: ModelConfig | null; onClose: () => void }) {
  const [m, setM] = useState<ModelConfig | null>(model)
  const [effortsText, setEffortsText] = useState("")
  const [filling, setFilling] = useState(false)
  const [preview, setPreview] = useState<ModelConfig | null>(null)
  const [automatic, setAutomatic] = useState(false)
  useEffect(() => {
    setM(model)
    setPreview(null)
    setAutomatic(false)
    setEffortsText((model?.efforts ?? []).join(", "))

  }, [model])
  if (!m) return null
  const set = (patch: Partial<ModelConfig>) => setM({ ...m, ...patch })
  const setCost = (patch: Partial<ModelConfig["cost"]>) => setM({ ...m, cost: { ...m.cost, ...patch } })
  const save = async (e: Event) => {
    e.preventDefault()
    try {
      await rpc("models.upsert", { ...m, efforts: parseEfforts(effortsText), resetAutomatic: automatic })
      await refreshProviders()
      onClose()
    } catch (err: any) {
      toast.error(err.message)
    }
  }
  const fill = async () => {
    setFilling(true)
    try {
      const d = await rpc<ModelConfig>("models.defaults", { providerId: m.providerId, id: m.id, name: m.name, metadataSource: m.metadataSource })
      setPreview(d)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setFilling(false)
    }
  }
  return (
    <Dialog open={!!model} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={save} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("models.params")}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{m.id}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel>{t("models.displayName")}</FieldLabel>
              <Input value={m.name} onInput={(e) => set({ name: e.currentTarget.value })} />
            </Field>
            <Field>
              <FieldLabel>{t("models.metadataSource")}</FieldLabel>
              <Select value={m.metadataSource ?? "catalog"} onValueChange={(value) => { set({ metadataSource: value as "catalog" | "codex" }); setPreview(null) }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="catalog">{t("models.sourceCatalog")}</SelectItem>
                  <SelectItem value="codex">{t("models.sourceCodex")}</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>{t("models.metadataDesc")}</FieldDescription>
              <Button type="button" variant="outline" disabled={filling} onClick={fill}>{t("models.previewMetadata")}</Button>
              {preview && <div className="grid gap-2 rounded-md border p-3 text-sm">
                <p>{t("models.metadataPreview", { context: formatTokens(preview.contextWindow), output: formatTokens(preview.maxTokens), input: preview.cost.input, price: preview.cost.output })}</p>
                <p className="break-words">{preview.efforts?.join(", ") || t("picker.effortDefault")}</p>
                <Button type="button" variant="secondary" onClick={() => {
                  setM({ ...m, ...preview, name: m.name, enabled: m.enabled, locked: [] })
                  setEffortsText((preview.efforts ?? []).join(", "))
                  setAutomatic(true)
                  setPreview(null)
                }}>{t("models.applyAutomatic")}</Button>
              </div>}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>{t("models.contextWindow")}</FieldLabel>
                <NumField value={m.contextWindow} onValue={(n) => set({ contextWindow: n })} />
              </Field>
              <Field>
                <FieldLabel>{t("models.maxOutput")}</FieldLabel>
                <NumField value={m.maxTokens} onValue={(n) => set({ maxTokens: n })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["input", t("models.priceInput")],
                  ["output", t("models.priceOutput")],
                  ["cacheRead", t("models.priceCacheRead")],
                  ["cacheWrite", t("models.priceCacheWrite")],
                ] as const
              ).map(([k, label]) => (
                <Field key={k}>
                  <FieldLabel>{label}</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>$</InputGroupAddon>
                    <NumField as={InputGroupInput} value={m.cost[k]} onValue={(n) => setCost({ [k]: n })} />
                    <InputGroupAddon align="inline-end" className="text-xs">
                      / 1M
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
              ))}
            </div>
            <div className="flex gap-6">
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox checked={m.reasoning} onCheckedChange={(v) => set({ reasoning: !!v })} />
                {t("models.reasoning")}
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox checked={m.vision} onCheckedChange={(v) => set({ vision: !!v })} />
                {t("models.vision")}
              </Label>
            </div>
            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel>{t("models.efforts")}</FieldLabel>
              </div>
              <Input className="font-mono text-xs" value={effortsText} placeholder="low, high, max" onInput={(e) => setEffortsText(e.currentTarget.value)} />
              <FieldDescription>{t("models.effortsDesc")}</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("common.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
