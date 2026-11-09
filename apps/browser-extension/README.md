# Apty Browser Extension (`@apty/browser-extension`)

Chrome/Chromium extension (Manifest V3) that assembles the Apty Agent packages:

- `@apty/agent-core` (agent framework)
- `@apty/browser-runtime` (Chrome/extension runtime implementations)
- `@apty/ui` (React UI)

Built with Vite + `@crxjs/vite-plugin`.

## What this extension does

- **Side panel**: runs the main Apty Agent chat UI
- **Content script**: provides an Omni command menu and page-side helpers (e.g. element capture, fake mouse)
- **Options page**: configure providers, models, and UI settings

## Architecture (MV3)

### Background service worker (`src/entrypoints/background/`)

- Opens the side panel when the extension action icon is clicked
- Handles keyboard commands (see `manifest.json` → `commands`)
- Relays element capture events and persists the latest event to `chrome.storage.local`

### Content script (`src/entrypoints/content/`)

- Injects a React UI into the page context (using Shadow DOM + inline Tailwind CSS)
- Listens for messages such as `{ request: "open-apty-agent" }` (sent by the background command handler)
- Implements element capture mode and publishes results via `chrome.runtime.sendMessage`

### Side panel (`src/entrypoints/sidepanel/`)

- Hosts the main chat experience
- Uses workspace packages directly during development via Vite aliases (see `vite.config.ts`)

### Options page (`src/entrypoints/options/`)

- Uses `SettingsPage` from `@apty/ui`
- Wraps i18n and theme providers (`@apty/ui/i18n/context`, `@apty/ui/theme/context`)
- Persists settings with `ChromeStorageAdapter` (`@apty/browser-runtime`)

## Development

From the repository root:

```bash
pnpm install
pnpm dev
```

Or run just this workspace:

```bash
pnpm --filter @apty/browser-extension dev
```

### Load unpacked (dev)

- Open `chrome://extensions`
- Enable **Developer mode**
- Click **Load unpacked**
- Select the Vite output directory (by default `apps/browser-extension/dist/`)
- Keep the dev server running for HMR

## Build

```bash
pnpm --filter @apty/browser-extension build
```

Vite outputs to `dist/` by default (unless `build.outDir` is configured).
Load the built extension by selecting the build output directory in `chrome://extensions`.

## Reload after a rebuild

After every `pnpm build`, open `chrome://extensions` and click the reload
icon on the Apty Agent's card; reopen the side panel. A loaded KB pack and
your settings survive the reload.

## Knowledge base

The KB packs (KB-RAG, [`docs/development/kb-rag.md`](../../docs/development/kb-rag.md))
live in the extension origin's IndexedDB database `apty-kb-db`, object
store `records`: `pack:<version>` holds a pack's cards and chunks and
`meta:<version>` what Options shows about it, for each of `4.x`, `5.x` and
`common`. Nothing of a pack is in `chrome.storage`.

To inspect or clear it: open Options (or the side panel), open DevTools
(right-click → Inspect), **Application** → **IndexedDB** → `apty-kb-db` →
`records`. Remove a pack from Options → Settings → General → Knowledge base
rather than deleting records by hand; the store keeps each pack and its
meta record together.

Where the KB shows:

- **Options → Settings → General → Knowledge base**: Import pack… (the file
  names its version), one row per loaded pack with Replace and Remove, and
  the age warning. **Connection → Preflight** has a row per version.
- **Side panel**: the KB matches card for a message no check pack claims
  (no AI key needed), "From the KB card" under each cause of a check's
  verdict card, "Apty version: 4.x / 5.x / Not sure" on both, the model's
  `search_kb` calls with citations that link to each card, and the
  grounding note under an answer that names a setting the cited cards do
  not hold. A 4.x verdict with no files offers **Capture and reload** and
  the steps to save a HAR from the 4.x Client's service worker.

## Project structure

- `manifest.json`: MV3 manifest
- `src/entrypoints/background/`: service worker
- `src/entrypoints/content/`: content scripts (`frame-responder.ts` in every
  frame, `index.tsx` UI in the top frame, `console-bridge.ts` in the page's
  own world). The console bridge is not in `manifest.json`: the build emits
  it as `content/console-bridge.js` and the service worker registers it
  (`runtime/page-hooks-registration.ts`), so Settings can turn it off.
- `src/entrypoints/sidepanel/`: side panel UI
- `src/entrypoints/options/`: Options page

## Permissions

The extension requests powerful permissions for automation and context gathering.
See `manifest.json` for the full list (e.g. `tabs`, `scripting`, `storage`, `debugger`, `downloads`, ...); `bookmarks`, `history` and `management` are optional and requested only when turned on. Each one is justified in `docs/security/PERMISSIONS.md`.

## Testing

```bash
pnpm --filter @apty/browser-extension test
```

## License

MIT (see repository root)
