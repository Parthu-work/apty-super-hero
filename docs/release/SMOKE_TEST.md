# Manual smoke test: branded Chrome and Edge

The automated end-to-end suite (`npm run test:e2e`) runs on Chromium only.
Branded Google Chrome 137 and later ignore `--load-extension`, so the
suite cannot load the Agent there, and Edge is not automated either. Before
a release, run this checklist by hand on **Chrome stable** and **Microsoft
Edge stable** with the release package (`apty-agent-vX.Y.Z.zip`, from the
Release workflow's artifacts or `tooling/scripts/release-dry-run.sh`).

Use a fresh browser profile. About 15 minutes per browser.

## Steps

| # | Step | Expected |
|---|---|---|
| 1 | Unzip the package. `chrome://extensions` (Edge: `edge://extensions`) → Developer mode → **Load unpacked** → the folder | The Agent loads with no errors on its card |
| 2 | Read the ID on the card | Unpacked zip: `bpiondflhhdplemamgggcdajclmoeple` (pinned by the manifest `key`). Web Store install: the store's ID, which must match the one recorded in [Extension IDs](../integrations/apty/README.md#extension-ids). The Apty Client must allow-list the ID shown |
| 3 | Open the side panel (toolbar icon) | The welcome screen with readiness chips; "AI provider" asks for setup |
| 4 | Settings → AI Configuration: provider, API key, **Fetch models**, pick a model, **Test Connection**, **Save Settings** | "Connection test successful · Tool calling: yes" |
| 5 | Open `https://example.com`, side panel: "what is the title of this page?" | An answer that names the page title, after a visible tool call (the thinking section lists it) |
| 6 | Same tab: "open a new tab at https://www.wikipedia.org" | An approval prompt "Allow create_new_tab?" with the full URL; **Deny** → no tab opens; ask again, **Allow once** → the tab opens |
| 7 | Open a page with frames (for example an internal app or `https://www.w3schools.com/html/tryit.asp?filename=tryhtml_iframe`), click **Check DOM Health** | A result with a frames section listing every frame with a role; no "none of the frames responded" |
| 8 | Settings → Apty Integration → Apty Client: Detect or paste the Client's ID → **Connect** | "Answering" (needs a Client build that allow-lists the ID in step 2; otherwise the exact fix is shown) |
| 9 | Settings → Apty Integration → Preflight → **Run all checks** | Every row pass, or a fail with its fix; note any warning |
| 10 | Side panel readiness chips after steps 4 and 8 | AI provider ready; Apty Client connected |
| 11 | Settings → General → Stored conversations → **Delete** (or Preflight → **Reset demo data**) | "Deleted"; the side panel's history is empty |

## Results

Record one row per browser and release, in this file, in the release's
pull request (prepared; no row has been recorded yet). Run it twice per
browser for a store release: once with the unpacked zip and once installed
from the unlisted Web Store listing, and note which in the Notes column
with the ID from step 2. Mark a step ✗ with a note on what happened; any ✗
blocks the release until understood. Screenshots of a ✗ go in the pull
request, never with customer data in them.

| Release | Browser and version | OS | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | Tester | Date | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | Chrome stable | | | | | | | | | | | | | | | |
| | Edge stable | | | | | | | | | | | | | | | |
