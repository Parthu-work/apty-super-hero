# Releasing the extension

1. Bump `version` in `apps/browser-extension/manifest.json` and
   `apps/browser-extension/package.json` to the same `X.Y.Z`.
2. Move the `Unreleased` section of `CHANGELOG.md` under a `X.Y.Z` heading.
3. Merge to `main`, then tag the merge commit and push the tag:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

The `Release` workflow (`.github/workflows/release.yml`) then:

- fails if the tag does not match both version fields
  (`tooling/scripts/check-release-version.mjs`);
- runs lint, type check, unit tests, the build, the real-browser tests
  (`npm run test:e2e`) and the manifest check;
- zips `apps/browser-extension/dist` as `apty-agent-vX.Y.Z.zip`, writes a
  `.sha256` checksum next to it, and creates a GitHub release with both.

Upload the zip to the Chrome Web Store by hand. The store listing needs a
justification for the `debugger` permission and `<all_urls>` host access;
see `docs/security/PERMISSIONS.md`.
