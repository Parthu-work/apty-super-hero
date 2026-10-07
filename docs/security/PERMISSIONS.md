# Manifest permissions — audited against registered tools and features

Every permission in `apps/browser-extension/manifest.json` must appear in
the table below with a real, verified justification (a specific file and
API call, not "might be useful"). `tooling/scripts/validate-manifest.mjs`
parses this table and fails the build if the manifest and this table ever
diverge in either direction — a new permission added without updating this
file, or a stale entry here for a permission that's been removed.

Audited by cross-referencing each permission against:
1. `packages/browser-runtime/src/tools/index.ts`'s `allBrowserTools` — the
   tool registry actually exposed to the model (not every `.ts` file under
   `tools/` is registered; several exist as unreferenced source — see
   "Confirmed unused, removed" below and the pre-existing "Tool surface
   cleanup" note in `docs/development/PROJECT_PROGRESS.md`).
2. `packages/browser-runtime/src/context/index.ts`'s `allBrowserProviders`
   — ambient context providers, a separate mechanism from tools (the model
   never calls these directly; their output is included in every turn).
3. Direct `chrome.<namespace>.*` calls anywhere else in
   `apps/browser-extension/src` or `packages/browser-runtime/src` (background
   lifecycle, screenshot window-focusing, etc.) — not every legitimate use
   is a "tool".

| Permission | Justification |
|---|---|
| `tabs` | Core to nearly every tool (`tools/tab.ts`, `tools/snapshot.ts`, `tools/screenshot.ts`, diagnostic tab resolution in `tools/tab-utils.ts`, etc.) — reading tab URLs/titles/ids and switching/creating/closing tabs. |
| `windows` | `chrome.windows.update(..., {focused: true})` before a screenshot (`tools/screenshot.ts`, `tools/screenshot-helpers.ts`) so the captured window is actually focused/visible; `chrome.windows.getCurrent()` in `background/sidepanel.ts` for side-panel-per-window behavior. (A registered `window-management` tool group exists in source but is **not** wired into `allBrowserTools` — dead code, not what justifies this permission; see "Confirmed unused" below for the distinction between an unregistered tool and a permission with no real caller at all.) |
| `tabGroups` | `ungroup_tabs` (`tools/tab.ts`, registered) checks `chrome.tabGroups.TAB_GROUP_ID_NONE`. |
| `activeTab` | Kept alongside the broader `host_permissions: ["<all_urls>"]` as defense-in-depth for APIs that specifically check for an activeTab grant (e.g. `chrome.tabs.captureVisibleTab`) even when a host permission is also present. Meaningfully redundant with `<all_urls>` for most purposes — flagged here rather than silently assumed necessary; removing it was not attempted in this audit since it is low-risk to keep and the host permission is the much larger attack-surface item a reviewer would actually care about. |
| `scripting` | `chrome.scripting.executeScript` — content-script injection for DOM snapshotting, console-log reading, selector analysis, DOM health audits, and more, across `tools/tab-utils.ts`, `tools/snapshot.ts`, `tools/apty.ts`, `tools/dom-health.ts`, and others (13 files). |
| `commands` | `chrome.commands.onCommand` in `background/commands.ts` — the `open-apty-agent` keyboard shortcut declared in `manifest.json`'s own `commands` block. |
| `storage` | `chrome.storage.local`/`.session` — settings, peer config, evidence/log buffers, everywhere (15 files). Locked to `TRUSTED_CONTEXTS` at background startup (`entrypoints/background/storage-lockdown.ts`) so an isolated-world content script on `<all_urls>` cannot read it. |
| `sidePanel` | `side_panel.default_path` in this manifest, plus `chrome.sidePanel.*` calls opening/configuring the panel. |
| `bookmarks` | **Optional permission** (requested on demand, see "Optional permissions" below) — `BookmarksProvider` (`context/bookmarks-provider.ts`, registered in `allBrowserProviders`) calls `chrome.bookmarks.getTree()`/`.get()`. The dedicated `bookmark` *tool* (`tools/bookmark.ts`) is **not** registered in `allBrowserTools` — this permission is justified by the context provider, not that tool. |
| `history` | **Optional permission** (requested on demand, see "Optional permissions" below) — `HistoryProvider` (`context/history-provider.ts`, registered) calls `chrome.history.search()`. Same caveat as `bookmarks`: the dedicated `history` *tool* (`tools/history.ts`) is unregistered dead code. |
| `management` | **Optional permission** (requested on demand, see "Optional permissions" below) — `chrome.management.get()` in the Apty Client "Detect"/manual-connect flow (`entrypoints/options/apty-client-panel.tsx`) and `extension-network-inspector.ts`'s feature-detected `getManagedExtension()`. |
| `downloads` | `chrome.downloads.download` — the `downloadText`/message/evidence Download actions' `chrome.downloads` fallback path when the Blob+`<a download>` approach isn't available, and the dedicated image-download tools. |
| `debugger` | Chrome DevTools Protocol access — every DevTools diagnostic (`tools/devtools.ts`: network/runtime capture, `run_console_command`), the investigation-aware network capture session, and DOM Health's audit pipeline. This is the single highest-privilege permission here (it can read/modify any page's live state) and is justified purely by CDP being the *only* way to get this class of diagnostic data — no DOM/JS API exposes network timing, uncaught-exception stack traces, or CSP violations retroactively. `debugger-manager.ts` is responsible for attaching/detaching safely; see `DECISIONS.md` for the fix that stopped it from mutating the live page on every attach. |
| `webNavigation` | Frame-addressing for cross-frame console-log reading and DOM Health's frame-aware audit (`chrome.webNavigation.getAllFrames`/frame-tree APIs) — deliberately *not* `chrome.debugger`/CDP for this, since webNavigation is lower-privilege and sufficient for frame enumeration; see `DECISIONS.md`'s entry on this exact choice. |
| `alarms` | `chrome.alarms` — two independent keepalives, same reasoning, same mechanism: the MCP bridge's WebSocket-daemon keepalive (`background/mcp-bridge.ts`, `ws-bridge/ws-mcp-server.ts`), and `apty/network-capture-session.ts`'s capture keepalive (added after a real session lost an in-progress network capture to MV3 service-worker suspension between turns) — both exist so the service worker isn't suspended while something needs to stay open/running. |
| `clipboardWrite` | Backs `document.execCommand('copy')`/the Clipboard API's fallback path in `packages/ui/src/lib/clipboard.ts`, used by every Copy action (messages, tool results, code blocks). Has no direct `chrome.clipboardWrite.*` call surface — this permission relaxes the Clipboard API's normal user-gesture/focus requirements inside extension pages, it isn't itself a namespace to call. |
| `host_permissions: <all_urls>` | Required for `scripting`/content-script injection and `debugger` attachment on arbitrary customer application domains — this product's whole purpose is debugging *some other* web application the user has open, so it cannot be scoped to a fixed domain list. `externally_connectable.ids` stays `[]` (asserted by the validator) so this broad host access is not compounded by letting arbitrary extensions message this one. |

## Optional permissions (M5): not granted at install, requested on demand

`bookmarks`, `history`, and `management` moved from `permissions` to
`optional_permissions` this round — Chrome does not grant these at install
time; each is requested only when the user turns it on via the Options
page's "Optional permissions" panel (`entrypoints/options/permissions-
panel.tsx`, `services/optional-permissions.ts`), which calls
`chrome.permissions.request`/`.remove` from that toggle's own click (a
real user gesture — `.request` rejects/no-ops without one). This reduces
what Chrome's install-time permission prompt lists, at the cost of these
three features being off by default on a fresh install until the user
opts in.

This was judged safe to do with **no code changes** at the three call
sites themselves (see the table above for each), because every one of
them already handles the permission being absent: `BookmarksProvider` and
`HistoryProvider` already wrap their calls in try/catch and return `[]`;
`extension-network-inspector.ts`'s `getManagedExtension()` explicitly
feature-detects (`if (!c?.management?.get) return undefined`) before
calling it at all. Verified by reading each site, not assumed.

The dedicated `bookmark`/`history` *tools* (`tools/bookmark.ts`,
`tools/history.ts`) and the `extensions` tool group
(`tools/tools/extensions/index.ts`) remain unregistered dead code (see
"Confirmed unused" pattern below) — none of these three permissions are
justified by a tool the model can call, only by the context providers and
the one Options-page panel.

## Confirmed unused, removed this round

Three permissions had **zero** real callers anywhere in
`apps/browser-extension/src` or `packages/browser-runtime/src` — not just
an unregistered tool (like the `bookmarks`/`history` *tools*, which are
dead but still justified via context providers), nothing at all:

- **`browsingData`** — no `chrome.browsingData.*` call anywhere in the repo.
- **`sessions`** — `chrome.sessions.*` calls exist only in
  `tools/tools/sessions/index.ts`, which is not imported by
  `tools/index.ts` and so is never registered in `allBrowserTools`.
- **`contextMenus`** — same situation: `tools/tools/context-menus/index.ts`
  exists but is never imported/registered.

Removed from `manifest.json`. The now-orphaned source files were left in
place (not deleted) rather than folded into this permissions-focused
change — they were already dead before this audit and are a separate,
pre-existing "tool surface cleanup" item (see
`docs/development/PROJECT_PROGRESS.md`'s "Tool surface cleanup" row,
which already tracks the same situation for `tools/bookmark.ts`/
`tools/history.ts`/`tools/organize-tabs.ts`).

## Not attempted this round

A dedicated `window-management` tool group exists in
`packages/browser-runtime/src/tools/tools/window-management/index.ts`
(`chrome.windows.getAll`/`.create`/`.remove`/`.update`) but, like
`sessions`/`contextMenus` above, is never imported into `tools/index.ts`
and so is never registered — unlike those two, though, it doesn't justify
removing the `windows` *permission*, since `windows` is independently
justified by genuinely-used calls elsewhere (screenshot focusing, side
panel window lookup). Whether this dead tool group should be wired in,
deleted, or left as-is is a product decision, not a permissions question
— left for a future session.
