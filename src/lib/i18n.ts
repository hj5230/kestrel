import { signal } from "@preact/signals"
import { en, type MessageKey } from "./locales/en"
import { zhCN } from "./locales/zh-CN"

export type Lang = "en" | "zh-CN"

const dicts: Record<Lang, Record<MessageKey, string>> = { en, "zh-CN": zhCN }

function initialLang(): Lang {
  try {
    const v = localStorage.getItem("helm-lang")
    if (v === "en" || v === "zh-CN") return v
  } catch {}
  return "en"
}

export const lang = signal<Lang>(initialLang())

export function setLang(l: Lang) {
  lang.value = l
  document.documentElement.lang = l
  try {
    localStorage.setItem("helm-lang", l)
  } catch {}
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const s = dicts[lang.value][key] ?? en[key] ?? key
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

export function locale(): string {
  return lang.value === "zh-CN" ? "zh-CN" : "en-US"
}

export type { MessageKey }
