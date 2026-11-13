// The sidecar's logger: records are scrubbed, filtered by verbosity, and leave as KESTREL_LOG lines for the shell.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { plain, scrub } from "../../shared/log-redact";

describe("redaction", () => {
  test("keys, bearer tokens and URL secrets are removed from text", () => {
    const s = scrub('apiKey="sk-abcdefghijklmnopqrstuv" Authorization: Bearer abcdefghijklmnop https://u:pw@h.io/x?token=abc123&a=1 password=hunter2');
    expect(s).not.toMatch(/sk-abc|abcdefghijklmnop|pw@|abc123|hunter2/);
    expect(s).toContain("a=1");
  });
  test("secret-looking field names are masked but counts are kept", () => {
    expect(plain({ apiKey: "x", token: "y", inputTokens: 12, nested: { password: "z", ok: 1 } })).toEqual({ apiKey: "[redacted]", token: "[redacted]", inputTokens: 12, nested: { password: "[redacted]", ok: 1 } });
  });
  test("errors become name, message and a short stack; cycles and huge values are bounded", () => {
    const a: any = { n: 1 };
    a.self = a;
    expect((plain(a) as any).self).toBe("[circular]");
    const e = plain(new Error("boom")) as any;
    expect(e.name).toBe("Error");
    expect(e.message).toBe("boom");
    expect(scrub("x".repeat(10_000)).length).toBeLessThan(4100);
    expect((plain(Array.from({ length: 100 }, (_, i) => i)) as unknown[]).length).toBe(21);
  });
});

// The logger decides where to write when it loads, so each case runs in a fresh process with the flag set.
// `bun -e` drops extra arguments, so the code goes through a temporary file next to the modules it imports.
async function lines(code: string): Promise<string[]> {
  const file = path.join(import.meta.dir, `.probe-${crypto.randomUUID()}.ts`);
  fs.writeFileSync(file, code);
  try {
    const proc = Bun.spawn(["bun", file, "--log-stdout"], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out.split("\n").filter(Boolean);
  } finally {
    fs.rmSync(file, { force: true });
  }
}
const records = (ls: string[]) => ls.filter((l) => l.startsWith("KESTREL_LOG ")).map((l) => JSON.parse(l.slice("KESTREL_LOG ".length)));

describe("logger output", () => {
  test("normal drops debug, verbose keeps it, and warnings always pass", async () => {
    const ls = await lines(`
      import { logger, configureLog, setVerbosity } from "./index";
      const log = logger("t");
      configureLog("normal");
      log.debug("hidden"); log.info("seen"); log.warn("careful", { apiKey: "secret-value" });
      setVerbosity("verbose"); log.debug("now seen");
    `);
    const msgs = records(ls).map((r) => r.msg);
    expect(msgs).toEqual(expect.arrayContaining(["seen", "careful", "now seen"]));
    expect(msgs).not.toContain("hidden");
    expect(ls.join("\n")).not.toContain("secret-value");
    expect(ls).toContain("KESTREL_LOG_LEVEL normal");
    expect(ls).toContain("KESTREL_LOG_LEVEL verbose");
  });

  test("records handed over by a client keep the channel's source, whatever they claim", async () => {
    const ls = await lines(`
      import { ingest } from "./index";
      ingest([{ time: new Date().toISOString(), level: "error", mod: "ui", msg: "render failed", src: "sidecar" } as any], "phone");
    `);
    expect(records(ls)[0]).toMatchObject({ src: "phone", level: "error", msg: "render failed" });
  });

  test("console output is captured and the ready line is left alone", async () => {
    const ls = await lines(`
      import { installProcessHooks } from "./hooks";
      installProcessHooks({ dev: true, dataDir: "/x" });
      console.log("hello"); console.error("bad"); console.log('KESTREL_READY {"port":1,"token":"t"}');
    `);
    expect(ls).toContain('KESTREL_READY {"port":1,"token":"t"}');
    expect(records(ls).map((r) => `${r.mod}:${r.level}:${r.msg}`)).toEqual(expect.arrayContaining(["console:info:hello", "console:error:bad"]));
  });

  test("an uncaught exception is written before the process dies", async () => {
    const ls = await lines(`
      import { installProcessHooks } from "./hooks";
      installProcessHooks({ dev: true, dataDir: "/x" });
      setTimeout(() => { throw new Error("kaboom"); }, 10);
    `);
    expect(records(ls).some((r) => r.level === "error" && r.msg.includes("uncaught") && JSON.stringify(r.fields).includes("kaboom"))).toBe(true);
  });
});
