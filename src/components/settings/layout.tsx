import type { ComponentChildren } from "preact"
import { cn } from "@/lib/utils"

export function Section({ title, desc, children, action }: { title: string; desc?: string; children: ComponentChildren; action?: ComponentChildren }) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {desc && <p className="mt-0.5 text-[13px] text-muted-foreground">{desc}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Panel({ children, className }: { children: ComponentChildren; className?: string }) {
  return <div className={cn("divide-y overflow-hidden rounded-xl border bg-card", className)}>{children}</div>
}

export function Row({ label, desc, children, className }: { label: ComponentChildren; desc?: ComponentChildren; children?: ComponentChildren; className?: string }) {
  return (
    // Wraps on narrow screens: the label keeps a readable width and a wide control (select, slider)
    // drops below it instead of squeezing the label into a sliver.
    <div className={cn("flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5", className)}>
      <div className="min-w-0 flex-1 basis-36">
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</div>}
      </div>
      {children && <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

/** Network addresses, one per line so long names (MagicDNS) never break mid-word. */
export function HostList({ hosts, port }: { hosts: string[]; port?: number }) {
  return (
    <span className="grid font-mono break-all select-text">
      {hosts.map((h) => (
        <span key={h}>{port ? `${h}:${port}` : h}</span>
      ))}
    </span>
  )
}
