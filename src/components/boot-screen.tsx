import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"

export function BootScreen({ error }: { error: string | null }) {
  return (
    <div data-tauri-drag-region className="flex h-full items-center justify-center bg-background">
      {error ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlertIcon />
            </EmptyMedia>
            <EmptyTitle>无法连接后台服务</EmptyTitle>
            <EmptyDescription className="font-mono text-xs">{error}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => location.reload()}>
              <RefreshCwIcon />
              重新加载
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          正在启动…
        </div>
      )}
    </div>
  )
}
