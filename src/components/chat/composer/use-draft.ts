// The unsent text of a composer, kept per draft key (a session, or home) so it survives switching away.
import { useEffect, useRef, useState } from "preact/hooks"

const storageKey = (key: string) => `kestrel-draft:${key}`

export function useDraft(draftKey?: string) {
  const [text, setText] = useState(() => {
    if (!draftKey) return ""
    try {
      return localStorage.getItem(storageKey(draftKey)) ?? ""
    } catch {
      return ""
    }
  })
  const latest = useRef(text)
  latest.current = text

  const persist = (value: string) => {
    if (!draftKey) return
    try {
      if (value) localStorage.setItem(storageKey(draftKey), value)
      else localStorage.removeItem(storageKey(draftKey))
    } catch {}
  }

  useEffect(() => {
    if (!draftKey) return
    const timer = setTimeout(() => persist(text), 300)
    return () => clearTimeout(timer)
  }, [text, draftKey])

  // Leaving the session (or the composer unmounting) saves at once rather than after the debounce.
  useEffect(() => () => persist(latest.current), [draftKey])

  /** Clears the text and the saved draft together, before an await can race the debounce. */
  const clear = () => {
    setText("")
    latest.current = ""
    persist("")
  }

  return { text, setText, persist, clear }
}
