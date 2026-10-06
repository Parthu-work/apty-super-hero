# WP4. Security hardening

**Status: not started this round.**

Covers: an approval layer for risky tools (`run_console_command`,
`upload_file_to_input`, `computer`, `fill_*`, downloads, cross-origin tab
creation, any extension-ID contact) (B1/B2/H4); real per-site grants
replacing the unused `HostAccessManager` (B4); skill sandbox hardening —
`credentials:"omit"`, network allow-list, response caps, no `esm.sh`
runtime loading (B3); messaging sender checks (`sender.id ===
chrome.runtime.id`) (H3); MCP daemon hardening — origin rejection,
`maxPayload`, tool allowlist (M1); AI endpoint URL validation — block
cloud-metadata/link-local, handle IP-literal forms (M2); ZIP import caps
(M4); `optional_permissions` for `history`/`bookmarks`/`management`,
non-conflicting shortcut (M5); dead-code removal (`external-messaging.ts`,
`claudechrome.com` model-list path, `aipex-*` identifiers); replace
`console.*` calls with a leveled logger; `pnpm audit --prod` remediation
(`ws`, `hono`, `path-to-regexp`, `minimatch`, `lodash`); a hostile-page
end-to-end test.

Per the owner's original prompt, this is called out as a P0 concern
alongside WP1 (the v7 prompt's own §8 explicitly names "a checkpoint also
after WP1 and WP4" as the two most important early gates) — flagged here
so the next round picks this up next, not WP2/3/5-9.

**Gate:** approval and grant tests, hostile-page e2e, daemon tests,
`pnpm audit --prod` high count reduced or justified, manifest validator
enforces permission justification.
