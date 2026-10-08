# Chrome Web Store submission

Answers for the Chrome Web Store "Privacy practices" tab, ready to paste.
Keep them in step with `apps/browser-extension/manifest.json`.
[`docs/security/PERMISSIONS.md`](../security/PERMISSIONS.md) holds the
code-level justification for each permission; the manifest validator fails
the build if that file and the manifest drift apart, but doesn't check
this one.

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
| `storage` | Saves settings, the user's own API key and remembered approvals on the device (conversations and screenshots use the extension's IndexedDB). |
| `sidePanel` | The extension's main interface is a side panel. |
| `downloads` | Saves evidence, chat transcripts and screenshots the user chooses to download. |
| `debugger` | Reads network requests, uncaught errors and console output through the Chrome DevTools Protocol, which no other API exposes. Attached when a diagnostic or a network capture the user asked for starts, and detached when it ends or after 30 s without use. |
| `webNavigation` | Lists a page's frames so diagnostics cover iframes and framesets. |
| `alarms` | Keeps a network capture and the optional local MCP connection alive while they are in use. |
| `clipboardWrite` | Copy buttons on messages, evidence and code. |
| Optional `bookmarks`, `history` | Off by default; the user can let the agent use bookmarks or recent history as context. |
| Optional `management` | Off by default; detects the installed Apty Client extension so the user doesn't have to look up its ID. |
| Host permission `<all_urls>` | The extension debugs whatever web application the user has open, so it can't be limited to fixed domains. Its scripts on each page answer the extension's own diagnostic requests, keep recent console output in the page's memory, and draw the command menu and the agent's pointer in the top frame; no page data leaves the browser until the user asks the agent about that page. |

## Remote code

**No.** All of the extension's JavaScript ships in the package; the code
path that fetched packages from a CDN has been removed. Two features run
code that is not part of the package, both off or gated by default, and
worth stating to the reviewer:

- **Skills** (off by default): the user installs a skill as a zip file;
  its scripts run in a QuickJS WebAssembly sandbox, can import only modules
  bundled with the extension, and each run needs the user's click.
- **Page JavaScript** (`run_console_command`): an expression the model
  proposes runs in the page only after the user reads it in the approval
  prompt and clicks Allow.

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
