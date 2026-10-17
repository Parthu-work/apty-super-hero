# Chrome Web Store submission

Answers for the Chrome Web Store "Privacy practices" tab, ready to paste.
Keep them in step with `apps/browser-extension/manifest.json`.
[`docs/security/PERMISSIONS.md`](../security/PERMISSIONS.md) holds the
code-level justification for each permission; the manifest validator fails
the build if that file and the manifest drift apart, but doesn't check
this one.

## Single purpose

Paste this exactly; it is also `description` in
`apps/browser-extension/manifest.json`, and the two must stay identical:

> Debugs web applications and Apty's products in the browser: reads the page, console and network, and answers with your AI provider.

## Store description

Apty Agent is a browser debugging assistant for engineers who build and
support web applications and Apty's digital adoption products.

Open the side panel on the application you are working on and ask in plain
language. The agent reads the page's structure, console output and network
requests, and Apty's own extension logs, and answers with evidence: which
element is wrong, which request failed, what the Apty widget saw. It can
run a DOM Health audit of a page or a whole application, compare selectors,
and record an investigation you can export.

You choose the AI provider (OpenAI, Anthropic, Google or any
OpenAI-compatible endpoint) and use your own API key, which stays on your
device. Nothing on a page leaves the browser until you ask about it, and
then only to your provider. Strict mode, on by default, masks secrets,
personal data, URL parameters and page titles first. Typing, risky clicks,
opening a tab on another site, closing a tab the agent didn't open,
running page JavaScript and sending a screenshot each ask for your
approval.

Apty Agent sends no telemetry and has no server of its own.

## Store images

- **Screenshots** (1280×800, synthetic demo data only):
  [`screenshots/`](screenshots/). Regenerate after a UI change with
  `npm run build && node tooling/e2e/screenshot-harness.mjs --store`.
- **Icons and promo tile: waiting for the owner's artwork** (owner
  decision D6). `apps/browser-extension/assets/icon*.png` are still the
  upstream AIPex icons, each 512×512. With an SVG or a 512×512 PNG, run
  `node tooling/scripts/rasterize-icons.mjs <artwork>` to write the 16,
  48 and 128 px icons, the store's 128 px icon (96 px artwork, 16 px margin)
  and the 440×280 promo tile into `docs/store/assets/`.

## Permission justifications

| Permission | Justification for reviewers |
|---|---|
| `tabs` | Reads the URL and title of the tab being debugged, and opens, switches and closes tabs when the user asks. |
| `windows` | Focuses the window before taking a screenshot the user asked for; opens the side panel in the right window. |
| `tabGroups` | Lets the user ungroup tabs the agent organised. |
| `activeTab` | Screenshot capture of the tab the user is looking at. |
| `scripting` | Reads the page's DOM and console output in every frame for the diagnostics the user requests. |
| `commands` | The keyboard shortcut that opens the command menu. |
| `storage` | Saves settings, the user's own API key and remembered approvals on the device (conversations and screenshots use the extension's IndexedDB). |
| `sidePanel` | The extension's main interface is a side panel. |
| `downloads` | Saves evidence, chat transcripts and screenshots the user chooses to download. |
| `debugger` | Reads network requests, uncaught errors and console output through the Chrome DevTools Protocol, which no other API exposes. Attached when a diagnostic or a network capture the user asked for starts, and detached when it ends or after 30 s without use. |
| `webNavigation` | Lists a page's frames so diagnostics cover iframes and framesets. |
| `alarms` | Keeps a network capture and the optional local MCP connection alive while they are in use. |
| `clipboardWrite` | Copy buttons on messages, evidence and code. |
| Optional `bookmarks`, `history` | Off by default; the user can let the agent use bookmarks or recent history as context. |
| Optional `management` | Off by default; detects the installed Apty Client extension so the user doesn't have to look up its ID. |
| Host permission `<all_urls>` | Kept for 0.1.0. The extension debugs the web application the user has open, and Apty's customers run those on their own domains, so there is no fixed list to narrow it to; narrowing waits for Apty's list of customer application domains (the same position is in `docs/STATUS.md`). Its scripts on each page answer the extension's own diagnostic requests, keep recent console output in the page's memory, and draw the command menu and the agent's pointer in the top frame; no page data leaves the browser until the user asks the agent about that page. |

## Remote code

**Recommended answer: Yes**, with the text below. Two features run code
that is not in the package, so "No" would not be accurate (owner decision
D3, default applied: imported skills stay, model-written scripts are gone).

> All of the extension's own JavaScript and WebAssembly ship in the
> package; nothing is downloaded from a server. Two user-controlled
> features run code that is not part of the package:
>
> 1. **Skills** are off by default. A user can import a skill as a zip
>    file. Its scripts run in a QuickJS WebAssembly sandbox bundled with
>    the extension, with no network, no browser APIs and no access to the
>    page, and every run shows the script's first lines and asks the user
>    first. The AI model cannot write or change skill scripts.
> 2. **Page JavaScript** (`run_console_command`): the AI model can propose
>    a JavaScript expression to run in the page being debugged. It runs
>    only after the user reads the full expression in an approval prompt
>    and clicks Allow, every time; this approval can't be remembered.

## Data usage

Tick these categories. Data is sent only to the AI provider the user
configures, only when the user asks the agent something, and after the
masking of the selected redaction mode (Strict by default; see
[`PRIVACY.md`](../../PRIVACY.md)).

| Category | What the code sends |
|---|---|
| Health information | The extension is used on applications that hold patient records. Page text, form values and screenshots can contain health data; Strict masks recognised identifiers, not every word of prose. |
| Personally identifiable information | Names, email addresses and IDs that appear on a page or in a request the user asks about. |
| Authentication information | The user's own AI provider API key, stored on the device and sent only to that provider. The MCP bridge token stays on the device. |
| Personal communications | The messages the user types into the chat. |
| Web history | The URL (masked by mode) and, outside Strict, the title of tabs the agent lists or works on. |
| User activity | Network requests, console output and errors of the page being debugged, and the clicks and typing the agent performs when the user approves them. |
| Website content | Page text and structure, element attributes, screenshots the user allows, and response bodies when body capture is turned on. |

Certify all three disclosures: data is not sold to third parties, not used
or transferred for purposes unrelated to the single purpose, and not used
or transferred to determine creditworthiness or for lending.

Privacy policy URL: publish [`PRIVACY.md`](../../PRIVACY.md) and link it.

## Before each submission

1. Push a version tag; the release workflow builds, tests and packages
   the extension (see [`docs/development/RELEASING.md`](../development/RELEASING.md)).
2. Upload `apty-agent-vX.Y.Z-webstore.zip` from the release, after checking
   it against the release's `.sha256` file. That package has no manifest
   `key`, which the store rejects; the other zip keeps it so unpacked and
   enterprise installs get the fixed extension ID.
