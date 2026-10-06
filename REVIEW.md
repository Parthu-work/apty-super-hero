# Review build — v7 WP1 ("Apty Integration pulls logs and response data perfectly")

Branch `review/production-ready`, cut from `origin/main` at `dbabc40` (the
v7 prompt's own stated audited base — confirmed matching). Per the v7
prompt's own rule 0.2, **nothing has been pushed, and this is
not a push-ready build** — it's a review checkpoint. This file, the build
zip, the git bundle and checksums are the deliverable; after you test it
and send feedback, the next round fixes it on this same branch and issues
a new build. Only once you write "approved" does a round produce the
final push-to-main bundle and commands.

## 1. Scope of this round (read this first)

The v7 prompt is nine work packages, each with its own real-browser gate —
genuinely weeks of work. This round scoped to **WP1 only**, and within
WP1, to the concrete correctness bugs that are the actual substance of
"pull logs/data perfectly," rather than also attempting WP1 item 2's full
wire-protocol rewrite (`ExtensionPeerClient`) in the same pass. A prior
session's attempt at doing both at once is exactly why that draft shipped
broken: 38 failing tests, the acceptance fixture never built, zero tests
on its new module. See `docs/STATUS.md`'s "Audit of a WP1 draft" section
for the full findings from reviewing that attempt (not applied, not built
on — this round re-implemented WP1 from scratch against the real repo).

**What's in this build**, with a permanent regression test for all of it
together (`packages/browser-runtime/src/apty/wp1-acceptance.test.ts`):

| Fix | What changed |
|---|---|
| Routing | System prompt and investigation planner both try the Apty Client/cross-extension path FIRST when a Client is configured; page-level capture is the fallback. (Reverts `c17c241`/`7c37064`'s capture-first order from a prior round.) |
| Tolerant matching | "segments.json" now finds a resource actually named "segment.json" — case-insensitive, singular/plural, extension-optional, query-string-insensitive. "Did you mean" suggestions on no match; discloses when several resources matched. |
| Bodies for every status | A 403/500 response's body (often the actual error message) is now returned, not just a bare failure — previously only 2xx bodies came back. |
| Bounded payloads | A large JSON body (e.g. 206 segments) now gives the model a small structured summary (count, keys, a few sample items) instead of a blind 8000-character text slice that could cut off mid-item. A new `get_evidence_json` tool lets the model page through the FULL body afterward on request — the full body is always available, just not force-fed on the first call. |
| Log output | Service-worker logs default to 50 entries, collapse repeated identical lines (`×N`), truncate long messages (expandable), and report counts per level. |
| PII fix | A bare `name` key (a segment/flow/feature name) is no longer wholesale-redacted as if it were a person's name — it never should have been; real person-identifying keys (`fullName`, `firstName`, `username`, ...) still are. |

**Explicitly NOT in this build** (see `docs/tasks/wp1-apty-integration.md`
for the complete list and why): the full `ExtensionPeerClient` wire-protocol
rewrite, cursor persistence across service-worker restarts, peer config
migration, tool renaming, the polished JSON-tree-viewer UI component (its
backend is built; the UI panel itself is WP7 scope), and any real-browser
Puppeteer e2e run (this round's fixture is unit-level against mocked
`chrome.*`, the same pattern every other test in this codebase already
uses — thorough, but not a substitute for WP8's real-browser gate). WP2
through WP9 are entirely untouched this round; their spec text is saved to
`docs/tasks/wp2-*.md` through `wp9-*.md` for whenever they're picked up.

## 2. Files in this delivery

| File | What it is |
|---|---|
| `apty-agent-review-wp1.zip` | Production build of `apps/browser-extension/dist`, built from a clean tree (`pnpm install --frozen-lockfile`, `pnpm build`). Unzip and "Load unpacked" in `chrome://extensions`. |
| `apty-review-wp1.bundle` | Git bundle of every new commit (`origin/main..review/production-ready`), verified with `git bundle verify`. Requires `origin/main`'s current `dbabc40` as a prerequisite — confirmed present. Run `git log --oneline origin/main..review/production-ready` after fetching it to see the exact commit list. |
| `SHA256SUMS.txt` | Checksums for both files above. |
| `REVIEW.md` | This file (also committed at the repo root on the review branch). |

## 3. Verification run this session

`tooling/scripts/verify-quiet.sh typecheck lint test build audit` — all
green. 522 tests passing in `packages/browser-runtime` (9 new acceptance
tests, 2 pre-existing tests updated to match the corrected redaction
behavior, the rest unaffected). Clean production build including
`apps/mcp-bridge` and the tailwind-sources check (100% coverage). `dist/`
checked for `.env` files, source maps, and test-only markers — none found.
`manifest.json`'s `key` field present and unchanged — extension ID is
unchanged from your currently-installed copy. Diff secret-scanned against
AWS/GitHub/Slack/Google/Anthropic key shapes and PEM headers — 0 matches.

## 4. Expected Agent extension ID

Unchanged from your current install — this round didn't touch
`manifest.json`.

## 5. How to load this build

```
unzip apty-agent-review-wp1.zip -d apty-agent-review-wp1
```
Then `chrome://extensions` → enable Developer mode → remove any previously
loaded copy if you want a clean reload → "Load unpacked" → select the
`apty-agent-review-wp1` folder (the one containing `manifest.json` at its
top level).

## 6. 15-minute test script

1. Configure an AI provider in Settings and confirm "Test connection" succeeds.
2. Settings → Apty Integration → confirm your Apty Client extension ID is
   configured (unchanged from before this round).
3. Ask the agent: *"start a network capture, reload this page, then stop
   the capture and show me segments.json's data"* — wait, actually test
   the PRIMARY path this round restored: with the Apty Client connected,
   just ask directly: *"get the data from segments.json"* (or whatever
   resource your real Apty Client actually serves). Confirm:
   - It tries `inspect_extension_network` FIRST (not page capture) — it
     should state the Apty Client integration answered.
   - If your real resource is named slightly differently (plural/singular,
     with/without extension) than what you typed, it should still find it
     — this is the tolerant-matching fix.
   - If the resource ever returns a non-200 status in your environment,
     confirm the error body comes back rather than a bare failure.
4. Ask: *"get the Apty Client's service worker logs"* — confirm the
   response is capped (not a wall of hundreds of lines), repeated
   identical lines are shown once with a count, and nothing looks like raw
   PII (emails, user ids) in the returned text.
5. If you have a resource with a real `name`/configuration field, confirm
   it's NOT shown as `<REDACTED>` anymore (the fixed bug).
6. Reload the extension (`chrome://extensions` → refresh icon) and confirm
   your Apty Client connection/approval still works afterward (this round
   didn't touch persistence, but worth re-confirming nothing regressed).

**What to report back:** anything in steps 3-5 that doesn't match, any
console errors, and whether the real Apty Client's actual resource/log
shapes differ from what this round's acceptance fixture assumed (206-item
array, 403-with-XML-body, etc.) — real-world shape mismatches are exactly
what a review round like this is for catching before WP8's real-browser
e2e work.

## 7. Known, not-yet-addressed items

See `docs/tasks/wp1-apty-integration.md`'s "explicitly deferred" list and
`docs/STATUS.md` for the full detail. In short: the deeper wire-protocol
rewrite (cursor persistence, full identity/contract-mismatch error
handling, peer config migration) and WP2 through WP9 in their entirety.
None of them block the core demo path this round targeted.

## 8. Rollback

`git reset --hard origin/main` on the `review/production-ready` branch
drops all 5 of this round's commits. Nothing has touched `main` or any
other branch.
