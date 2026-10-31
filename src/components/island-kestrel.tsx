// A small surprise on iPhones with a Dynamic Island: while an agent is working, a kestrel drops out from under
// the island and hovers there, then slips back under it when the work is done. Only where the top inset is deep
// enough to mean an island (a notch is shallower), and never in the way: it takes no touches.
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
