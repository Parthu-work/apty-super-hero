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
  because the Chrome Web Store rejects a `key`;
- writes `apty-agent-vX.Y.Z.sha256` for both; a separate job, the only one
  with write access, checks them and creates the GitHub release with all
  three files.

Upload the `-webstore` zip to the Chrome Web Store by hand. The answers for
the store's privacy form (single purpose, each permission, remote code,
data use) are in [`docs/store/WEB_STORE_LISTING.md`](../store/WEB_STORE_LISTING.md),
and the privacy policy is [`PRIVACY.md`](../../PRIVACY.md).
