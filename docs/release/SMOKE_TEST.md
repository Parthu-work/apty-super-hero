# Manual smoke test: branded Chrome and Edge

The automated end-to-end suite (`npm run test:e2e`) runs on Chromium only.
Branded Google Chrome 137 and later ignore `--load-extension`, so the
suite cannot load the Agent there, and Edge is not automated either. Before
a release, run this checklist by hand on **Chrome stable** and **Microsoft
Edge stable** with the release package (`apty-agent-vX.Y.Z.zip`, from the
Release workflow's artifacts or `tooling/scripts/release-dry-run.sh`).

Use a fresh browser profile. About 25 minutes per browser.

## Steps

| # | Step | Expected |
|---|---|---|
| 1 | Unzip the package. `chrome://extensions` (Edge: `edge://extensions`) → Developer mode → **Load unpacked** → the folder | The Agent loads with no errors on its card |
| 2 | Read the ID on the card | Unpacked zip: `bpiondflhhdplemamgggcdajclmoeple` (pinned by the manifest `key`). Web Store install: the store's ID, which must match the one recorded in [Extension IDs](../integrations/apty/README.md#extension-ids). The Apty Client must allow-list the ID shown |
| 3 | Open the side panel (toolbar icon) | The welcome screen; the composer shows "Set up AI provider" and the bar under the header "1 to set up" |
| 4 | Settings → AI: provider, API key, **Fetch models**, pick a model, **Test Connection**, **Save Settings** | "Connection test successful · Tool calling: yes" |
| 5 | Open `https://example.com`, side panel: "what is the title of this page?" | An answer that names the page title, after a visible tool call (the thinking section lists it) |
| 6 | Same tab: "open a new tab at https://www.wikipedia.org" | An approval prompt "Allow create_new_tab?" with the full URL; **Deny** → no tab opens; ask again, **Allow once** → the tab opens |
| 7 | Open a page with frames (for example an internal app or `https://www.w3schools.com/html/tryit.asp?filename=tryhtml_iframe`), open **DOM health** from the side panel's menu and click **Check this page** | A result whose **Full breakdown** has a frames section listing every frame with a role; no "none of the frames responded" |
| 8 | Settings → Connection → Apty Client: Detect or paste the Client's ID → **Connect** | "Answering" (needs a Client build that allow-lists the ID in step 2; otherwise the exact fix is shown) |
| 9 | Settings → Connection → Preflight → **Run all checks** | Every row pass, or a fail with its fix; note any warning |
| 10 | Side panel Connections page (menu → **Connections**) after steps 4 and 8 | AI provider ready; Apty Client connected |
| 11 | Settings → General → Stored conversations → **Delete** (or Preflight → **Reset demo data**) | "Deleted"; the side panel menu's recent chats are empty |
| 12 | Build the demo packs on a development machine (`pnpm kb:demo-pack --version 4.x`, then `--version 5.x`); Settings → General → Knowledge base → **Import pack…**, once each | Rows "Apty 4.x" and "Apty 5.x"; Preflight has a passing "Knowledge base" row per version |
| 13 | With no AI key, side panel: `the help bubble keeps blinking when I rest the mouse on the field` | A "KB cards that match" card, "DEMO tooltip flickers on hover" first with its 5.x label; no model request |
| 14 | Side panel: `does Apty support SAML single sign-on with Okta` | No KB card (not covered); with no key the provider setup is offered |
| 15 | Side panel: `bulk export of guides never finishes` | "The KB has a card for this, but its 5.x text is not written yet." with the card's link |
| 16 | A 4.x tenant in Injected mode (or a test page whose script fetches synthetic 4.x files from a `tenant-…` path), with no Apty Client: "the widget is not showing", then **Capture and reload** on the verdict card | The page reloads; "Captured N Apty calls"; a second verdict "Read from the page's network capture" with 4.x rules (`W4X-…`) and 4.x card links |
| 17 | A HAR saved from a 4.x Client's service worker (the steps on the verdict card): Menu › Check a HAR file, choose it, What is missing? → the widget, tick "Use the page open in this tab", **Check** | A 4.x widget verdict against the tab's page |
| 18 | Settings → AI: an Anthropic key and a Claude model with tool use (for example `claude-sonnet-4-5`); with the demo packs loaded, side panel: `how do I turn the banner glow on in Studio?` | An answer, no "tools.0.custom … maximum, minimum are not supported" error (KB-RAG K25, A1) |
| 19 | With no AI key: `how much does an Apty licence cost per seat` | The setup card says "No KB card matched (coverage x, needs y). Connect an AI provider to ask the AI model."; with a key, the same line sits above the model's reply, and "Why this answer" lists the route, version, packs and outcome |
| 20 | On a development machine: `pnpm -s kb:eval --self-check --pack ~/apty-kb/apty-kb-DEMO-4.x.kbpack.json` | "Titles: rank 1 13 of 13", "Every title finds its own card in the top 3."; exit code 0 |
| 21 | Import a pack signed with a trusted key (or the demo pack), then a copy of it with one card's text changed | The first row says who signed it and when it expires; the copy is refused with "This pack's signature does not match its content." and the loaded pack stays |
| 22 | Import a pack whose `expiresAt` has passed (or set the policy's `maxPackAgeDays` below its age) | Refused at import with "This pack expired on <date>.", or, when already loaded, Options says it is not used and the chat says "The 5.x pack expired on <date>." |
| 23 | Ask a symptom that runs a check; note the case id in the bar; close and reopen the side panel and open the chat from the menu | The same case id; Settings → General → Cases lists it with its check |
| 24 | On the case (Cases → Open, or a verdict's support step), **Prepare support bundle** | The review dialog with the JSON, the missing fields, Copy, Download (`apty-support-<case id>.json`) and Copy as text; no KB card text, email or token in it |
| 25 | On a KB matches card, **Wrong card**, enter the right card's page id, **Save**; then Settings → General → Feedback, tick "Include my question", **Export questions for kb:eval**, Download; run `pnpm -s kb:eval --pack <demo pack> --questions <downloaded file>` | "Recorded"; the file lists the question with the right card; kb:eval prints its report |

## Results

Record one row per browser and release, in this file, in the release's
pull request (prepared; no row has been recorded yet). Run it twice per
browser for a store release: once with the unpacked zip and once installed
from the unlisted Web Store listing, and note which in the Notes column
with the ID from step 2. Mark a step ✗ with a note on what happened; any ✗
blocks the release until understood. Screenshots of a ✗ go in the pull
request, never with customer data in them.

| Release | Browser and version | OS | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | Tester | Date | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | Chrome stable | | | | | | | | | | | | | | | | | | | | | | | | | | | | | |
| | Edge stable | | | | | | | | | | | | | | | | | | | | | | | | | | | | | |
