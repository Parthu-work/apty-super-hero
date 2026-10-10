# Demo script

A ten-minute walkthrough of the Apty Agent: reading the Apty Client's
requests and logs, and asking why the Apty Widget is not showing. Use test
data only.

## Prerequisites

- Chrome or Chromium with the Agent loaded (Load unpacked: the build's
  `dist` folder, or the review zip).
- The Apty Client extension with the Agent bridge module, built with this
  Agent's ID in `externally_connectable.ids`
  ([`docs/integrations/apty/README.md`](../integrations/apty/README.md)).
  Without it, the fixture Client from the end-to-end tests works for a
  dry run:

  ```bash
  node -e "import('./tooling/e2e/harness.mjs').then(h => h.writeFakeClient('/tmp/fake-client', 'working', 'bpiondflhhdplemamgggcdajclmoeple'))"
  ```

  then Load unpacked `/tmp/fake-client`.
- An API key for a provider whose model calls tools.
- The application open in a tab (a test tenant).

## 1. Preflight (2 minutes)

1. Open the Agent's Options page (right-click the toolbar icon → Options),
   or go straight to `…/options/index.html#preflight`.
2. Settings → AI Configuration: choose the provider, paste the API key,
   click **Fetch models** and pick a model, click **Test Connection**.
   Expected: "Connection test successful · Tool calling: yes". Click
   **Save Settings**.
3. Settings → Apty Integration → Apty Client: **Detect** (or paste the
   Client's ID) → **Connect**. Expected: "Answering".
4. Click into the application tab once, then back in Options →
   Apty Integration → Preflight → **Run all checks**.
   Expected: "All checks passed." Each failing row says exactly what to
   change and has a Copy button. **Export results (redacted JSON)** saves
   them for a support ticket.

`pnpm demo:check` runs the same page end to end in Chromium against the
fixture Client and a mock model (`npm run build` first, or let it build).

## 2. The Apty Client's requests (3 minutes)

Open the side panel on the application tab and type:

> get the data from segments.json in the apty client

Expected: the agent calls `inspect_extension_network` and answers with the
request (URL, status 200), the item count and the keys of the items. The
model sees a bounded preview and a structural summary only. Expand
**Show thinking details** → **View full response** to see the whole body
(redacted), with Copy and Download.

Then:

> show the apty client's service worker logs

Expected: recent Client log lines, with errors first.

If a resource matches Settings → General → Data handling's deny list, the
answer says the body was withheld (`body_denied`) and shows only its
metadata.

## 3. Why isn't the widget showing? (3 minutes)

> why isn't my Apty widget showing?

Expected: the agent checks the Widget's status
(`get_apty_widget_diagnostics`), the page's console errors and the
Client's logs and failed requests, and answers with the evidence it found.
`status: not_configured` means the Widget on this page has no diagnostic
bridge yet: an expected result, not proof the Widget is broken.

## 4. DOM Health (optional, 2 minutes)

Click **Check DOM Health** in the side panel. Expected: a score with its
confidence, frames and excluded overlays. Do not quote a score as
application-wide unless **Audit Application** was run.

## Troubleshooting by failure code

| Code (tool result) | Preflight says | What to do |
|---|---|---|
| `invalid_extension_id` | — | The ID in Apty Integration is not 32 letters a–p; copy it from chrome://extensions. |
| `extension_not_found` | "No enabled extension has the ID …" | Install or enable the Client, or correct the ID. |
| `not_allowlisted` | "The Apty Client does not let this extension in" | Add this Agent's ID (Preflight → This extension's ID → Copy) to the Client's `externally_connectable.ids`, reload the Client. |
| `bridge_missing` | "The Apty Client answers but has no Agent bridge" | Install the Agent bridge module in the Client's service worker. |
| `timeout` | "… accepted the message but never answered" | Update the bridge module; check chrome://extensions for Client errors. |
| `malformed_response` | "… bridge module is out of date" | Update the bridge module. |
| `body_denied` | Data handling row shows the deny list | Expected for listed URLs; edit the list in Data handling. |
| `no_bound_tab` / `bound_tab_closed` | "No web page is open" | Open the application and start a new chat from that tab. |
| `restricted_page` | — | Chrome pages and the Web Store cannot be inspected; use the application tab. |
| Tool calling: no | AI provider row fails | Pick a model that supports function calling. |

## Reset

Options → Apty Integration → Preflight → **Reset demo data** → **Delete
conversations and screenshots**. This deletes stored conversations and
screenshots (the same as General → Stored conversations); settings, the
API key and the Client connection stay. To forget remembered approvals:
General → Remembered approvals → Revoke all.
