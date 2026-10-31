// Adding or editing one MCP server (stdio command or URL, env and headers), and importing a JSON config.
import { useEffect, useState } from "preact/hooks"
import { toast } from "sonner"
import type { McpServerConfig } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { rpc } from "@/lib/api"
import { t } from "@/lib/i18n"

export const kvToText = (o: Record<string, string>, sep: string) =>
  Object.entries(o)
    .map(([k, v]) => `${k}${sep}${v}`)
    .join("\n")

export function textToKv(t: string, sep: string) {
  const out: Record<string, string> = {}
  for (const line of t.split("\n")) {
    const i = line.indexOf(sep)
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + sep.length).trim()
  }
  return out
}

export function splitArgs(s: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

export const quote = (a: string) => (/\s/.test(a) ? `"${a}"` : a)

export function ServerDialog({ open, server, onClose }: { open: boolean; server: McpServerConfig | null; onClose: () => void }) {
  const [name, setName] = useState("")
  const [transport, setTransport] = useState<McpServerConfig["transport"]>("stdio")
  const [command, setCommand] = useState("")
  const [env, setEnv] = useState("")
  const [url, setUrl] = useState("")
  const [headers, setHeaders] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(server?.name ?? "")
    setTransport(server?.transport ?? "stdio")
    setCommand(server ? [server.command, ...server.args].filter(Boolean).map(quote).join(" ") : "")
    setEnv(kvToText(server?.env ?? {}, "="))
    setUrl(server?.url ?? "")
    setHeaders(kvToText(server?.headers ?? {}, ": "))
  }, [open, server])

  const save = async (e: Event) => {
    e.preventDefault()
    if (!name.trim()) return toast.error(t("mcp.nameRequired"))
    const parts = splitArgs(command)
    setSaving(true)
    try {
      await rpc("mcp.upsert", {
        id: server?.id ?? "",
        name: name.trim(),
        transport,
        command: transport === "stdio" ? (parts[0] ?? "") : "",
        args: transport === "stdio" ? parts.slice(1) : [],
        env: textToKv(env, "="),
        url: transport === "stdio" ? "" : url.trim(),
        headers: textToKv(headers, ":"),
        enabled: server?.enabled ?? true,
      })
      onClose()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{server ? t("mcp.edit") : t("mcp.add")}</DialogTitle>
            <DialogDescription>{t("mcp.dialogDesc")}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel>{t("common.name")}</FieldLabel>
              <Input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="filesystem" />
            </Field>
            <Field>
              <FieldLabel>{t("mcp.transport")}</FieldLabel>
              <ToggleGroup type="single" variant="outline" size="sm" value={transport} onValueChange={(v) => v && setTransport(v as any)} className="justify-start">
                <ToggleGroupItem value="stdio" className="px-3">stdio</ToggleGroupItem>
                <ToggleGroupItem value="http" className="px-3">HTTP</ToggleGroupItem>
                <ToggleGroupItem value="sse" className="px-3">SSE</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            {transport === "stdio" ? (
              <>
                <Field>
                  <FieldLabel>{t("mcp.command")}</FieldLabel>
                  <Input
                    value={command}
                    className="font-mono text-xs"
                    onInput={(e) => setCommand(e.currentTarget.value)}
                    placeholder="npx -y @modelcontextprotocol/server-filesystem ~/Documents"
                  />
                  <FieldDescription>{t("mcp.commandDesc")}</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>{t("mcp.env")}</FieldLabel>
                  <Textarea rows={2} value={env} className="font-mono text-xs" onInput={(e) => setEnv(e.currentTarget.value)} placeholder="API_TOKEN=xxx" />
                </Field>
              </>
            ) : (
              <>
                <Field>
                  <FieldLabel>URL</FieldLabel>
                  <Input value={url} className="font-mono text-xs" onInput={(e) => setUrl(e.currentTarget.value)} placeholder="https://example.com/mcp" />
                </Field>
                <Field>
                  <FieldLabel>{t("mcp.headers")}</FieldLabel>
                  <Textarea rows={2} value={headers} className="font-mono text-xs" onInput={(e) => setHeaders(e.currentTarget.value)} placeholder="Authorization: Bearer xxx" />
                </Field>
              </>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner />}
              {t("mcp.saveConnect")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [json, setJson] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      const n = await rpc<number>("mcp.import", { json })
      toast.success(t("mcp.imported", { n }))
      setJson("")
      onClose()
    } catch (e: any) {
      toast.error(t("mcp.importFailed", { msg: e.message }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("mcp.importTitle")}</DialogTitle>
          <DialogDescription>{t("mcp.importDesc")}</DialogDescription>
        </DialogHeader>
        <Textarea
          rows={12}
          value={json}
          className="font-mono text-xs"
          onInput={(e) => setJson(e.currentTarget.value)}
          placeholder={`{\n  "mcpServers": {\n    "fetch": { "command": "uvx", "args": ["mcp-server-fetch"] }\n  }\n}`}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!json.trim() || busy}>
            {busy && <Spinner />}
            {t("common.import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
