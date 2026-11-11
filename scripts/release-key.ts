// Creates the Ed25519 key that signs release manifests, once. The private half stays outside the repository
// (~/.config/kestrel-release/signing-key.pem, readable by you only); the public half is written into
// sidecar/update/key.ts so every build can check what it downloads. Rerunning keeps the existing key.
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const KEY_PATH = process.env.KESTREL_RELEASE_KEY ?? path.join(os.homedir(), ".config", "kestrel-release", "signing-key.pem");

if (import.meta.main) {
  if (!fs.existsSync(KEY_PATH)) {
    const { privateKey } = generateKeyPairSync("ed25519");
    fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true, mode: 0o700 });
    fs.writeFileSync(KEY_PATH, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    console.log(`Created ${KEY_PATH}. Back it up: without it no further update can be published to existing installs.`);
  }
  const pub = createPublicKey(createPrivateKey(fs.readFileSync(KEY_PATH))).export({ type: "spki", format: "der" }).toString("base64");
  const out = path.join(import.meta.dir, "..", "sidecar", "update", "key.ts");
  fs.writeFileSync(
    out,
    `// The public half of the release signing key (scripts/release-key.ts). Updates signed by anything else are refused.\nexport const RELEASE_PUBLIC_KEY = "${pub}";\n`,
  );
  console.log(`Public key written to ${path.relative(process.cwd(), out)}`);
}
