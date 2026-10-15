#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
mkdir -p src-tauri/binaries
bun build sidecar/main.ts --compile --minify --sourcemap=none --outfile "src-tauri/binaries/helm-agent-${TRIPLE}"
echo "built src-tauri/binaries/helm-agent-${TRIPLE}"
