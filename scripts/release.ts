// Publishes the version in package.json from builds already made (npm run tauri build -- --bundles app,
// npm run ios:ipa):
//  1. hj5230/kestrel-releases gets a tag holding only this release (signed manifest + pieces under 20 MB,
//     which is what jsDelivr serves), and its main branch's latest.json points at it.
//  2. This repository gets the same tag and a GitHub release with the zip and the IPA attached.
// Usage: bun scripts/release.ts [--notes "…"] [--dry-run]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { version } from "../package.json";
import { RELEASES_REPO } from "../sidecar/update/release";
import { packRelease } from "../sidecar/update/pack";
import { compareVersions, releasePage } from "../shared/version";
import type { ReleasePointer } from "../shared/protocol";
import { KEY_PATH } from "./release-key";

const ROOT = path.join(import.meta.dir, "..");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => (args.indexOf(`--${name}`) >= 0 ? args[args.indexOf(`--${name}`) + 1] : undefined);
const dry = flag("dry-run");
const tag = `v${version}`;

function sh(cmd: string, argv: string[], cwd = ROOT): string {
  const r = spawnSync(cmd, argv, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(" ")} failed:\n${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
const git = (cwd: string, ...argv: string[]) => sh("git", ["-c", "core.pager=cat", ...argv], cwd);

// ---------- what is being released ----------
const app = path.join(ROOT, "src-tauri/target/release/bundle/macos/Kestrel.app");
const ipa = path.join(ROOT, "src-tauri/gen/apple/build/arm64/Kestrel.ipa");
const built = sh("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", path.join(app, "Contents/Info.plist")]);
if (built !== version) throw new Error(`the Mac build is ${built}, package.json says ${version}: build again first`);
const iosBuild = Number(JSON.parse(fs.readFileSync(path.join(ROOT, "src-tauri/tauri.ios.conf.json"), "utf8")).bundle?.iOS?.bundleVersion ?? 0);
if (!fs.existsSync(ipa)) throw new Error("no IPA: run npm run ios:ipa first");
if (fs.statSync(ipa).mtimeMs < fs.statSync(path.join(ROOT, "package.json")).mtimeMs) throw new Error("the IPA is older than the version bump: build it again");
if (!dry && git(ROOT, "status", "--porcelain", "--untracked-files=no")) throw new Error("commit the release first: the tag must match the build");
if (!fs.existsSync(KEY_PATH)) throw new Error(`no signing key at ${KEY_PATH} (bun scripts/release-key.ts)`);

const previous = (() => {
  try { return git(ROOT, "describe", "--tags", "--abbrev=0", "HEAD^"); } catch { return ""; }
})();
const notes = option("notes") ?? git(ROOT, "log", "--format=- %s", previous ? `${previous}..HEAD` : "-20", "--no-merges").split("\n").filter((l) => !l.includes("chore(release)")).join("\n");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-release-"));
const zip = path.join(work, `Kestrel-${version}-macOS.zip`);
sh("/usr/bin/ditto", ["-c", "-k", "--keepParent", app, zip]);
const ipaOut = path.join(work, `Kestrel-${version}.ipa`);
fs.copyFileSync(ipa, ipaOut);

// ---------- the releases repository ----------
const releases = process.env.KESTREL_RELEASES_DIR ?? path.join(ROOT, "..", "kestrel-releases");
if (!fs.existsSync(path.join(releases, ".git"))) sh("git", ["clone", `git@github.com:${RELEASES_REPO}.git`, releases]);
git(releases, "fetch", "origin", "--tags");
const tree = path.join(work, "tree");
git(releases, "worktree", "add", "--detach", tree);
try {
  git(tree, "checkout", "--orphan", `release-${version}`);
  git(tree, "rm", "-rf", "--quiet", "--ignore-unmatch", ".");
  // Only this release's files, so the tag stays far below jsDelivr's 150 MB per-version limit.
  packRelease({ version, notes, page: releasePage(version), macZip: zip, ipa: { path: ipaOut, build: iosBuild }, privateKeyPem: fs.readFileSync(KEY_PATH, "utf8"), out: path.join(work, "pack") });
  for (const f of fs.readdirSync(path.join(work, "pack"))) fs.cpSync(path.join(work, "pack", f), path.join(tree, f), { recursive: true });
  git(tree, "add", "-A");
  git(tree, "commit", "-q", "-m", `release ${tag}`);
  git(tree, "tag", "-f", tag);
  console.log(`Packed ${tag}: ${fs.readdirSync(path.join(tree, "mac")).length} Mac pieces`);
  if (!dry) git(releases, "push", "origin", `refs/tags/${tag}`);
} finally {
  git(releases, "worktree", "remove", "--force", tree);
  try { git(releases, "branch", "-D", `release-${version}`); } catch {}
}

git(releases, "checkout", "-q", "main");
try { git(releases, "pull", "-q", "--ff-only", "origin", "main"); } catch {}
const pointerFile = path.join(releases, "latest.json");
const pointer: ReleasePointer = fs.existsSync(pointerFile) ? JSON.parse(fs.readFileSync(pointerFile, "utf8")) : { beta: null, stable: null };
const newer = (cur: string | null) => !cur || compareVersions(version, cur) > 0;
if (newer(pointer.beta)) pointer.beta = version;
if (!version.includes("-") && newer(pointer.stable)) pointer.stable = version;
if (dry) {
  console.log(`Dry run: latest.json would become ${JSON.stringify(pointer)}`);
} else {
  fs.writeFileSync(pointerFile, JSON.stringify(pointer, null, 2) + "\n");
  git(releases, "add", "latest.json");
  git(releases, "commit", "-q", "-m", `point to ${tag}`);
  git(releases, "push", "-q", "origin", "main");
  // jsDelivr keeps a branch for hours; ask it to drop the old pointer now.
  await fetch(`https://purge.jsdelivr.net/gh/${RELEASES_REPO}@main/latest.json`).catch(() => {});
}

// ---------- this repository ----------
if (dry) {
  console.log(`Dry run: nothing pushed. Files in ${work}`);
} else {
  if (!git(ROOT, "tag", "--list", tag)) git(ROOT, "tag", tag);
  git(ROOT, "push", "-q", "origin", `refs/tags/${tag}`);
  const pre = version.includes("-") ? ["--prerelease"] : [];
  sh("gh", ["release", "create", tag, "--title", `Kestrel ${version}`, "--notes", notes || `Kestrel ${version}`, ...pre, zip, ipaOut]);
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`Released ${tag}: ${releasePage(version)}`);
}
