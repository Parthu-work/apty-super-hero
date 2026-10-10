# Master implementation prompt: rules

Source: the owner's "MASTER IMPLEMENTATION PROMPT: close every open gap in the
Apty Agent and hand over reviewable builds", base `origin/main` at `dc27e2f`.
Each work package is in its own file in this directory. Re-read these files
after a context compaction; never guess scope.

## Owner checklist (as received)

- Reference files `docs/integrations/apty/reference-js/apty-widget-debug-bridge.js`
  and `apty-widget-network-addon.js`: not checked by the owner, and absent at
  `dc27e2f`. WP-B1 is skipped and reported.
- `SKILLS_DECISION`: not edited, so the default `KEEP` applies (WP-D1 skipped).
- Chromium for e2e: not checked by the owner; `/opt/pw-browsers` exists in
  this environment.
- The real-Client run (B1), real-tenant runs (B2) and Studio's manifest change
  (D2) are done by people outside this repository.

## How to work

1. Branch `hardening/open-work` from the latest `origin/main`. Never commit to
   `main`, never merge into `main`, never push any branch or tag, never
   force-push.
2. Keep `docs/STATUS.md` current after every work package. Read `CLAUDE.md`
   and `docs/STATUS.md` first; open long docs only by section; verify with
   `tooling/scripts/verify-quiet.sh` (do not overwrite it); never read
   minified bundles, `dist/assets`, source maps or lockfiles.
3. Evidence over claims: done only with passing tests and pasted output.
   Conflicts between the prompt and the repo go into `REVIEW.md`; follow the
   evidence. Unfinished work is "partial" with exactly what is missing. Never
   delete or weaken a failing test.
4. Every behaviour gets a unit test. Anything crossing the Chrome boundary
   also gets a real-browser test in `tooling/e2e/*.e2e.test.mjs` using the
   helpers in `tooling/e2e/harness.mjs`. Run `npm run build && npm run test:e2e`.
5. Privacy: everything a tool returns can reach an LLM and may be healthcare
   data. Keep redaction on every path to a model; add no network call except
   those named; never log keys; keep `externally_connectable: {"ids": []}`.
6. Scope: only what a work package asks. Anything noticed but not changed goes
   under "Observed, not changed" in `REVIEW.md`.
7. Four checkpoints (A, B, C, D). At each:
   - run `tooling/scripts/verify-quiet.sh typecheck lint test audit build` and
     `npm run test:e2e`, paste summaries;
   - `apty-agent-review-<phase>-<shortsha>.zip` from a clean build (contents of
     `apps/browser-extension/dist`, `manifest.json` at the top);
   - `git bundle create apty-<phase>-<shortsha>.bundle origin/main..HEAD`,
     `git bundle verify`, `SHA256SUMS.txt`, secret scan of the diff;
   - `REVIEW.md`: changes per WP (commit hashes), not done and why,
     "Observed, not changed", a 5-minute owner test script per WP;
   - stop and wait. Fix feedback on the same branch and send a new bundle.
   - Only after "approved" give the apply commands; continue to the next phase
     only after "continue". If a checkpoint was applied to `main`, fetch and
     rebase onto the new `origin/main` (no merge commits) before continuing.
8. Apply commands (only after "approved"; never push yourself):

```bash
git fetch origin main
git checkout main
git pull --ff-only

shasum -a 256 -c SHA256SUMS.txt
git bundle verify ~/Downloads/<bundle-file>
git fetch ~/Downloads/<bundle-file> hardening/open-work:bundle-work

git merge-base --is-ancestor origin/main bundle-work && echo "fast-forward OK"
git log --oneline origin/main..bundle-work
git diff --stat origin/main..bundle-work
git merge --ff-only bundle-work
git push origin main

git branch -d bundle-work
```

With real file names, a rollback (`git revert <first>..<last>`) and a reminder
to confirm GitHub Actions is green afterwards.

## Do not

- Commit to, merge into or push `main` or any remote.
- Skip a checkpoint or continue before "continue".
- Mark anything done without a passing test and pasted output; delete or
  weaken a failing test.
- Add a network call, dependency or permission not named in the prompt.
- Log or store API keys, tokens, URLs with query strings or page content.
- Loosen `externally_connectable`, the approval gate, redaction or a deny list.
- Claim the real Apty Client or real athenaOne / Infor LN tenants were tested.
- Tune DOM Health thresholds without evidence from real-tenant bundles.

## Final report format (each checkpoint)

1. Artifacts (zip, bundle, `SHA256SUMS.txt`, `REVIEW.md`). 2. Per WP: commits,
tests added, evidence. 3. Not done and why. 4. "Observed, not changed".
5. Owner's 5-minute test script per WP. 6. Decisions needed. 7. Anything not
verified, stated plainly.

## Phases

| Phase | Work packages |
|---|---|
| A: security and privacy core | A1, A2, A3 |
| B: real-world readiness | B1, B2, B3, B4, B5 |
| C: product and quality | C1, C2, C3, C4, C5 |
| D: cleanup and release | D1, D2, D3, D4, D5 |
