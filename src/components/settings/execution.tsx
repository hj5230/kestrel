// Settings > Execution: shell timeout, network proxy and web search, and the ffmpeg used to convert images.
import { useEffect, useState } from "preact/hooks"
import type { AppSettings } from "@shared/protocol"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Panel, Row, Section } from "@/components/settings/layout"
import { rpc } from "@/lib/api"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { save, BlurInput } from "./fields"

export function Execution({ s }: { s: AppSettings }) {
  return (
    <div className="grid gap-8">
      <Section title={t("settings.exec")}>
        <Panel>
          <Row label={t("settings.bashTimeout")} desc={t("settings.bashTimeoutDesc")}>
            <BlurInput
              type="number"
              className="w-24 text-right"
              value={String(s.bashTimeoutSec)}
              onCommit={(v) => save({ bashTimeoutSec: Math.max(5, Math.min(600, Number(v) || 120)) })}
            />
          </Row>
          <Row label={t("settings.proxy")} desc={t("settings.proxyDesc")}>
            <Select value={s.proxyMode} onValueChange={(v) => save({ proxyMode: v as any })}>
              <SelectTrigger size="sm" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="env">{t("settings.proxy.env")}</SelectItem>
                <SelectItem value="none">{t("settings.proxy.none")}</SelectItem>
                <SelectItem value="custom">{t("settings.proxy.custom")}</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          {s.proxyMode === "custom" && (
            <Row label={t("settings.proxyUrl")}>
              <BlurInput className="w-64 font-mono text-xs" placeholder="http://127.0.0.1:7890" value={s.proxyUrl} onCommit={(v) => save({ proxyUrl: v.trim() })} />
            </Row>
          )}
          <Row label={t("settings.tavilyKey")} desc={t("settings.tavilyKeyDesc")}>
            <BlurInput
              type="password"
              autoComplete="off"
              spellcheck={false}
              className="w-64 font-mono text-xs"
              placeholder="tvly-…"
              value={s.tavilyApiKey}
              onCommit={(v) => save({ tavilyApiKey: v.trim() })}
            />
          </Row>
        </Panel>
      </Section>
      <Section title={t("settings.media")}>
        <Panel>
          <FfmpegRow s={s} />
        </Panel>
      </Section>
    </div>
  )
}

export function FfmpegRow({ s }: { s: AppSettings }) {
  const [status, setStatus] = useState<{ path: string | null; configured: boolean; version: string | null } | null>(null)
  useEffect(() => {
    rpc("media.status").then(setStatus).catch(() => setStatus(null))
  }, [s.ffmpegPath])
  const note = !status ? "" : status.path ? t("settings.ffmpegFound", { path: status.path, version: status.version ?? "?" }) : status.configured ? t("settings.ffmpegBad") : t("settings.ffmpegMissing")
  return (
    <Row
      label={t("settings.ffmpeg")}
      desc={
        <>
          {t("settings.ffmpegDesc")}
          {note && <span className={cn("mt-1 block font-mono text-[11px] break-all", !status?.path && "text-warning")}>{note}</span>}
        </>
      }
    >
      <BlurInput className="w-64 font-mono text-xs" placeholder="/opt/homebrew/bin/ffmpeg" spellcheck={false} value={s.ffmpegPath} onCommit={(v) => save({ ffmpegPath: v.trim() })} />
    </Row>
  )
}
