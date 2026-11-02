// A tiny kestrel tucked behind the Dynamic Island while an agent works. Its whole flight stays within the
// island's footprint rather than leaking into the header. It never takes touches.
import { useEffect, useState } from "preact/hooks"
import { sessions } from "@/lib/store"
import { KestrelMark } from "./kestrel-mark"

/** A deep portrait safe area is a best-effort island hint, not hardware detection. Recheck on rotation. */
function useHasIsland() {
  const [has, setHas] = useState(false)
  useEffect(() => {
    const check = () => {
      const probe = document.createElement("div")
      probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;height:var(--inset-top)"
      document.body.appendChild(probe)
      setHas(probe.getBoundingClientRect().height >= 56)
      probe.remove()
    }
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])
  return has
}

export function IslandKestrel() {
  const island = useHasIsland()
  const working = sessions.value.some((s) => s.status === "running")
  // Kept mounted for the flight back under the island after the work ends.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (working) return setShown(true)
    const t = setTimeout(() => setShown(false), 700)
    return () => clearTimeout(t)
  }, [working])
  if (!island || !shown) return null
  return (
    <div aria-hidden="true" className={`island-kestrel ${working ? "is-out" : "is-back"}`}>
      <KestrelMark className="size-[15px]" />
    </div>
  )
}
