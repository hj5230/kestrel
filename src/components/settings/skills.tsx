// Settings > Skills and Instructions: where skills, commands and instruction files are found, and which are on.
import { useEffect, useMemo, useState } from "preact/hooks"
import type { AppSettings, SkillInfo } from "@shared/protocol"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Panel, Row, Section } from "@/components/settings/layout"
import { rpc } from "@/lib/api"
import { t } from "@/lib/i18n"
import { save, LinesEditor } from "./fields"

export function Skills({ s }: { s: AppSettings }) {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null)
  const [q, setQ] = useState("")
  useEffect(() => {
    rpc<SkillInfo[]>("skills.list", { cwd: s.defaultCwd }).then(setSkills)
  }, [s.skillDirs.join()])
  const disabled = new Set(s.disabledSkills)
  const shown = useMemo(
    () => (skills ?? []).filter((k) => !q || k.name.toLowerCase().includes(q.toLowerCase()) || k.description.toLowerCase().includes(q.toLowerCase())),
    [skills, q],
  )
  const enabledCount = skills ? skills.filter((k) => !disabled.has(k.name)).length : 0
  return (
    <div className="grid gap-8">
      <Section title={t("settings.skillDirs")} desc={t("settings.skillDirsDesc")}>
        <LinesEditor value={s.skillDirs} onCommit={(v) => save({ skillDirs: v })} />
      </Section>
      <Section title={t("settings.commandDirs")} desc={t("settings.commandDirsDesc")}>
        <LinesEditor value={s.commandDirs} onCommit={(v) => save({ commandDirs: v })} rows={2} />
      </Section>
      <Section
        title={skills ? t("settings.skillsFoundN", { on: enabledCount, all: skills.length }) : t("settings.skillsFound")}
        desc={t("settings.skillsDesc")}
        action={<Input className="w-52" placeholder={t("settings.searchSkills")} value={q} onInput={(e) => setQ(e.currentTarget.value)} />}
      >
        {skills && skills.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle className="text-sm">{t("settings.noSkills")}</EmptyTitle>
              <EmptyDescription>{t("settings.noSkillsDesc")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Panel>
            {shown.map((k) => (
              <Row
                key={k.name}
                label={
                  <span className="flex items-center gap-2">
                    {k.name}
                    <Badge variant="outline" className="font-mono text-[10px] font-normal">
                      {k.source}
                    </Badge>
                  </span>
                }
                desc={<span className="line-clamp-2">{k.description}</span>}
              >
                <Switch
                  checked={!disabled.has(k.name)}
                  onCheckedChange={(v) => save({ disabledSkills: v ? s.disabledSkills.filter((n) => n !== k.name) : [...s.disabledSkills, k.name] })}
                />
              </Row>
            ))}
          </Panel>
        )}
      </Section>
    </div>
  )
}

export function Instructions({ s }: { s: AppSettings }) {
  const [text, setText] = useState(s.systemPromptAppend)
  useEffect(() => setText(s.systemPromptAppend), [s.systemPromptAppend])
  return (
    <div className="grid gap-8">
      <Section title={t("settings.globalInstructions")} desc={t("settings.globalInstructionsDesc")}>
        <Textarea
          rows={8}
          value={text}
          placeholder={t("settings.globalPlaceholder")}
          onInput={(e) => setText(e.currentTarget.value)}
          onBlur={() => text !== s.systemPromptAppend && save({ systemPromptAppend: text })}
        />
      </Section>
      <Section title={t("settings.instructionFiles")} desc={t("settings.instructionFilesDesc")}>
        <LinesEditor value={s.instructionFiles} onCommit={(v) => save({ instructionFiles: v })} />
      </Section>
      <Section title={t("settings.projectInstructions")}>
        <Panel>
          <Row label={t("settings.loadProject")} desc={t("settings.loadProjectDesc")}>
            <Switch checked={s.loadProjectInstructions} onCheckedChange={(v) => save({ loadProjectInstructions: v })} />
          </Row>
        </Panel>
      </Section>
    </div>
  )
}
