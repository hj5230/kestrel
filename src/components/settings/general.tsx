// Settings > General: language, appearance, defaults for new sessions, sending, transcript view and cues.
import type { AppSettings } from "@shared/protocol"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Panel, Row, Section } from "@/components/settings/layout"
import { CwdPicker, ModelPicker, PermissionPicker, ThinkingPicker } from "@/components/chat/pickers"
import { VIEWS } from "@/components/chat/view-picker"
import { shortPath } from "@/lib/format"
import { t, type MessageKey } from "@/lib/i18n"
import { appInfo, enabledModels } from "@/lib/store"
import { isMobileApp, isTouch } from "@/lib/platform"
import { feedbackPrefs, previewSound, setFeedbackPrefs } from "@/lib/feedback"
import { cn } from "@/lib/utils"
import { save } from "./fields"

export const ACCENTS: { value: AppSettings["accent"]; color: string }[] = [
  { value: "neutral", color: "var(--foreground)" },
  { value: "blue", color: "oklch(0.546 0.245 262.881)" },
  { value: "violet", color: "oklch(0.541 0.281 293.009)" },
  { value: "emerald", color: "oklch(0.596 0.145 163.225)" },
  { value: "orange", color: "oklch(0.646 0.222 41.116)" },
  { value: "rose", color: "oklch(0.586 0.253 17.585)" },
]

export function General({ s }: { s: AppSettings }) {
  return (
    <div className="grid gap-8">
      <Section title={t("settings.appearance")}>
        <Panel>
          <Row label={t("settings.language")}>
            <Select value={s.language} onValueChange={(v) => save({ language: v as AppSettings["language"] })}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="zh-CN">简体中文</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label={t("settings.theme")}>
            <ToggleGroup type="single" variant="outline" size="sm" value={s.theme} onValueChange={(v) => v && save({ theme: v as any })}>
              <ToggleGroupItem value="system" className="px-3">
                {t("settings.theme.system")}
              </ToggleGroupItem>
              <ToggleGroupItem value="light" className="px-3">
                {t("settings.theme.light")}
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" className="px-3">
                {t("settings.theme.dark")}
              </ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <Row label={t("settings.accent")}>
            <div className="flex gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  title={t(`accent.${a.value}` as MessageKey)}
                  onClick={() => save({ accent: a.value })}
                  className={cn("size-6 rounded-full ring-offset-2 ring-offset-card transition pointer-coarse:size-8", s.accent === a.value ? "ring-2 ring-ring" : "hover:scale-110")}
                  style={{ background: a.color }}
                />
              ))}
            </div>
          </Row>
        </Panel>
      </Section>
      <Section title={t("settings.defaults")} desc={t("settings.defaultsDesc")}>
        <Panel>
          <Row label={t("settings.cwd")}>
            <CwdPicker value={shortPath(s.defaultCwd, appInfo.value?.home)} onChange={(v) => save({ defaultCwd: v })} />
          </Row>
          <Row label={t("settings.model")}>
            <ModelPicker providerId={s.defaultProviderId} modelId={s.defaultModelId} onChange={(p, m) => save({ defaultProviderId: p, defaultModelId: m })} />
          </Row>
          <Row label={t("settings.thinking")} desc={t("settings.thinkingDesc")}>
            <ThinkingPicker value={s.defaultThinking} choices={enabledModels.value.find((m) => m.providerId === s.defaultProviderId && m.id === s.defaultModelId)?.efforts ?? []} onChange={(v) => save({ defaultThinking: v })} />
          </Row>
          <Row label={t("settings.permission")}>
            <PermissionPicker value={s.defaultPermissionMode} onChange={(v) => save({ defaultPermissionMode: v })} />
          </Row>
        </Panel>
      </Section>
      <Section title={t("settings.chat")}>
        <Panel>
          {/* A software keyboard's return key always inserts a newline; this only applies to hardware keyboards. */}
          {!isTouch && (
            <Row label={t("settings.sendKey")}>
              <Select value={s.sendKey} onValueChange={(v) => save({ sendKey: v as any })}>
                <SelectTrigger size="sm" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="enter">{t("settings.sendEnter")}</SelectItem>
                  <SelectItem value="mod-enter">{t("settings.sendMod")}</SelectItem>
                </SelectContent>
              </Select>
            </Row>
          )}
          <Row label={t("settings.transcriptView")} desc={t("settings.transcriptViewDesc")}>
            <Select value={s.transcriptView} onValueChange={(v) => save({ transcriptView: v as AppSettings["transcriptView"] })}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIEWS.map((v) => (
                  <SelectItem key={v.value} value={v.value}>
                    {t(`view.${v.value}` as MessageKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label={t("settings.notify")} desc={t("settings.notifyDesc")}>
            <Switch checked={s.notifyOnFinish} onCheckedChange={(v) => save({ notifyOnFinish: v })} />
          </Row>
          <Row label={t("settings.sounds")} desc={t("settings.soundsDesc")}>
            <Switch
              checked={feedbackPrefs.value.sound}
              onCheckedChange={(v) => {
                setFeedbackPrefs({ sound: v })
                if (v) previewSound()
              }}
            />
          </Row>
          {isMobileApp && (
            <Row label={t("settings.haptics")} desc={t("settings.hapticsDesc")}>
              <Switch checked={feedbackPrefs.value.haptics} onCheckedChange={(v) => setFeedbackPrefs({ haptics: v })} />
            </Row>
          )}
        </Panel>
      </Section>
    </div>
  )
}
