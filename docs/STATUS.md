# Status — v6 mega-prompt round

Tracks progress against the v6 mega-prompt's 13 work packages (WP1–WP13),
audited against `main` at `6b84f4a`. Updated before stopping, per rule 8.

## Phase 0

No separate Phase 0 inventory commit was made this round — the v5 round's
Phase 0 table (`5f0171f`, "Phase 0 table, UI audit, and DECISIONS.md entry
for the v5 round") already covers the repo inventory the v6 prompt's rule 8
asks for, and nothing in the repo's structure changed between `6b84f4a` and
the start of this round that would invalidate it.

**Flag**: rule 8 says to install `.claude/skills`, `.claude/agents`, and
`tooling/scripts/verify-quiet.sh` "from the supplied kit" if they don't
already exist. No such kit was attached to this session. `.claude/skills`
and `.claude/agents` do not exist in this repo and were **not** fabricated —
only `tooling/scripts/verify-quiet.sh` was written (this round, as part of
WP1), since its purpose (one-line-per-step verification output) was fully
specified in rule 8's own text and didn't depend on an external kit's
contents.

## WP1 — Quick fixes and hygiene

| # | Item | Status | Commit |
|---|---|---|---|
| 1 | Remove `byokEnabled` entirely, with migration | Done | `9257066` |
| 2 | Fix MCP install instructions / package identity | Done | `08e8421` |
| 3 | `maxTurns` default 2000 → 30 | Done | `9257066` (bundled — same file as item 1) |
| 4 | `resolveDiagnosticTab` never silently uses the active tab | Done | `75e7ef8` |
| 5 | Evidence store de-dup + per-source quotas | Done | `9031b3c`, with a follow-up correctness fix in `a720de1` (see below) |
| 6 | Permission audit → `docs/security/PERMISSIONS.md` + validator enforcement | Done | `e67598b` |
| 7 | Dynamic content-script registration (replace static `<all_urls>` MAIN-world console-bridge) | **Not attempted — deferred with reasoning** | — |

### Item 5's follow-up fix

`9031b3c`'s original de-dup key used `requestId ?? timestamp` as its
fallback for evidence with no `requestId`. Running the full verification
suite surfaced a real bug: two distinct, legitimately-different log entries
recorded synchronously in the same tool call can share the same
`Date.now()` millisecond, so the timestamp fallback silently treated the
second as a duplicate of the first and dropped it (caught by a pre-existing
test in `devtools.test.ts` going from 3 expected evidence records to 2).
Fixed in `a720de1`: the fallback is now `JSON.stringify(data)` (content),
not `timestamp`, with a new regression test reproducing the exact
collision. Verified via `packages/browser-runtime`'s full test suite plus
`tooling/scripts/verify-quiet.sh typecheck lint test build audit` (all
green) before committing.

### Item 7 — why it's deferred, not done

See `DECISIONS.md`'s "WP1.7 ... not converted to dynamic registration this
round" entry for the full reasoning. In short: this product's `host_permissions:
<all_urls>` is justified specifically because it debugs *whatever page the
user currently has open* — a fixed host allow-list (what WP1.7 as literally
specified asks for) would defeat that premise, not just narrow it. A
different, real narrowing (registering the bridge per-tab only once a
conversation binds to that tab, instead of on every page load) is plausible
but is a genuine behavior and timing change to a core diagnostic feature
that this round's verification budget (vitest + static validators, no live
interactive Chrome session) cannot fully validate. Left for a dedicated
future session with the WP16 real-Chromium harness exercising: a
slow-loading page, a page that never binds a conversation, and a
mid-session re-bind to a second tab.

## WP2–WP13

Not started this round. WP1 was this session's sole work package, per rule
8 ("one work package per session").

## Verification

`tooling/scripts/verify-quiet.sh typecheck lint test build audit` is green
as of the last commit (`e67598b`) on `claude/confident-hawking-1b8l61`.

## Delivery

Per rule 9, nothing has been pushed to `main` or any remote. All 6 commits
this round (`9257066` through `e67598b`) are local to
`claude/confident-hawking-1b8l61`, on top of `main`'s `6b84f4a`. Delivery
artifacts (build zip, git bundle, SHA256SUMS, DELIVERY.md) per v6 §8/§13
have **not** been produced this round — §13 reads as gated on "every gate
above is green," i.e. all 13 work packages, not WP1 alone. Flagging this
interpretation rather than assuming it: if delivery is instead wanted after
each work package (the pattern used in prior v1–v5 rounds), say so and it
can be produced for WP1's diff alone.
