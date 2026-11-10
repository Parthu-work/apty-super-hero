# @apty/browser-runtime

Chrome/Chromium runtime implementations for `@apty/agent-core`.

This package is where **browser-specific** code lives (Manifest V3 friendly). It provides:

- **Browser tools** (`allBrowserTools`) for tab/page interaction
- **Context providers** for common browser data sources (tabs, bookmarks, history, current page, screenshots)
- **Storage adapters** for extension environments (`ChromeStorageAdapter`, `IndexedDBStorage`)
- A CDP-based automation layer (via `chrome.debugger`) and related helpers
- Runtime contracts used by the Apty Agent extension (hosts, addons, omni action registry)

> Note: These APIs depend on `chrome.*` and/or `indexedDB`. They are not meant to run in plain Node.js.

## Why a separate runtime package?

The system is split into layers so each stays focused:

- `@apty/agent-core`: platform-agnostic agent + events + contexts + sessions
- `@apty/browser-runtime`: Chrome/extension implementations (tools, providers, storage, automation)
- `@apty/ui`: React UI toolkit that depends only on core
- `apps/browser-extension`: the actual extension that wires everything together

## Features

### 1) `allBrowserTools` (32 tools)

`allBrowserTools` is a curated bundle of `FunctionTool`s that an agent can call.
It includes:

- **Tab management**: list/open/close, basic grouping helpers
- **UI operations**: locate elements, click, hover, fill inputs/forms, computer tool
- **Page content**: metadata, scrolling, highlighting
- **Screenshots**: capture to data URL
- **Downloads**: save images from the agent workflow
- **Human-in-the-loop interventions**: request/cancel interventions
- **Skills**: load/execute skill scripts

Tool names included (strings used for tool-calling):

- Tabs (7): `get_all_tabs`, `get_current_tab`, `create_new_tab`, `get_tab_info`, `close_tab`, `organize_tabs`, `ungroup_tabs`
- UI ops (7): `search_elements`, `click`, `fill_element_by_uid`, `get_editor_value`, `fill_form`, `hover_element_by_uid`, `computer`
- Page (4): `get_page_metadata`, `scroll_to_element`, `highlight_element`, `highlight_text_inline`
- Screenshot (2): `capture_screenshot`, `capture_tab_screenshot`
- Download (2): `download_image`, `download_chat_images`
- Interventions (4): `list_interventions`, `get_intervention_info`, `request_intervention`, `cancel_intervention`
- Skills (6): `load_skill`, `execute_skill_script`, and 4 other skill tools

**Disabled tools** (exist in code but not in default bundle):

- `switch_to_tab`: causes context switching issues
- `duplicate_tab`: not enabled
- `wait`: deprecated, replaced by `computer` tool's wait action
- `capture_screenshot_to_clipboard`: not enabled
- `download_text_as_markdown`: not enabled
- `download_current_chat_images`: architecture issue

**Available but not registered by default** (can be imported separately):

- Bookmarks: `list_bookmarks`, `search_bookmarks`, `create_bookmark`, `delete_bookmark`, etc. (`tools/bookmark.ts`)
- History: `get_recent_history`, `search_history`, `delete_history_item`, `clear_history`, etc. (`tools/history.ts`)
- Clipboard: `copy_to_clipboard`, `read_from_clipboard`, `copy_page_as_markdown`, etc. (`tools/tools/clipboard/`)
- Window management: `get_all_windows`, `switch_to_window`, `create_new_window`, etc. (`tools/tools/window-management/`)
- Sessions: `get_all_sessions`, `restore_session`, etc. (`tools/tools/sessions/`)
- Extensions: `get_all_extensions`, `set_extension_enabled`, etc. (`tools/tools/extensions/`)
- Context menus: `create_context_menu_item`, etc. (`tools/tools/context-menus/`)
- Tab groups: `create_tab_group`, `get_all_tab_groups`, etc. (`tools/tools/tab-groups/`)

> Note: `take_snapshot` exists but is intentionally not included in `allBrowserTools` because it is used internally.

### 2) Default browser context providers

This package includes providers and a convenience registration helper:

- `allBrowserProviders`
- `registerDefaultBrowserContextProviders(manager)`

Providers included by default:

- `CurrentPageProvider`
- `TabsProvider`
- `BookmarksProvider`
- `ScreenshotProvider`
- `HistoryProvider`

### 3) Storage adapters

- `ChromeStorageAdapter<T>`: implements `KeyValueStorage<T>` using `chrome.storage`.
  - Supports `"local"` and `"sync"` areas
  - Falls back to `localStorage` when `chrome.storage` is unavailable (useful for non-extension dev)
- `IndexedDBStorage<T extends { id: string }>`: a small `KeyValueStorage` implementation backed by IndexedDB

### 4) Automation helpers

Under `automation/`, you'll find building blocks for browser automation:

**CDP-based automation** (via `chrome.debugger`):
- `DebuggerManager`
- `SmartLocator` / `SmartElementHandle`

**DOM-based automation** (pure JavaScript, no CDP required):
- `DomLocator` / `DomElementHandle` - Element handles that work with DOM snapshot strategy
- Supports same-origin iframes with automatic coordinate offset tracking

**Snapshot management**:
- `SnapshotManager` - Supports dual snapshot strategies:
  - `cdp`: CDP-based accessibility tree snapshots
  - `dom`: Pure DOM-based snapshots (using `@apty/dom-snapshot`)
- Snapshot text search utilities (`searchSnapshotText`, `parseSearchQuery`, `hasGlobPatterns`)

### 5) Knowledge base and the Apty check packs

KB-RAG ([`docs/development/kb-rag.md`](../../docs/development/kb-rag.md)):

- **`search_kb`** (`tools/kb.ts`): parameters `query` (1–300 characters, in
  English: the model translates a question asked in another language),
  `topK` (1–5, default 3), `layers` (1 settings, 2 Console and Elements, 3
  network data, 4 support) and `aptyVersion` (`4.x`/`5.x`, only when the
  user said it; otherwise the tab's known version, else every pack). It
  returns `{ status, reason?, missingPhrases?, mixedVersions?, stub?, results }`:
  `ok`, `not_covered` (`no_match`, `low_coverage`, `unknown_setting`),
  `stub` (a card whose text is not written yet: cite, title, site, space,
  version) or `no_pack`; each result has `cite` (`kb://<pageId>#L<layer>`),
  `title`, `site`, `space`, `aptyVersion`, `layer`, `heading`,
  `verifiedOn`, `notVerified`, `score` and `text`, whole chunks only, at
  most 4,000 characters in all. It goes through the result-privacy filter
  like every tool; the card's link is built from `site` and `space` so the
  URL policy does not take the card for a visited page.
- **Store** (`storage/kb-store.ts`, `createKbPackStore`): one pack per
  version in IndexedDB `apty-kb-db`; `info()` lists the loaded packs,
  `load(version)`, `replace(text)` (stores under the file's own version),
  `remove(version)`; the one pack an earlier Agent stored moves to 5.x.
- **Index** (`kb/kb-index.ts`): `sharedKbIndexSource().current(version)`
  for `4.x`, `5.x` or `unknown` (every pack), cached by the packs' sha256.
- **KB matches responder** (`kb/kb-matches.ts`, used by
  `createDiagnosisResponder`): any message no check pack claims is searched
  and answered with no model call when covered, or with a stub; a bare
  how-to is left alone (`kb/kb-intent.ts`); a message mostly outside the
  Latin script gets the English-cards notice when no model is configured.
- **Tab version** (`kb/kb-version.ts`): a check's files decide it
  (`playerVersionOf`), else the user's choice, per site host, in memory.

The **4.x check packs** (`apty/diagnosis/widget-not-visible-4x.ts`, rules
`W4X-…`, and `content-not-visible-4x.ts`, rules `C4X-…`) run when a check's
files are 4.x (`playerVersionOf`); a 5.x or unknown tenant runs the 5.x
packs. The 4.x rules were checked against apty-assist `player3.0` at
`bbb4cbc` (player 4.30.0); every 4.x finding says so and that it is not
runtime-verified.

**Where a check's files come from**, in order:

1. The **Apty Client** (5.x, or a 4.x Client with the bridge in
   `docs/integrations/apty/4X-BRIDGE.md`), through `apty-debug-agent:*`
   messages.
2. The tab's **page network capture** (a 4.x player in Injected mode
   fetches from the page): a running capture, or one stopped in the last 15
   minutes; the verdict card's **Capture and reload** makes one
   (`apty/diagnosis/capture-check.ts`).
3. Apty's **content CDN** (5.x only), unless Settings → Apty Integration
   turns it off.
4. A **HAR file** on the HAR page (`apty/diagnosis/har-check.ts`), including
   one saved from the 4.x Client's service worker, which has no page entry
   and is checked against the tab's page once the user confirms it.

All go through the same body deny list and redaction.

## Installation

```bash
npm install @apty/browser-runtime
# or
pnpm add @apty/browser-runtime
```

Peer dependencies:

- `@types/chrome` (for TypeScript)
- `react` (optional; only needed if you use React-related helpers)

## Usage

### 1) Use the built-in browser tools with an agent

```ts
import { google } from "@ai-sdk/google";
import { AptyAgent, aisdk } from "@apty/agent-core";
import { allBrowserTools } from "@apty/browser-runtime";

const agent = AptyAgent.create({
  instructions: "You can control the current browser tab.",
  model: aisdk(google("gemini-2.5-flash")),
  tools: allBrowserTools,
});
```

### 2) Register default browser context providers

```ts
import { ContextManager } from "@apty/agent-core";
import { registerDefaultBrowserContextProviders } from "@apty/browser-runtime";

const contextManager = new ContextManager({ autoInitialize: true });
registerDefaultBrowserContextProviders(contextManager);
```

### 3) Use extension storage in UI packages

`@apty/ui` accepts any `KeyValueStorage` implementation for persisting settings.
In a Chrome extension, you can pass `chromeStorageAdapter`:

```tsx
import { Chatbot } from "@apty/ui";
import { chromeStorageAdapter } from "@apty/browser-runtime";

export function App({ agent }: { agent: any }) {
  return <Chatbot agent={agent} storageAdapter={chromeStorageAdapter} />;
}
```

### 4) Execute a function in the active tab

```ts
import { executeScriptInActiveTab } from "@apty/browser-runtime";

const title = await executeScriptInActiveTab(() => document.title, []);
console.log(title);
```

### 5) IndexedDB-backed storage

```ts
import { IndexedDBStorage } from "@apty/browser-runtime";

const storage = new IndexedDBStorage<{ id: string; value: string }>({
  dbName: "apty",
  storeName: "sessions",
});
```

## API reference

### Tools

- `allBrowserTools: FunctionTool[]`
- `interventionTools: FunctionTool[]`
- `registerDefaultBrowserTools(registryLike)`
- `getActiveTab(): Promise<chrome.tabs.Tab>`
- `executeScriptInTab(tabId, func, args)`
- `executeScriptInActiveTab(func, args)`

### Context providers

- `allBrowserProviders: ContextProvider[]`
- `registerDefaultBrowserContextProviders(manager)`
- Provider classes: `CurrentPageProvider`, `TabsProvider`, `BookmarksProvider`, `ScreenshotProvider`, `HistoryProvider`

### Storage

- `ChromeStorageAdapter<T>`
- `chromeStorageAdapter: ChromeStorageAdapter`
- `IndexedDBStorage<T>`
- `IndexedDBConfig`

### Automation

- `DebuggerManager`, `debuggerManager`
- `SnapshotManager`, `snapshotManager` - supports `SnapshotStrategy` (`"cdp"` | `"dom"`)
- `SmartLocator`, `SmartElementHandle` - CDP-based element handles
- `DomLocator`, `DomElementHandle` - DOM-based element handles
- `searchSnapshotText`, `parseSearchQuery`, `hasGlobPatterns`

### Runtime contracts

- `RuntimeAddon`
- `NoopBrowserAutomationHost`
- `InMemoryOmniActionRegistry`
- `NullInterventionHost`
- `NoopContextProvider`

## Development (monorepo)

From the repository root:

```bash
pnpm --filter @apty/browser-runtime build
pnpm --filter @apty/browser-runtime typecheck
pnpm --filter @apty/browser-runtime test
```

### Testing

This package includes Puppeteer-based integration tests for CDP automation features:

- **Iframe Manager tests**: Test iframe accessibility tree merging (`iframe-manager.puppeteer.test.ts`)
- **Snapshot Manager tests**: Test snapshot creation, search, and node ID injection (`snapshot-manager.puppeteer.test.ts`)

These tests use Puppeteer to simulate a browser environment without requiring a real Chrome extension. They automatically handle CI environments (GitHub Actions) with appropriate launch flags.

To run tests:

```bash
pnpm --filter @apty/browser-runtime test
```

**CI Considerations**: The tests are configured to work in CI environments (GitHub Actions) with:
- Automatic Chromium download via Puppeteer
- Sandbox flags (`--no-sandbox`, `--disable-setuid-sandbox`) for containerized environments
- Increased timeouts for slower CI runners

## License

MIT
