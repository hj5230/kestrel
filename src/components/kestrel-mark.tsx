// The "working" mark: a kestrel hovering in place, seen from below, wings beating the way the bird hunts.
// Filled shapes in the current text color; the wings rotate about the shoulders while the body hangs still.
// With reduced motion it holds still mid-beat.
import { cn } from "@/lib/utils"

export function KestrelMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={cn("kestrel-mark size-4 shrink-0", className)} aria-hidden="true">
      {/* long, pointed falcon wings with a stepped trailing edge */}
      <path className="kestrel-wing kestrel-wing-l" d="M11.2 8.6C8.3 7.4 4.9 7.8 1 10.8c1.3-.1 2.6 0 3.8.3-1 .5-1.9 1.2-2.6 2 3-.9 5.9-.9 9.1.2z" />
      <path className="kestrel-wing kestrel-wing-r" d="M12.8 8.6c2.9-1.2 6.3-.8 10.2 2.2-1.3-.1-2.6 0-3.8.3 1 .5 1.9 1.2 2.6 2-3-.9-5.9-.9-9.1.2z" />
      {/* head, body and the fanned tail it spreads to hold position */}
      <path d="M12 4c.9 0 1.5.7 1.5 1.6l.3 5.4-.4 3.6 2 5c-1.1.7-2.2 1-3.4 1s-2.3-.3-3.4-1l2-5-.4-3.6.3-5.4C10.5 4.7 11.1 4 12 4z" />
    </svg>
  )
}
