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

Upload the `-webstore` zip to the Chrome Web Store by hand the first time
(the upload creates the listing and assigns its ID). The answers for
the store's privacy form (single purpose, each permission, remote code,
data use) are in [`docs/store/WEB_STORE_LISTING.md`](../store/WEB_STORE_LISTING.md),
and the privacy policy is [`PRIVACY.md`](../../PRIVACY.md).

### Publishing to the Chrome Web Store from the release (optional)

After the GitHub release, the workflow's `webstore` job (KB-RAG K28, A5)
can upload the `-webstore` zip and publish it, with
`tooling/scripts/publish-webstore.mjs` and the Chrome Web Store API v2. It
publishes to the visibility the listing already has, so set the listing to
**Private** (visible to the Apty Google Workspace domain only) in the
developer dashboard once. It acts only when all of these are set in
Settings → Secrets and variables → Actions:

| Name | Kind | Value |
| --- | --- | --- |
| `CWS_PUBLISH` | variable | `1` turns the step on |
| `CWS_PUBLISHER_ID` | variable | The publisher ID from the developer dashboard |
| `CWS_ITEM_ID` | variable | The store's extension ID (`AGENT_WEB_STORE_ID`) |
| `CWS_CLIENT_ID` | secret | The OAuth client of a Google Cloud project with the Chrome Web Store API enabled |
| `CWS_CLIENT_SECRET` | secret | That client's secret |
| `CWS_REFRESH_TOKEN` | secret | A refresh token for the publisher account, with the `https://www.googleapis.com/auth/chromewebstore` scope |

Otherwise the job's summary says "Chrome Web Store: skipped" and names what
is not set (names only, never a value); the GitHub release is not affected.
The summary shows the item ID, the uploaded version and the publish state
(usually `PENDING_REVIEW`), never a secret. A refused upload fails the job
with the HTTP status and the API's error code. The first upload, the
listing and these values are the store owner's; until then the step stays
skipped. To try it by hand:

```bash
CWS_PUBLISH=1 CWS_PUBLISHER_ID=... CWS_ITEM_ID=... CWS_CLIENT_ID=... \
  CWS_CLIENT_SECRET=... CWS_REFRESH_TOKEN=... \
  node tooling/scripts/publish-webstore.mjs --zip apty-agent-vX.Y.Z-webstore.zip
```

To install it on every managed browser, see
[Installing the extension by policy](../security/ORG_POLICY.md#installing-the-extension-by-policy).

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
