// New default allowlist entries reach existing installs once, without undoing what the user removed.
import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as store from "./db";
import { BASH_WHITELIST_ADDED_V2 } from "./permissions";

test("added defaults merge into a saved allowlist once, and removals stick", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-bash-defaults-"));
  store.openDb(dir, true);
  // An install from before the second revision: its own list, without the added entries.
  store.saveSettings({ bashWhitelist: ["ls", "my-tool"] });
  store.db.run("DELETE FROM meta WHERE key = 'bash_defaults_rev'");
  store.db.close();
  store.openDb(dir, true);
  const merged = store.getSettings().bashWhitelist;
  expect(merged.slice(0, 2)).toEqual(["ls", "my-tool"]);
  for (const e of BASH_WHITELIST_ADDED_V2) expect(merged).toContain(e);
  // The user removes one of the new entries; reopening must not bring it back.
  store.saveSettings({ bashWhitelist: merged.filter((e) => e !== "git grep") });
  store.db.close();
  store.openDb(dir, true);
  expect(store.getSettings().bashWhitelist).not.toContain("git grep");
  store.db.close();
});
