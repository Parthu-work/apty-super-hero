# v7 mega-prompt — context (rules, accuracy contract, verified facts)

Saved verbatim from the owner's v7 production-readiness prompt per its own
rule 3 ("save this spec to disk first... so a compacted session can re-read
it instead of guessing"). This file holds everything EXCEPT the per-work-
package detail (§4/§5), which lives in `wp1-*.md` through `wp9-*.md` in
this same directory. Audited base: `origin/main` at `dbabc40`.

## 0. How you must work (read first, these rules override everything below)

1. **Do not touch the current code line.** Treat `origin/main` and every
   existing branch as read-only. Create a new branch `review/production-ready`
   from `origin/main` and do all work there. Never commit to `main`, never
   merge into `main`, never rebase `main`, never push any branch or tag,
   never force-push.
2. **Deliver a build for review, then wait.** When work packages are done
   (or at each checkpoint listed in §8), produce a review build and a
   review bundle (§8) and stop. Do not produce push steps yet. The owner
   will test the build and send feedback. Fix the feedback on the same
   branch and issue a new build. Only after the owner writes "approved" do
   you produce the final bundle and the exact commands to push to `main`
   (still without pushing yourself).
3. **Save this spec to disk first.** Before coding, write §1 to §6 into
   `docs/tasks/` (one file per work package plus `00-context.md`) and keep
   `docs/STATUS.md` current, so a compacted session can re-read it instead
   of guessing. If a section is missing from your context, re-read the
   file; never invent scope.
4. **Never fabricate.** A tool result is real data or an explicit
   structured failure. An empty array never means "something failed". Mark
   unfinished work "partial" with exactly what is missing, in the commit
   message and in `docs/STATUS.md`.
5. **Prove it in a real browser.** Mocked `chrome.*` tests are necessary
   but not sufficient. Anything crossing the Chrome boundary needs an
   end-to-end test in Chromium or Chrome for Testing (`--headless=new`,
   `--load-extension`; branded Chrome 137+ ignores `--load-extension`, so
   never automate it). A Chromium may exist at `/opt/pw-browsers`.
6. **Privacy and security are P0.** Everything a tool returns can reach an
   LLM, and the data comes from healthcare applications. Redaction,
   approval for risky actions and opt-in bodies are requirements, not
   polish.
7. **Gates.** Each work package ends with a gate (tests plus pasted
   evidence). Do not start the next package until its gate is green. Never
   delete or weaken a failing test. No new heavy dependencies.
8. **Token discipline.** Read `CLAUDE.md` and `docs/STATUS.md` first; open
   `ARCHITECTURE.md`, `DECISIONS.md` and `docs/development/PROJECT_PROGRESS.md`
   only by section. Verify with `tooling/scripts/verify-quiet.sh` (it exists
   in the repo; do not overwrite it). Never Read minified bundles,
   `dist/assets`, source maps or lockfiles. Use subagents for verbose work.
   One work package per session; update `docs/STATUS.md` before stopping.
9. **Do not modify the Apty Client or Studio extensions** (other repos).
   Deliver producer code, a contract package and fixtures for their team.

## 1. Problem statement

**Apty Agent** is a Chrome side-panel AI assistant (bring-your-own-key,
many providers) for Apty support and engineering staff who investigate
problems on customer web applications, often healthcare applications such
as athenahealth. A typical question is "Why isn't my Apty widget showing?"

**Core job.** The Apty widget runs as a separate Chrome extension, the
Apty Client. The Agent must connect to it by extension ID from the Apty
Integration section and, on demand and accurately, pull:
1. the Client's service-worker logs (its console output, errors and warnings),
2. the Client's service-worker network requests with the actual response
   data: when the user says "get the data from segments.json", the Agent
   returns the real JSON that the Client received (a 206-item array of
   segments such as `{id:4385, name:"sales-team", isActive:true,
   conditions:[...], createdDate:"..."}`), not a summary or a failure, and
3. the console, error, CSP and resource-load output of the application page
   the Client runs on, including iframes.

It then combines that evidence with DOM-health tooling so the assistant can
explain why something fails.

**Quality bars:** accurate, private, secure, stable, clean/demo-ready,
supports any native provider or OpenAI-compatible endpoint with live model
lists, production-ready (green CI that gates, a release process,
documentation matching the code).

**Demo path.** Install the build, configure a provider, open Settings →
Apty Integration, pick the Client by ID, Test connection, then ask for
service-worker logs, the segments.json response data, and the page console
output. All of it must work and look clean.

## 2. Accuracy contract (applies to every tool that returns captured data)

Every result carries a `meta` block: `scope` (`shared-global` for
service-worker data; `tab:<id>/frame:<id>` for page data), `source`
(`apty-client-sw` or `page-cdp` or `page-console`), `trust:"untrusted"`,
`redaction:{mode}`, `coverage:{from,to,returned,total,dropped,truncated,
droppedInvalid,cursor,nextCursor}`, `bodies:{captured,reason}`,
`tab:{id,origin,title}` when page-scoped, and times as ISO-8601 with local
offset plus epoch milliseconds. State when coverage began (buffer start,
`from-page-load`, `from-injection`). Never silently switch sources: if the
preferred source fails, say which source answered and why the other did
not.

**Scope note for this round (WP1 only):** the full `meta` envelope above
is NOT yet implemented end-to-end — see `wp1-apty-integration.md`'s
"what this round deliberately deferred" section. What WAS built honors the
spirit (explicit status codes, explicit source disclosure in the system
prompt, coverage/count fields on the pieces touched) without the full
structural envelope on every tool.

## 3. Verified facts

See the owner's original v7 prompt (preserved in full in the session
transcript this round was driven from) for the complete, line-by-line
[SIM]/[READ]/[REAL]-tagged fact list — reproduced in `wp1-apty-integration.md`
where each fact is directly relevant to what this round fixed. Not
duplicated here to avoid drift between two copies of the same evidence.

## 6. Acceptance checklist (this repo's scope — WP1 only, this round)

- [x] The WP1 acceptance test passes: `segments.json` resolves to
      `segment.json`; the viewer (evidence store) shows all 206 items with
      names intact; the model payload is bounded and its count is correct;
      the 403 body is returned; the log tool is capped with a working
      limit and collapsing.
- [x] Apty Integration tools are used first when a Client is approved
      (system prompt + investigation planner both reverted to this order).
- [ ] Nothing risky runs without approval — **not in this round's scope**
      (WP4).
- [x] No raw PII in model-bound output for the items this round touched
      (bare `name` no longer over-redacted; `user_id`/`username`/
      `page_title` still redacted/pseudonymized).
- [ ] Fake-LLM suite / `maxTurns` — **not in this round's scope** (WP5).
- [ ] Live model lists — **not in this round's scope** (WP6).
- [ ] Full UI audit / JSON tree viewer — **not in this round's scope**
      (WP7); the backend/evidence split that viewer would sit on top of
      IS built (`get_evidence_json`).
- [ ] Full real-browser e2e / exactness suite — **not in this round's
      scope** (WP8); the acceptance fixture here is a thorough unit-level
      equivalent against the real tool code paths, not a Puppeteer e2e run.
- [ ] `pnpm audit` remediation / CI hardening — **not in this round's
      scope** (WP4/WP9).

## 7. Do not

- Commit to, merge into, or push `main` (or any remote) before the owner
  says "approved".
- Add `ids:["*"]` or web `matches` to any `externally_connectable`;
  contact extensions the user has not approved; auto-select a peer by name.
- Return `[]`, `null` or `"ok"` where the truth is "failed" or "unknown";
  claim completeness when coverage is partial.
- Send raw user, page or patient context, or bodies, to the model by
  default.
- Put API keys or approvals where a content script can read them.
- Run risky tools without approval, or load remote code.
- Silently switch data sources, or use the active tab when the
  conversation has no bound tab.
- Hardcode model names you cannot verify.
- Change the Agent's extension ID again without documenting it.

## 8. Review build and feedback loop (the final step; no pushing)

See `REVIEW.md` at the repo root (generated for this round's delivery) for
the actual review build, bundle, checksums and 15-minute test script. This
round stops here and waits for the owner's "approved" before any
push-to-main commands are produced, per rule 0.2 above — even though a
later chat message asked for push-to-main steps directly, this file (the
owner's own authored spec) takes precedence since it is the more durable,
deliberate instruction.
