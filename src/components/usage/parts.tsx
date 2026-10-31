// The pieces of the usage page: a figure with its label, and a card that frames a chart.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function Kpi({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="size-3.5" />
          {label}
        </div>
        <div className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}

export function ChartCard({ title, desc, children, className }: { title: string; desc?: string; children: any; className?: string }) {
  return (
    <Card className={cn("gap-2", className)}>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {desc && <CardDescription className="text-xs">{desc}</CardDescription>}
      </CardHeader>
      <CardContent className="px-3">{children}</CardContent>
    </Card>
  )
}
