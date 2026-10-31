// Settings > Permissions: the default mode, the auto-mode reviewer and its rules, and the command and tool allowlists.
import { RotateCcwIcon } from "lucide-react"
import type { AppSettings } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Panel, Section } from "@/components/settings/layout"
import { permissionModes } from "@/components/chat/pickers"
import { rpc } from "@/lib/api"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { save, LinesEditor, ModelRow, BlurTextarea } from "./fields"

export function Permissions({ s }: { s: AppSettings }) {
  const restore = async () => {
    const d = await rpc<{ bashWhitelist: string[] }>("permissions.defaults")
    save({ bashWhitelist: d.bashWhitelist })
  }
  return (
    <div className="grid gap-8">
      <Section title={t("settings.defaultMode")} desc={t("settings.alwaysAllowed")}>
        <div className="grid gap-2 sm:grid-cols-2">
          {permissionModes().map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => save({ defaultPermissionMode: m.value })}
              className={cn(
                "flex items-start gap-3 rounded-xl border bg-card p-3.5 text-left transition-colors hover:bg-muted/50",
                s.defaultPermissionMode === m.value && "border-primary ring-2 ring-primary/20",
              )}
            >
              <div>
                <div className="text-sm font-medium">{m.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{m.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </Section>
      <Section title={t("settings.autoReview")} desc={t("settings.autoReviewDesc")}>
        <Panel>
          <ModelRow label={t("settings.autoModel")} desc={t("settings.autoModelDesc")} value={s.autoModel} none={t("settings.autoModelNone")} onChange={(v) => save({ autoModel: v })} />
        </Panel>
        {(
          [
            ["autoEnvironment", "settings.autoEnvironment", "settings.autoEnvironmentDesc", "settings.autoEnvironmentPlaceholder"],
            ["autoBlockRules", "settings.autoBlock", "settings.autoBlockDesc", "settings.autoBlockPlaceholder"],
            ["autoAllowRules", "settings.autoAllow", "settings.autoAllowDesc", "settings.autoAllowPlaceholder"],
          ] as const
        ).map(([key, title, desc, placeholder]) => (
          <label key={key} className="grid gap-1.5">
            <span className="text-sm font-medium">{t(title)}</span>
            <span className="text-xs text-muted-foreground">{t(desc)}</span>
            <BlurTextarea value={s[key]} onCommit={(v) => save({ [key]: v })} placeholder={t(placeholder)} />
          </label>
        ))}
      </Section>
      <Section
        title={`${t("settings.bashWhitelist")} (${s.bashWhitelist.length})`}
        desc={t("settings.bashWhitelistDesc")}
        action={
          <Button variant="outline" size="sm" onClick={restore}>
            <RotateCcwIcon />
            {t("settings.resetDefaults")}
          </Button>
        }
      >
        <LinesEditor value={s.bashWhitelist} onCommit={(v) => save({ bashWhitelist: v })} rows={14} />
      </Section>
      <Section title={t("settings.toolWhitelist")} desc={t("settings.toolWhitelistDesc")}>
        <LinesEditor value={s.toolWhitelist} onCommit={(v) => save({ toolWhitelist: v })} rows={3} placeholder="mcp__server__tool" />
      </Section>
    </div>
  )
}
