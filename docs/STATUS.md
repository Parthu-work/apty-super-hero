# Status

What works today, what is still open, and where to look. History of how it
got here is in [`CHANGELOG.md`](../CHANGELOG.md) and
[`docs/development/STATUS_HISTORY.md`](development/STATUS_HISTORY.md).

## Working, with real-browser tests

`npm run test:e2e` runs each of these in Chromium against the built
extension (see [`tooling/e2e/README.md`](../tooling/e2e/README.md)).

- Chat with your own AI provider; a readiness check shows the model, the
  Apty Client connection and whether the page can be inspected.
- Risky actions wait for a click in the side panel and are refused if the
  tab moved to another site meanwhile; "Allow on this site for 15 min" is
  per tool and origin and can be revoked. Since A1 this covers clicks on
  submit controls, destructive or confirming labels and cross-origin links
  (`click` and `computer`), and `create_new_tab` to another origin; a URL
  with a long query or a non-web scheme always asks.
- DOM Health in same-origin, cross-origin, `data:` and frameset frames,
  open and closed shadow roots, and tabs opened before an extension update. Virtualized lists (B4) are reported
  as partial coverage with the rendered and declared row counts.
- Page console output (including during page load), network capture with
  opt-in response bodies, runtime diagnostics, screenshots, clicks and
  scrolling. The page-world script behind console capture and routing
  evidence can be turned off or excluded per site (B5), registered by the
  service worker.
- Apty Client logs and resource bodies, with named connection failures and
  a full-response viewer. The Data-handling deny list covers Client bodies
  too (A2): a listed resource returns `body_denied` with its metadata and
  the Client is never asked for the body. A JSON body comes with a structural summary
  (B3): item count, the union of item keys with their types, and how many
  whole items the preview holds, under 1,500 characters.
- The MCP bridge, with the token in the WebSocket handshake.
- Redaction mode (A3): Strict, Standard or Off (development only) in
  Settings → Data handling, with a Preview; Off needs a confirmation and
  shows a side-panel banner. Every caller goes through
  `runtime/redaction-mode.ts`, and a unit test fails on a direct call.

## Open

| Item | Needs |
|---|---|
| Narrow `<all_urls>` to Apty's target domains | Apty's list of customer application domains |
| Agent bridge module in the Apty Client | The Client team ships [`docs/integrations/apty`](integrations/apty/README.md)'s module |
| Studio integration | Studio's manifest allows no other extension to message it |
| Turn on `noExplicitAny` | About 130 `any` to replace; the rule is off |
| Rename the inherited `aipex_*` storage keys | A migration for existing installs |
| GitHub secret scanning and push protection | A repository admin turns them on in Settings → Code security |

## Where to look

- Problems: [`docs/TROUBLESHOOTING.md`](TROUBLESHOOTING.md)
- Privacy: [`PRIVACY.md`](../PRIVACY.md)
- Security findings: [`docs/security/SECURITY_AUDIT.md`](security/SECURITY_AUDIT.md)
- Releasing and the Web Store: [`docs/development/RELEASING.md`](development/RELEASING.md),
  [`docs/store/WEB_STORE_LISTING.md`](store/WEB_STORE_LISTING.md)
