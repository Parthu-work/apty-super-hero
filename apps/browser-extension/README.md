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

## Project structure

- `manifest.json`: MV3 manifest
- `src/background.ts`: background/service worker entry
- `src/content.tsx`: content script entry
- `src/pages/sidepanel/`: side panel UI
- `src/pages/options/`: options page UI
- `src/pages/content/`: content UI entry

## Permissions

The extension requests powerful permissions for automation and context gathering.
See `manifest.json` for the full list (e.g. `tabs`, `scripting`, `storage`, `debugger`, `history`, `downloads`, ...).

## Testing

```bash
pnpm --filter @apty/browser-extension test
```

## License

MIT (see repository root)
