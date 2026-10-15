import { useMemo } from "preact/hooks"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"

interface Row {
  kind: "add" | "del" | "ctx" | "hunk"
  text: string
  oldNo?: number
  newNo?: number
}

function parse(diff: string): Row[] {
  const rows: Row[] = []
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  for (const line of diff.split("\n")) {
    if (!inHunk && !line.startsWith("@@")) continue
    if (line.startsWith("@@")) {
      inHunk = true
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (m) {
        oldNo = Number(m[1])
        newNo = Number(m[2])
      }
      rows.push({ kind: "hunk", text: line })
    } else if (line.startsWith("+")) rows.push({ kind: "add", text: line.slice(1), newNo: newNo++ })
    else if (line.startsWith("-")) rows.push({ kind: "del", text: line.slice(1), oldNo: oldNo++ })
    else if (line.startsWith(" ")) rows.push({ kind: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
    else if (line === "\\ No newline at end of file") continue
  }
  return rows
}

export function simpleDiff(oldStr: string, newStr: string): string {
  const o = oldStr.split("\n").map((l) => `-${l}`)
  const n = newStr.split("\n").map((l) => `+${l}`)
  return [`@@ -1,${o.length} +1,${n.length} @@`, ...(oldStr ? o : []), ...n].join("\n")
}

export function DiffView({ diff, maxHeight = 360 }: { diff: string; maxHeight?: number }) {
  const rows = useMemo(() => parse(diff), [diff])
  if (!rows.length) return <div className="px-3 py-2 text-xs text-muted-foreground">{t("diff.none")}</div>
  return (
    <div className="overflow-auto font-mono text-[12px] leading-[1.55] select-text" style={{ maxHeight }}>
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((r, i) =>
            r.kind === "hunk" ? (
              <tr key={i} className="bg-muted/50 text-muted-foreground">
                <td colSpan={3} className="px-3 py-0.5 text-[11px] select-none">
                  {r.text}
                </td>
              </tr>
            ) : (
              <tr
                key={i}
                className={cn(
                  r.kind === "add" && "bg-success/10",
                  r.kind === "del" && "bg-destructive/10",
                )}
              >
                <td className="w-10 select-none px-2 text-right align-top text-muted-foreground/60 tabular-nums">{r.oldNo ?? ""}</td>
                <td className="w-10 select-none px-2 text-right align-top text-muted-foreground/60 tabular-nums">{r.newNo ?? ""}</td>
                <td className="whitespace-pre-wrap break-all pr-3 align-top">
                  <span
                    className={cn(
                      "mr-2 select-none",
                      r.kind === "add" ? "text-success" : r.kind === "del" ? "text-destructive" : "text-transparent",
                    )}
                  >
                    {r.kind === "add" ? "+" : r.kind === "del" ? "-" : " "}
                  </span>
                  {r.text || " "}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}
