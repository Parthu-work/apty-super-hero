# Releasing the extension

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
  (`npm run test:e2e`) and the manifest, architecture, branding, tool and
  docs checks;
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
