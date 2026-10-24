# WP9. CI, release readiness and documentation

**Status: not started this round.**

Covers: CI gating — the `apps/mcp-bridge` install step (B5), `packageManager`/
`engines`, `pnpm audit`/knip/CodeQL/secret scanning, pinned actions by SHA,
coverage thresholds on security-critical modules; a release job (build,
zip, checksum, upload), `docs/release/CHECKLIST.md`, a changelog tied to
the manifest version, a compatibility matrix, a `VITE_APTY_PEERS=false`
rollback flag, Web Store permission justifications; rewriting
`SECURITY_AUDIT.md`/`README.md`/`ARCHITECTURE.md`/`DECISIONS.md`/
`TROUBLESHOOTING.md`/`VERIFY.md` to match the code; a list of decisions
needed from the owner (default privacy mode, whether bodies may ever be
captured in production, who may enable the producer in production builds,
log retention, allow-listed Agent IDs per environment, demo LLM
provider/model/key tier, whether skills ship at all).

**Gate:** CI green on a fresh clone including the mcp-bridge install;
release checklist script green.
