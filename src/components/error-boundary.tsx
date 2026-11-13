import { Component, type ComponentChildren } from "preact"
import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n"
import { logger } from "@/lib/log"

export class ErrorBoundary extends Component<{ children: ComponentChildren; resetKey?: unknown; compact?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null }

  componentDidCatch(error: Error, info?: { componentStack?: string }) {
    logger("ui").error("a screen failed to render", { error, componentStack: info?.componentStack?.slice(0, 1500), compact: !!this.props.compact })
    this.setState({ error })
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.compact) return null
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <TriangleAlertIcon className="size-6 text-destructive" />
        <div className="text-sm font-medium">{t("error.render")}</div>
        <pre className="max-w-xl overflow-auto rounded-lg bg-muted px-3 py-2 text-left font-mono text-xs whitespace-pre-wrap text-muted-foreground">{error.message}</pre>
        <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
          <RotateCcwIcon />
          {t("common.retry")}
        </Button>
      </div>
    )
  }
}
