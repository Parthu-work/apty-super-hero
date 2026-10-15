#!/usr/bin/env bash
# The release workflow's build job, locally, without publishing: version
# check, checks and tests, build, real-browser tests, audits (including
# pnpm audit --prod), the pinned
# extension ID, packaging, checksums and their verification. One line per
# step; each step's full output is in /tmp/release-dry-run/<step>.log.
#
# Usage: tooling/scripts/release-dry-run.sh [--skip-e2e]
# Packages land in /tmp/release-dry-run/release/.

set -u
cd "$(dirname "$0")/../.." || exit 1

OUT="/tmp/release-dry-run"
rm -rf "$OUT"
mkdir -p "$OUT/release"
skip_e2e=0
[ "${1:-}" = "--skip-e2e" ] && skip_e2e=1

version=$(node -p 'require("./apps/browser-extension/manifest.json").version')
name="v${version}"
status=0

step() {
  local label="$1"
  shift
  local log="$OUT/${label// /-}.log"
  local start end
  start=$(date +%s)
  if "$@" >"$log" 2>&1; then
    end=$(date +%s)
    echo "✓ ${label} ($((end - start))s)"
  else
    end=$(date +%s)
    echo "✗ ${label} ($((end - start))s) — see ${log}"
    status=1
  fi
}

package() {
  local zip="$OUT/release/apty-agent-${name}.zip"
  local store="$OUT/release/apty-agent-${name}-webstore.zip"
  (cd apps/browser-extension/dist && zip -qr "$zip" .) &&
    rm -rf "$OUT/store-dist" &&
    cp -r apps/browser-extension/dist "$OUT/store-dist" &&
    node -e 'const f=process.argv[1],fs=require("fs"),m=JSON.parse(fs.readFileSync(f));delete m.key;fs.writeFileSync(f,JSON.stringify(m,null,2))' "$OUT/store-dist/manifest.json" &&
    (cd "$OUT/store-dist" && zip -qr "$store" .) &&
    unzip -l "$zip" manifest.json | grep -q " manifest.json$" &&
    ! grep -q '"key"' "$OUT/store-dist/manifest.json"
}

checksums() {
  (cd "$OUT/release" &&
    sha256sum "apty-agent-${name}.zip" "apty-agent-${name}-webstore.zip" >"apty-agent-${name}.sha256")
}

verify_checksums() {
  (cd "$OUT/release" && sha256sum -c "apty-agent-${name}.sha256")
}

echo "Release dry run for ${name} (nothing is published)"
step "version check" node tooling/scripts/check-release-version.mjs "$name"
echo "- tag on main: checked by release.yml for a tag push only"
step "format lint typecheck test coverage" bash -c 'npm run format:check && npm run lint && npm run typecheck && npm run test && npm run test:coverage'
step "build" npm run build
if [ "$skip_e2e" = 1 ]; then
  echo "- real-browser tests skipped (--skip-e2e)"
else
  step "real-browser tests" npm run test:e2e
fi
step "audits" bash -c 'npm run validate:extension && npm run audit:architecture && npm run audit:branding && npm run audit:tools && npm run check:mcp-bridge-docs && npm run audit:test-skips && npm run audit:any && npm run audit:docs-links'
step "production dependency audit" bash -c 'pnpm audit --prod && (cd apps/mcp-bridge && pnpm audit --prod --ignore-workspace)'
step "pinned extension ID" node tooling/scripts/check-extension-id.mjs apps/browser-extension/dist/manifest.json
step "package" package
step "checksums" checksums
step "verify checksums" verify_checksums

if [ "$status" = 0 ]; then
  echo "Packages: $OUT/release/"
fi
exit $status
