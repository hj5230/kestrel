import type { ComponentChildren } from "preact"
import { cn } from "@/lib/utils"

export function Section({ title, desc, children, action }: { title: string; desc?: string; children: ComponentChildren; action?: ComponentChildren }) {
  return (
    <section className="grid gap-3">
      <div className="flex items-end justify-between gap-4">
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
    <div className={cn("flex items-center gap-6 px-4 py-3.5", className)}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}
