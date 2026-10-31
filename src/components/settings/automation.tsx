// Settings > Titles & context: the side models for titles and compaction, and when compaction runs.
import type { AppSettings } from "@shared/protocol"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Panel, Row, Section } from "@/components/settings/layout"
import { t } from "@/lib/i18n"
import { save, ModelRow } from "./fields"

export function Automation({ s }: { s: AppSettings }) {
  return (
    <div className="grid gap-8">
      <Section title={t("settings.titleModel")}>
        <Panel>
          <ModelRow label={t("settings.titleModel")} desc={t("settings.titleModelDesc")} value={s.titleModel} none={t("settings.titleSame")} onChange={(v) => save({ titleModel: v })} />
        </Panel>
      </Section>
      <Section title={t("settings.context")} desc={t("settings.contextDesc")}>
        <Panel>
          <Row label={t("settings.autoCompact")}>
            <Switch checked={s.autoCompact} onCheckedChange={(v) => save({ autoCompact: v })} />
          </Row>
          <Row label={t("settings.threshold")} desc={t("settings.thresholdDesc", { pct: Math.round(s.compactThreshold * 100) })}>
            <Slider
              className="w-48"
              min={50}
              max={95}
              step={5}
              value={[Math.round(s.compactThreshold * 100)]}
              onValueCommit={(v: number[]) => save({ compactThreshold: v[0] / 100 })}
            />
          </Row>
          <ModelRow label={t("settings.compactModel")} desc={t("settings.compactModelDesc")} value={s.compactModel} none={t("settings.titleSame")} onChange={(v) => save({ compactModel: v })} />
          <Row label={t("settings.keepRecent")} desc={t("settings.keepRecentDesc")}>
            <Select value={String(s.keepRecentTokens)} onValueChange={(v) => save({ keepRecentTokens: Number(v) })}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[8000, 16000, 24000, 40000, 64000].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {t("settings.keepRecentN", { n: n / 1000 })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        </Panel>
      </Section>
    </div>
  )
}
