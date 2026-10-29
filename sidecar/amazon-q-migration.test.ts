// Provider renaming must preserve credentials and every foreign-key reference in existing databases.
import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProviderConfig } from "../shared/protocol";
import * as store from "./db";
import { modelDefaults, PROVIDER_PRESETS } from "./providers";
import { createSession } from "./sessions";

test("legacy provider migration preserves IDs, credentials, model settings and session references", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-amazon-q-migration-"));
  store.openDb(dir, true);
  const provider: ProviderConfig = { id: "legacy-q", name: "Kiro", kind: "amazon-q", apiKey: "ksk_existing", baseUrl: "https://q.us-east-1.amazonaws.com/", headers: { "x-custom": "preserved" }, enabled: true, createdAt: 1234 };
  store.upsertProvider(provider);
  store.upsertProvider({ ...provider, id: "custom-q", name: "My inference service" });
  store.upsertModel({ providerId: provider.id, ...modelDefaults("amazon-q", "test-model", "Original model", 321000, { maxTokens: 12345 }) });
  const session = createSession({ cwd: dir, providerId: provider.id, modelId: "test-model", title: "Original session" });
  store.saveSettings({ defaultProviderId: provider.id, defaultModelId: "test-model" });
  // Recreate the state immediately before the new migration was introduced.
  store.db.run("UPDATE providers SET kind = 'kiro'");
  // Roll back the later metadata migration too, rather than assuming the rename is last forever.
  store.db.run("ALTER TABLE models DROP COLUMN metadata_source");
  store.db.run("ALTER TABLE models DROP COLUMN metadata");
  store.db.run("DELETE FROM _migrations WHERE version >= (SELECT max(version) - 1 FROM _migrations)");
  store.db.close();
  store.openDb(dir, true);
  expect(store.getProvider(provider.id)).toEqual({ ...provider, kind: "amazon-q", name: "Amazon Q" });
  expect(store.getProvider("custom-q")?.name).toBe("My inference service");
  expect(store.getModel(provider.id, "test-model")?.maxTokens).toBe(12345);
  expect(store.getModel(provider.id, "test-model")?.contextWindow).toBe(321000);
  expect(store.getSession(session.id)?.providerId).toBe(provider.id);
  expect(store.getSession(session.id)?.modelId).toBe("test-model");
  expect(store.getSettings().defaultProviderId).toBe(provider.id);
  expect(PROVIDER_PRESETS["amazon-q"].name).toBe("Amazon Q");
  expect("kiro" in PROVIDER_PRESETS).toBe(false);
  // A stale paired client must not reintroduce the old type after migration.
  store.upsertProvider({ ...provider, kind: "kiro" } as unknown as ProviderConfig);
  expect(store.getProvider(provider.id)?.kind).toBe("amazon-q");
});
