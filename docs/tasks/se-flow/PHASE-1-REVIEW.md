# Phase 1 review: workflows, 4.x and 5.x

Running record for the owner's review (PHASE-1-WORKFLOWS.md §8). Filled in
as each work package lands; the final hand-over completes every section.

Branch `claude/blissful-cannon-g8o8bz`, started from
`claude/amazing-gauss-1q2tme` at `f6b682e`.

## 1. Commits per work package

| WP | Commit | Summary |
|---|---|---|
| WP0 | `5f8fdaa` | Baseline and status rows |
| A1 + A2 | (this commit) | One host gate for every path; fetch time and byte limits; abort on case close |

## 2. Test output

### WP0 baseline (`f6b682e`)

- `npm run preflight`: green. Unit tests: agent-core 724, browser-runtime
  2,277, ui 535, browser-extension 790, dom-snapshot 468,
  apty-debug-contract 151, mcp-bridge 72, tooling scripts 305.
- `npm run build`: green. `replay-source.e2e.test.mjs`: 3 of 3.
- Audits: all green except `lint:dependencies` (nine test-only exports of
  the replay slice), fixed in A1 + A2.

### A1 + A2

- `npm run preflight`: green. Unit tests: agent-core 734 (+10),
  browser-runtime 2,296 (+19), the rest unchanged.
- Every master §1.4 audit green, `lint:dependencies` included;
  `policy:check` passes on each file in `tooling/scripts/policy/fixtures/expected/`.
- E2E (targeted: every file on a changed path): `replay-source` 3/3,
  `dapty-cdn` 5/5, `dapty-capture` 3/3, `client-test-recorder` 3/3,
  `four-x-evidence` 2/2, `get-evidence` 3/3, `visibility-check` 16/16,
  `org-policy` 4/4, `cases` 3/3. The full suite was started and stopped
  after 7 of 85 files (all passing): at this machine's pace it takes about
  8 hours, so it runs once for the Phase 1 hand-over.
- Found by E2E and fixed before the commit: with the host refused, the
  legacy page-probe path also reported "no Apty config", hiding a 5.x
  player that is on the page; it now keeps the probe and withholds only
  the files.

## 3. Fail-then-pass proofs

### A1 + A2

The new tests were run against the previous source (the six changed
browser-runtime source files stashed, the new tests kept): 18 failed, among
them

- `refuses a page-named host off Apty's content domain, with no request, naming the policy key`
- `refuses a given host that equals a private page host`
- `checks each version's ID shapes before any request`
- `keeps the time limit running while a body drips in, and caches nothing` (hung for the 30 s test timeout: the old timer stopped at the headers)
- `stops reading a body past the per-file byte cap, without Content-Length`
- `refuses a body whose Content-Length is over the cap before reading it`
- `counts bytes across the case and stops past the per-case cap`
- `aborts what is under way when the case closes`
- `calls no host the page names off Apty's content domain unless the policy lists it` (the legacy page-probe path)
- `closes the conversation's Apty case, aborting its content requests (A2)`

With the change, all pass.

## 4. Owner decisions as answered (2026-11-28)

Every default in master §5 and AUDIT-CORRECTIONS §E, with:

- D-RELEASES: per-environment widget display from player 5.2.4 (§F1). The
  release containing `a2d73e67` (step wait time, §F2) is unknown: those
  rows stay `candidate` and show both values.
- D-KB: not yet. `askDapty` stays absent and no Ask Dapty call is made.

## 5. Facts found changed

- apty-dap moved past the pin (`3f3adba` → `dc502c81`); §F of
  AUDIT-CORRECTIONS records the two commits that change the web player.
- 5.x IDs: `app-urls.json` types application and environment IDs only as
  strings (`application.schema.ts:279-282@3f3adba`); the UUID shape comes
  from the tenant and application schemas (`user.schema.ts:37`,
  `application.schema.ts:256`). The Agent requires UUIDs for all three, as
  A1 says.
- 4.x tenant keys are shortid-style (`player3.0/config/config.json:7`:
  `yA87eWGa`; server `publishing.helpers.ts:820` knows `dynamics365…`
  prefixes), so the 4.x tenant shape is `[A-Za-z0-9_-]{1,64}`.
- 4.x `host_permissions` also include `http://*.apty.io/*`
  (`manifests/manifest.json:11`); with D-HTTP-ONPREM = no, the Agent
  refuses plain http there unless the policy lists the origin.

## 6. Test changes (setup only, and one migrated assertion)

A1 refuses page-named hosts off Apty's domains and IDs of the wrong shape,
so existing fixtures that used `*.apty.example` hosts or IDs such as `t1`
were moved onto valid ones. Assertions are unchanged except where noted.

| File | Change |
|---|---|
| `browser-runtime/src/apty/replay/content-source.test.ts` | Hosts `content.apty.example` → `content.apty.ai`; the "no environment matches" input `nope` → a UUID no app lists; the two 4.x tests list their host in the policy (a 4.x host on `*.apty.ai` is not a 4.x Apty domain); the body-limit constant renamed to bytes. **Migrated:** "a page-named public IP literal (`172.32.0.1`) resolves" now asserts `host_not_allowed`, because no IP literal is an Apty content host (A1) |
| `browser-runtime/src/apty/replay/catalogue.test.ts` | IDs `t1`/`a1`/`e1` → UUIDs (the expected paths built from them) |
| `browser-runtime/src/apty/replay/case-replay.test.ts`, `src/tools/apty-content.test.ts`, `src/apty/apty-cdn-source.test.ts` | Hosts onto `*.apty.ai`; IDs onto UUIDs |
| `browser-runtime/src/apty/diagnosis/dapty-evidence.test.ts` | Host `client.apty.example` → `client.apty.ai`; the "no host in the Strict bundle" list follows the rename, so the assertion still checks the host |
| `tooling/e2e/replay-source.e2e.test.mjs`, `dapty-cdn.e2e.test.mjs` | Run on the E2E policy build with `aptyContentOrigins` = the fake loopback content host |
| `tooling/e2e/get-evidence.e2e.test.mjs` | Same, for the fake 5.x Client's content URL (`http://127.0.0.1:1`). Without it the Ask-for-evidence card no longer learns "5.x" from a CDN read and offers the 4.x HAR; that card should take the version from the page probe instead (WP2 probes give it), noted for WP2 |

## 7. Partial, and why

- A2's per-case `AbortSignal` reaches `fetchFile` (case close, conversation
  delete, an optional caller signal). The Ask Dapty client and page reads
  it must also reach are built in WP11 and WP5; the responder context's
  `signal` (B1) comes with WP7.

## 8. Not run

- No real tenant, Ask Dapty KB or real model (none given).
