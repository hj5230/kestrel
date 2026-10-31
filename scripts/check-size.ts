// Size limits for the code base: a file over 300 lines, or a Preact component over 200, is doing too much and
// should be split along a seam. Run by `npm run check`; exits non-zero and lists every offender.
//
// Exempt paths are tables rather than logic, or code that is not ours to reshape; each says why.
import fs from "node:fs";
import path from "node:path";

const MAX_FILE = 300;
const MAX_COMPONENT = 200;
const ROOTS = ["src", "sidecar", "shared", "scripts", "src-tauri/src"];
const EXTENSIONS = new Set([".ts", ".tsx", ".rs", ".css", ".sh", ".py"]);

const EXEMPT: { pattern: RegExp; why: string }[] = [
  { pattern: /^src\/lib\/locales\//, why: "message tables: one line per string" },
  { pattern: /^src\/components\/ui\//, why: "the shadcn kit, kept as upstream ships it" },
];

function walk(dir: string, out: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(p);
  }
}

/** Top-level components: a capitalized function or arrow const, up to the lone closing brace at column 0. */
function components(lines: string[]): { name: string; start: number; length: number }[] {
  const found: { name: string; start: number; length: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:export\s+)?(?:default\s+)?(?:function\s+([A-Z]\w*)\s*[(<]|const\s+([A-Z]\w*)\s*=\s*(?:\([^)]*\)|\w+)\s*=>)/.exec(lines[i]);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && !/^[})];?$/.test(lines[end])) end++;
    found.push({ name: m[1] ?? m[2], start: i + 1, length: end - i + 1 });
  }
  return found;
}

const files: string[] = [];
for (const root of ROOTS) if (fs.existsSync(root)) walk(root, files);

const problems: string[] = [];
for (const file of files.sort()) {
  const rel = file.split(path.sep).join("/");
  if (EXEMPT.some((e) => e.pattern.test(rel))) continue;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const count = lines.at(-1) === "" ? lines.length - 1 : lines.length;
  if (count > MAX_FILE) problems.push(`${rel}: ${count} lines (max ${MAX_FILE})`);
  if (rel.endsWith(".tsx")) {
    for (const c of components(lines)) {
      if (c.length > MAX_COMPONENT) problems.push(`${rel}:${c.start} ${c.name}: ${c.length} lines (max ${MAX_COMPONENT})`);
    }
  }
}

if (problems.length) {
  console.error(`Too large (split along a seam, see AGENTS.md "Size"):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`Sizes ok: ${files.length} files.`);
