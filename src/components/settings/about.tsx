// Settings > About: version, data location and the tools Kestrel found on this Mac.
import { FolderOpenIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Panel, Row, Section } from "@/components/settings/layout"
import { rpc } from "@/lib/api"
import { t } from "@/lib/i18n"
import { appInfo } from "@/lib/store"
import { isMobileApp } from "@/lib/platform"

export function About() {
  const info = appInfo.value
  if (!info) return null
  const rows: [string, string][] = [
    [t("settings.version"), info.version + (info.dev ? t("settings.devMode") : "")],
    [t("settings.framework"), "pi-agent-core + Vercel AI SDK"],
    [t("settings.dataDir"), info.dataDir],
    [t("settings.database"), info.dbPath],
    ["Shell", info.shell],
    ["ripgrep", info.ripgrep ? t("settings.rgFound") : t("settings.rgMissing")],
  ]
  return (
    <Section title={t("settings.aboutTitle")} desc={t("settings.aboutDesc")}>
      <Panel>
        {rows.map(([k, v]) => (
          <Row key={k} label={k} desc={<span className="font-mono select-text">{v}</span>} />
        ))}
      </Panel>
      {!isMobileApp && (
        <div>
          <Button variant="outline" size="sm" onClick={() => rpc("app.open", { path: info.dataDir })}>
            <FolderOpenIcon />
            {t("settings.openDataDir")}
          </Button>
        </div>
      )}
    </Section>
  )
}
