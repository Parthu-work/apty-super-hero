# Releasing the extension

0. Rehearse first: `npm run release:dry-run` (or
   `tooling/scripts/release-dry-run.sh --skip-e2e` for a quick pass) runs
   the workflow's build job locally and leaves the packages in
   `/tmp/release-dry-run/release/`; in GitHub, Actions → Release → Run
   workflow with `dry_run` on does the same and uploads the packages
   without publishing. Then run the manual browser checklist,
   [`docs/release/SMOKE_TEST.md`](../release/SMOKE_TEST.md), on Chrome and
   Edge with that package.
1. Bump `version` in `apps/browser-extension/manifest.json` and
   `apps/browser-extension/package.json` to the same `X.Y.Z`.
2. Move the `Unreleased` sections of `CHANGELOG.md` under one `X.Y.Z`
   heading.
3. Merge to `main`, then tag the merge commit and push the tag:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

The `Release` workflow (`.github/workflows/release.yml`) then:

- fails if the tag does not match both version fields
  (`tooling/scripts/check-release-version.mjs`);
- runs, in a job with a read-only token: format check, lint, type check,
  unit tests, the coverage gate, the build, the real-browser tests
  (`npm run test:e2e`), the manifest, architecture, branding, tool, docs
  and skipped-test checks, and that the packaged manifest `key` yields the
  pinned Agent ID (`tooling/scripts/check-extension-id.mjs`);
- packages `apps/browser-extension/dist` twice: `apty-agent-vX.Y.Z.zip`
  keeps the manifest `key` that pins the extension ID (for loading unpacked
  or enterprise policy), and `apty-agent-vX.Y.Z-webstore.zip` drops it,
  because the Chrome Web Store rejects a `key` and assigns its own ID
  ([Extension IDs](../integrations/apty/README.md#extension-ids));
- writes `apty-agent-vX.Y.Z.sha256` for both; a separate job, the only one
  with write access, checks them and creates the GitHub release with all
  three files.

Upload the `-webstore` zip to the Chrome Web Store by hand. The answers for
the store's privacy form (single purpose, each permission, remote code,
data use) are in [`docs/store/WEB_STORE_LISTING.md`](../store/WEB_STORE_LISTING.md),
and the privacy policy is [`PRIVACY.md`](../../PRIVACY.md).

## Extension IDs

`npm run audit:extension-ids` checks that every file in
`docs/integrations/apty/` that lists the Agent's IDs (the reference
module's `DEBUG_AGENT_EXTENSION_IDS`, the README, `CLIENT-PATCH.md`,
`STUDIO.md`) lists the pinned ID from `tooling/e2e/harness.mjs` and the Web
Store ID, and nothing else. Until the store assigns its ID,
`AGENT_WEB_STORE_ID` in `tooling/scripts/check-extension-id.mjs` is `null`,
each file holds a placeholder, and the check reports that as pending.

When the first upload assigns the ID: set `AGENT_WEB_STORE_ID`, replace
every placeholder in one commit (the check fails on any left), record the
ID in the README's [Extension IDs](../integrations/apty/README.md#extension-ids)
table, and tell the Apty Client and Studio teams to add it to their
`externally_connectable.ids`.

## Ask Dapty release checklist

Before tagging a release that carries the Ask Dapty check:

- [ ] **Apty's content CDN (decision C5)**: confirm the default of
      Settings → Apty Integration → "Apty Client: content CDN"
      (`aptyCdnFallback`, on) with Product and Security, and that the
      switch turns every CDN read off.
- [ ] **Default model (decision C6)**: a fresh install's provider form
      opens on Anthropic `claude-sonnet-5-5`, not enabled until a key is
      saved; summaries use `claude-haiku-5-5` on Anthropic. An upgrade keeps
      every saved provider and model.
- [ ] **The three Ask Dapty E2E suites pass** on the release build:

      ```bash
      npm run build
      ```

      ```bash
      node --test --test-timeout=180000 --test-concurrency=1 tooling/e2e/dapty-check.e2e.test.mjs tooling/e2e/dapty-capture.e2e.test.mjs tooling/e2e/dapty-cdn.e2e.test.mjs
      ```

- [ ] **Evidence bundle for SEs**: the release notes tell SEs that, with
      Settings → Troubleshooting → Developer tools on, the Ask Dapty card's
      "Export evidence" saves the redacted bundle the live-tenant cases
      ask for (`docs/development/ask-dapty.md`, "Evidence bundle").
- [ ] `npm run audit:extension-ids` passes (pending is fine until the store
      ID exists).
