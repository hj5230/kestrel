// Sound and haptic cues for the moments worth noticing: a run finished, a run needs the user, a run failed, and
// an error anywhere in the app. Choices are per device (a Mac's settings are shared by every phone paired to it).
//
// The sounds are synthesized, not samples: a few sine partials with a soft attack and a long exponential tail,
// through a low-pass and a faint echo, so they read as glass and wood rather than beeps. Done rises a fifth,
// "needs you" taps twice on one note, a failed run falls a third, and an app error is one low muted note.
import { signal } from "@preact/signals"
import { toast } from "sonner"
import { isMobileApp } from "./platform"

export type Cue = "done" | "input" | "error" | "fail"

interface Prefs {
  sound: boolean
  haptics: boolean
}

const KEY = "kestrel-feedback"

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null")
    return { sound: raw?.sound !== false, haptics: raw?.haptics !== false }
  } catch {
    return { sound: true, haptics: true }
  }
}

export const feedbackPrefs = signal<Prefs>(load())

export function setFeedbackPrefs(patch: Partial<Prefs>) {
  feedbackPrefs.value = { ...feedbackPrefs.value, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(feedbackPrefs.value))
  } catch {}
}

// ---------- sound ----------

let ctx: AudioContext | null = null
let out: AudioNode | null = null

function audio(): AudioContext | null {
  if (ctx) return ctx
  try {
    ctx = new AudioContext()
  } catch {
    return null
  }
  const master = ctx.createGain()
  master.gain.value = 0.16
  const tone = ctx.createBiquadFilter()
  tone.type = "lowpass"
  tone.frequency.value = 5200
  // A faint echo gives the notes some air without a reverb impulse.
  const delay = ctx.createDelay()
  delay.delayTime.value = 0.11
  const fb = ctx.createGain()
  fb.gain.value = 0.22
  const wet = ctx.createGain()
  wet.gain.value = 0.2
  tone.connect(master)
  tone.connect(delay)
  delay.connect(fb)
  fb.connect(delay)
  delay.connect(wet)
  wet.connect(master)
  master.connect(ctx.destination)
  out = tone
  return ctx
}

/** One struck note: a fundamental and a few quieter partials that die away faster than it does. */
function note(c: AudioContext, freq: number, at: number, dur: number, gain: number, partials: [number, number][], drop = 0) {
  const t = c.currentTime + at
  for (const [ratio, level] of [[1, 1] as [number, number], ...partials]) {
    const osc = c.createOscillator()
    osc.type = "sine"
    osc.frequency.setValueAtTime(freq * ratio, t)
    if (drop) osc.frequency.exponentialRampToValueAtTime(freq * ratio * (1 - drop), t + dur)
    const env = c.createGain()
    const peak = gain * level
    const tail = ratio === 1 ? dur : dur * 0.45
    env.gain.setValueAtTime(0.0001, t)
    env.gain.exponentialRampToValueAtTime(peak, t + 0.008)
    env.gain.exponentialRampToValueAtTime(0.0001, t + tail)
    osc.connect(env)
    env.connect(out!)
    osc.start(t)
    osc.stop(t + tail + 0.05)
  }
}

const GLASS: [number, number][] = [
  [2, 0.22],
  [3.01, 0.06],
]
const WOOD: [number, number][] = [
  [4, 0.18],
  [9.2, 0.04],
]

function play(cue: Cue) {
  const c = audio()
  if (!c) return
  if (c.state === "suspended") void c.resume()
  switch (cue) {
    case "done":
      note(c, 659.25, 0, 1.1, 0.7, GLASS)
      note(c, 987.77, 0.12, 1.4, 0.55, GLASS)
      break
    case "input":
      note(c, 1174.66, 0, 0.5, 0.5, WOOD)
      note(c, 1174.66, 0.17, 0.6, 0.38, WOOD)
      break
    case "error":
      note(c, 329.63, 0, 0.7, 0.75, [[2, 0.12]])
      note(c, 261.63, 0.15, 0.9, 0.7, [[2, 0.12]])
      break
    case "fail":
      note(c, 220, 0, 0.42, 0.8, [[2, 0.1]], 0.06)
      break
  }
}

// ---------- entry point ----------

let last = 0

/** Plays the cue. Cues that land together (a failed run and its error toast) play once. */
export function feedback(cue: Cue) {
  const now = Date.now()
  if (now - last < 700) return
  last = now
  const prefs = feedbackPrefs.value
  if (prefs.sound) play(cue)
  if (prefs.haptics && isMobileApp) {
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("haptic", { kind: cue })).catch(() => {})
  }
}

/** Plays a cue regardless of the throttle, to preview it from Settings. */
export function previewSound(cue: Cue = "done") {
  play(cue)
}

/** Unlocks audio on the first interaction (webviews start it suspended) and gives every error toast a cue. */
export function initFeedback() {
  const unlock = () => {
    const c = audio()
    if (c?.state === "suspended") void c.resume()
    window.removeEventListener("pointerdown", unlock, true)
    window.removeEventListener("keydown", unlock, true)
  }
  window.addEventListener("pointerdown", unlock, true)
  window.addEventListener("keydown", unlock, true)
  const error = toast.error
  toast.error = ((...args: Parameters<typeof error>) => {
    feedback("fail")
    return error(...args)
  }) as typeof error
}
