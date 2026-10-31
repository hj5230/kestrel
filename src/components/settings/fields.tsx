// Inputs the settings tabs share: fields that save on blur, a one-entry-per-line list, a model row, and save().
import { useEffect, useState } from "preact/hooks"
import { toast } from "sonner"
import type { AppSettings } from "@shared/protocol"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Row } from "@/components/settings/layout"
import { enabledModels, providerName, updateSettings } from "@/lib/store"

export function save(patch: Partial<AppSettings>) {
  updateSettings(patch).catch((e) => toast.error(e.message))
}

export function BlurInput({ value, onCommit, className, ...rest }: { value: string; onCommit: (v: string) => void; className?: string; [k: string]: any }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return <Input {...rest} className={className} value={v} onInput={(e) => setV(e.currentTarget.value)} onBlur={() => v !== value && onCommit(v)} />
}

export function LinesEditor({ value, onCommit, placeholder, rows = 3 }: { value: string[]; onCommit: (v: string[]) => void; placeholder?: string; rows?: number }) {
  const [v, setV] = useState(value.join("\n"))
  useEffect(() => setV(value.join("\n")), [value.join("\n")])
  return (
    <Textarea
      rows={rows}
      value={v}
      placeholder={placeholder}
      className="font-mono text-xs"
      onInput={(e) => setV(e.currentTarget.value)}
      onBlur={() => {
        const next = v
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
        if (next.join("\n") !== value.join("\n")) onCommit(next)
      }}
    />
  )
}

/** A textarea that saves when it loses focus. */
/** A model picker for a background task; an empty value means the `none` choice. */
export function ModelRow({ label, desc, value, none, onChange }: { label: string; desc?: string; value: string; none: string; onChange: (v: string) => void }) {
  return (
    <Row label={label} desc={desc}>
      <Select value={value || "__none"} onValueChange={(v) => onChange(v === "__none" ? "" : v)}>
        <SelectTrigger size="sm" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">{none}</SelectItem>
          {enabledModels.value.map((m) => (
            <SelectItem key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
              {m.name} · {providerName(m.providerId)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  )
}

export function BlurTextarea({ value, onCommit, placeholder, rows = 3 }: { value: string; onCommit: (v: string) => void; placeholder?: string; rows?: number }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return <Textarea rows={rows} value={v} placeholder={placeholder} className="text-sm" onInput={(e) => setV(e.currentTarget.value)} onBlur={() => v.trim() !== value.trim() && onCommit(v.trim())} />
}
