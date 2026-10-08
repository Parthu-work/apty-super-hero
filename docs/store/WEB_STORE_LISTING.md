# Chrome Web Store submission

Answers for the Chrome Web Store "Privacy practices" tab, ready to paste.
Keep them in step with `apps/browser-extension/manifest.json`;
[`docs/security/PERMISSIONS.md`](../security/PERMISSIONS.md) holds the
code-level justification for each permission, and the manifest validator
fails the build if the two drift apart.

## Single purpose

Apty Agent helps engineers debug web applications and Apty's products in
the browser: it reads the current page's structure, console output and
network activity, and the Apty Client extension's logs, and answers
questions about them with the AI provider the user configures.

## Permission justifications

| Permission | Justification for reviewers |
|---|---|
| `tabs` | Reads the URL and title of the tab being debugged, and opens, switches and closes tabs when the user asks. |
| `windows` | Focuses the window before taking a screenshot the user asked for; opens the side panel in the right window. |
| `tabGroups` | Lets the user ungroup tabs the agent organised. |
| `activeTab` | Screenshot capture of the tab the user is looking at. |
| `scripting` | Reads the page's DOM and console output in every frame for the diagnostics the user requests. |
| `commands` | The keyboard shortcut that opens the command menu. |
| `storage` | Saves settings, the user's own API key, and conversations, kept on the device. |
| `sidePanel` | The extension's main interface is a side panel. |
| `downloads` | Saves evidence, chat transcripts and screenshots the user chooses to download. |
| `debugger` | Reads network requests, uncaught errors and console output through the Chrome DevTools Protocol, which no other API exposes. Attached only while a diagnostic runs, and detached afterwards. |
| `webNavigation` | Lists a page's frames so diagnostics cover iframes and framesets. |
| `alarms` | Keeps a network capture and the optional local MCP connection alive while they are in use. |
| `clipboardWrite` | Copy buttons on messages, evidence and code. |
| Optional `bookmarks`, `history` | Off by default; the user can let the agent use bookmarks or recent history as context. |
| Optional `management` | Off by default; detects the installed Apty Client extension so the user doesn't have to look up its ID. |
| Host permission `<all_urls>` | The extension debugs whatever web application the user has open, so it can't be limited to fixed domains. Its scripts on each page only answer the extension's own diagnostic requests and keep recent console output in the page's memory; no page data leaves the browser until the user asks the agent about that page. |

## Remote code

**No.** All JavaScript ships in the package. Skills can import only a
built-in module; the code path that fetched packages from a CDN has been
removed. The AI provider's replies are text and tool calls, never code the
extension executes, except page JavaScript the user approves one action at
a time.

## Data usage

Data collected: **website content** (page text and structure, console
output, network request details, screenshots) and **user activity** (the
messages typed into the chat). Authentication information (the user's own
AI provider key) is stored locally only and sent to that provider.

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
