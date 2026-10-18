// Keeping the Mac reachable for a paired phone.
//
// macOS sleeps when the lid closes (and after the idle timeout), which takes Wi-Fi and Tailscale
// down with it, so the phone loses the Mac. `pmset disablesleep` turns system sleep off entirely —
// lid closed only switches the display off — and is the one switch that covers both cases. It is a
// system setting that needs an administrator, so it is changed through the standard macOS password
// prompt and outlives Kestrel; the status always reports the live value, whoever set it.
import { execFile, spawnSync } from "node:child_process";

let cached: { at: number; value: boolean } | null = null;

export function sleepDisabled(maxAgeMs = 5000): boolean {
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.value;
  const out = spawnSync("/usr/bin/pmset", ["-g"], { encoding: "utf8", timeout: 3000 }).stdout ?? "";
  const value = /^\s*SleepDisabled\s+1\s*$/m.test(out);
  cached = { at: Date.now(), value };
  return value;
}

export function setSleepDisabled(on: boolean): Promise<void> {
  const script = `do shell script "/usr/bin/pmset -a disablesleep ${on ? 1 : 0}" with administrator privileges`;
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/osascript", ["-e", script], (err, _stdout, stderr) => {
      cached = null;
      if (!err) return resolve();
      // -128: the user dismissed the password prompt.
      reject(new Error(/-128/.test(stderr) ? "cancelled" : stderr.trim() || err.message));
    });
  });
}
