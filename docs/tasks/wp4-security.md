# WP4. Security hardening

**Status: most of the originally-scoped items done this round.** See
`DECISIONS.md` for the full reasoning behind each; this file tracks
done/not-done against the original scope below.

## Done this round

- **B1/B2 — approval layer for risky tools.** `run_console_command` and
  `upload_file_to_input` now gate their real side effect behind explicit,
  in-conversation user approval (`packages/browser-runtime/src/tools/
  approval.ts`'s `gateRiskyAction`/`confirm_risky_action`) — no risky
  action runs on a tool's first call, ever. Extended to `fill_element_by_uid`/
  `fill_form` (gated in full), `computer`'s `type`/`key` actions only
  (pointer actions — click/scroll/hover/drag — stay ungated, same
  distinction `element.ts` already draws between `click` and `fill_*`),
  and `download_image`/`download_chat_images` (gated in full; no
  page-origin concept applies to a local-disk write, so these always
  re-prompt rather than remembering a per-origin grant). `create_new_tab`
  (cross-origin tab creation) and cross-extension messaging (extension-ID
  contact) were investigated and deliberately left ungated — see
  `DECISIONS.md`'s "WP4 follow-up" entry for why (a core browsing
  primitive with no articulated specific risk vs. a capability that turns
  out not to be exposed to the model as a tool at all).
- **B4 — real per-site grants**, but via a new, narrower mechanism rather
  than resurrecting `HostAccessManager`: once a risky action is approved
  on a page origin, that origin is persisted (`chrome.storage.local`) so
  later calls on the *same* origin skip re-asking. `HostAccessManager`
  itself (`apps/browser-extension/src/services/host-access.ts`) is left
  in place, still unused — deleting dead code was judged lower priority
  than not risking a confusing mode-switch behavior change by rewiring it.
- **H3 — messaging sender checks.** `message-router.ts`/`mcp-bridge.ts`'s
  privileged handlers (`relay-to-active-tab`, `start-recording`,
  `stop-recording`, `ws-bridge-connect`) now require `!sender.tab` (ruling
  out a content-script-mediated path from an arbitrary page) alongside
  `sender.id === chrome.runtime.id`.
- **M1 — MCP daemon hardening.** `maxPayload` bound on all three
  WebSocket servers; `/bridge` and `/cli` now reject *any* present
  `Origin` header, not just web-page-shaped ones; a `DANGEROUS_TOOL_NAMES`
  allowlist gate (`--allow-dangerous-tools`, off by default) on
  `tools/call`.
- **M2 — AI endpoint URL validation.** Rewrote `validateHostUrl`
  (`apps/browser-extension/src/services/ai-provider.ts`) to classify the
  full private/loopback/metadata IPv4+IPv6 space (reusing the SSRF
  range-detection helpers already built for the skill fetch sandbox,
  `@apty/browser-runtime/vm/url-guard`) instead of an exact-string
  blocklist that was also only active in PROD builds and never blocked
  plain `http:`. Cloud metadata is always blocked; other private ranges
  are blocked unless the host is loopback (so local model servers like
  Ollama keep working); `http:` is only allowed for a confirmed-loopback
  host.
- **`pnpm audit --prod` remediation.** 76 advisories (1 critical, 24 high)
  down to 1 accepted-risk high with no upstream fix available (documented
  exception, see `DECISIONS.md`'s H2 entry) for the root workspace;
  `apps/mcp-bridge`'s separate lockfile: 55 down to 0.
- **B3 — skill sandbox**, scoped down from the original ask. Did NOT
  implement `credentials:"omit"`/a network allow-list/response caps, and
  did NOT remove `esm.sh` runtime loading (removing the CDN-loading
  capability entirely would mean skills can never use any third-party
  package, a much larger product change than this round's scope). Instead:
  added `requirePinnedVersion()` so a CDN import must specify an exact
  version (closes "same import silently resolves to different code
  tomorrow", not full SRI-style integrity pinning, which `esm.sh` doesn't
  support), and gated the entire skills feature behind a new, off-by-
  default settings toggle (`AppSettings.skillExecutionEnabled`) with an
  explicit in-UI warning — the escape hatch the original spec itself
  suggested, given the real remaining residual risk (documented
  DNS-rebinding gap in `url-guard.ts`, unchanged) wasn't closeable within
  this round without a different network primitive.
- **CI gaps found and fixed in the same pass** (not originally itemized
  under WP4, but found during this audit): `apps/mcp-bridge` had no CI
  install step at all (every `typecheck`/`test`/`build` step touching it
  would fail on a clean checkout); no `pnpm audit` gate; the three GitHub
  Actions used were unpinned (tag, not SHA). See `DECISIONS.md`'s B5
  entry.

- **M4 — ZIP import caps.** `extractZipToFS`/`parseSkillMetadataFromZip`
  (`packages/browser-runtime/src/skills/lib/utils/zip-utils.ts`) now
  reject (before decompressing, via `unzipSync`'s per-entry `filter`
  callback): any `..` path-traversal segment, more than 2000 entries, any
  single entry over 20MB uncompressed, and a cumulative uncompressed size
  over 50MB. Found and removed a stale hand-written `declare module
  "fflate"` ambient type shim along the way — it was silently shadowing
  fflate's own real (much richer) shipped types, and specifically blocked
  the `filter` option this fix needed. See `DECISIONS.md`.
- **M5 — `optional_permissions` + keyboard shortcut.** `bookmarks`,
  `history`, `management` moved from unconditional `permissions` to
  `optional_permissions`; a new Options-page panel
  (`entrypoints/options/permissions-panel.tsx`) requests/removes each via
  `chrome.permissions.request`/`.remove` from its own toggle click. Judged
  safe with zero code changes at the three real call sites — each already
  handled the permission being absent. `validate-manifest.mjs` updated to
  check `optional_permissions` against `docs/security/PERMISSIONS.md` the
  same way as unconditional ones. Also fixed the `open-apty-agent`
  shortcut: `Command+M` conflicts with macOS's system-wide "Minimize
  Window" and (verified against Chrome's own docs) has never actually
  fired on Mac; changed to `Command+Shift+A`/`Ctrl+Shift+A` (Chrome's own
  documented-recommended pattern).

## Not done this round (deferred)

- **Dead-code removal** (`external-messaging.ts`, the `claudechrome.com`
  model-list path, `aipex-*` identifiers).
- **Replacing `console.*` calls with a leveled logger.**
- **A hostile-page end-to-end test** — needs the WP8 real-browser e2e
  harness, which doesn't exist yet.

**Gate (original, not yet fully met):** approval and grant tests (✅,
across all tools brought under the gate so far), hostile-page e2e (❌ not
built), daemon tests (✅), `pnpm audit --prod` high count reduced or
justified (✅), manifest validator enforces permission justification (✅
— extended to cover `optional_permissions` too).
