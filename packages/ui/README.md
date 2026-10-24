# @apty/ui

React UI toolkit for building Apty Agent-powered chat and extension experiences.

This package depends on `@apty/agent-core` only (no browser-specific runtime code). It provides:

- **Chat UI**: `<Chatbot />` and related components, slots, and themes
- **Headless primitives**: `useChat`, `ChatAdapter` (convert core `AgentEvent` streams into UI messages)
- **Settings UI + persistence**: `<SettingsPage />`, `useChatConfig` (storage via `KeyValueStorage`)
- **Extension building blocks**: `<Omni />`, intervention cards, fake mouse cursor
- **Optional submodules**: i18n provider and theme provider (via package subpath exports)

## Design notes

- **Core-first**: UI consumes `AgentEvent` from `@apty/agent-core` and does not assume a runtime.
- **Storage abstraction**: persistence is done through `KeyValueStorage` (localStorage by default; can be
  swapped for `chrome.storage`, IndexedDB, etc).
- **Streaming UX**: the adapter + hooks are built around incremental updates and tool lifecycle states.
- **Customization**: compose your UI with component overrides and slots, and style via CSS variables.

## Installation

```bash
npm install @apty/ui @apty/agent-core
# or
pnpm add @apty/ui @apty/agent-core
```

Peer dependencies:

- `react`
- `react-dom`

## Quick start (drop-in Chatbot)

```tsx
import { google } from "@ai-sdk/google";
import { AptyAgent, aisdk } from "@apty/agent-core";
import { Chatbot } from "@apty/ui";

const agent = AptyAgent.create({
  instructions: "You are a helpful assistant.",
  model: aisdk(google("gemini-2.5-flash")),
});

export function App() {
  return <Chatbot agent={agent} />;
}
```

## Usage

### 1) Headless chat (`useChat`)

`useChat` is a rendering-free hook for building your own UI.

```tsx
import { useChat } from "@apty/ui";

export function MyChat({ agent }: { agent: any }) {
  const { messages, status, sendMessage, interrupt, reset, regenerate } = useChat(agent);

  return (
    <div>
      <div>Status: {status}</div>
      <pre>{JSON.stringify(messages, null, 2)}</pre>
      <button onClick={() => sendMessage("Hello!")}>Send</button>
      <button onClick={() => regenerate()}>Regenerate</button>
      <button onClick={() => interrupt()}>Interrupt</button>
      <button onClick={() => reset()}>Reset</button>
    </div>
  );
}
```

### 2) Themes (Chatbot CSS variables)

The Chatbot uses CSS variables to keep theming predictable and framework-friendly.
Built-in themes:

- `defaultTheme`
- `darkTheme`
- `minimalTheme`
- `colorfulTheme`

You can also build your own theme:

```tsx
import { Chatbot, createTheme } from "@apty/ui";

const myTheme = createTheme({
  className: "my-chat",
  variables: {
    "--chatbot-primary": "hsl(262 83% 58%)",
    "--chatbot-radius": "12px",
  },
});

export function App({ agent }: { agent: any }) {
  return <Chatbot agent={agent} theme={myTheme} />;
}
```

### 3) Customize components and slots

`Chatbot` supports:

- **Component overrides** (replace structural components)
- **Slots** (inject custom UI fragments like tool display, message actions, etc.)

```tsx
import { Chatbot } from "@apty/ui";

export function App({ agent }: { agent: any }) {
  return (
    <Chatbot
      agent={agent}
      slots={{
        messageActions: ({ message }) => <button onClick={() => console.log(message.id)}>Log</button>,
      }}
    />
  );
}
```

### 4) Settings persistence (`useChatConfig`) and `<SettingsPage />`

`useChatConfig` loads/saves `AppSettings` using a `KeyValueStorage` adapter.

- Default storage: localStorage-backed adapter
- Extension storage: pass any `KeyValueStorage` (e.g. `ChromeStorageAdapter` from `@apty/browser-runtime`)

```tsx
import { SettingsPage } from "@apty/ui";
import { chromeStorageAdapter } from "@apty/browser-runtime";

export function Options() {
  return <SettingsPage storageAdapter={chromeStorageAdapter} />;
}
```

### 5) i18n and theme providers (subpath exports)

This package exposes i18n + theme contexts via subpath exports:

- `@apty/ui/i18n/context`
- `@apty/ui/theme/context`

```tsx
import { ChromeStorageAdapter } from "@apty/browser-runtime";
import { I18nProvider } from "@apty/ui/i18n/context";
import { ThemeProvider } from "@apty/ui/theme/context";
import type { Language } from "@apty/ui/i18n/types";
import type { Theme } from "@apty/ui/theme/types";
import { Chatbot } from "@apty/ui";

const i18nStorage = new ChromeStorageAdapter<Language>();
const themeStorage = new ChromeStorageAdapter<Theme>();

export function App({ agent }: { agent: any }) {
  return (
    <I18nProvider storageAdapter={i18nStorage}>
      <ThemeProvider storageAdapter={themeStorage}>
        <Chatbot agent={agent} />
      </ThemeProvider>
    </I18nProvider>
  );
}
```

## API reference

### Chatbot components

- `Chatbot(props)`
  - `agent: AptyAgent | undefined`
  - `config?: ChatConfig`
  - `handlers?: ChatbotEventHandlers`
  - `components?: ChatbotComponents`
  - `slots?: ChatbotSlots`
  - `theme?: ChatbotTheme`
  - `className?: string`
  - `initialSettings?: Partial<AppSettings>`
  - `storageAdapter?: KeyValueStorage<unknown>` (defaults to localStorage)
  - `models?: Array<{ name: string; value: string }>`
  - `placeholderTexts?: string[]`
  - `title?: string`

- `ChatbotProvider(props)` is the same core provider but expects `children` and does not include `title/models`.

### Slots (`ChatbotSlots`)

Customize specific parts of the Chatbot UI:

- `messageActions(props)`
- `inputToolbar(props)`
- `modelSelector(props)`
- `contextTags(props)`
- `toolDisplay(props)`
- `headerContent()`
- `footerContent()`
- `emptyState(props)`
- `loadingIndicator()`
- `afterMessages()`

### Hooks and adapter

- `useChat(agent, options?)` → `{ messages, status, sessionId, sendMessage, continueConversation, interrupt, reset, regenerate, setMessages }`
- `useChatConfig(options?)` → `{ settings, isLoading, updateSetting, updateSettings, resetSettings, reloadSettings }`
- `ChatAdapter` / `createChatAdapter(options?)`

### Settings

- `SettingsPage(props)`
  - `storageAdapter: KeyValueStorage<unknown>`
  - `storageKey?: string`
  - `className?: string`
  - `onSave?: (settings: AppSettings) => void`
  - `onTestConnection?: (settings: AppSettings) => Promise<boolean>`

### Chatbot themes

- Presets: `defaultTheme`, `darkTheme`, `minimalTheme`, `colorfulTheme`
- Variables: `defaultThemeVariables`, `darkThemeVariables`
- Helpers: `createTheme(overrides)`, `mergeThemes(base, overrides)`

### i18n (subpath exports)

Import from `@apty/ui/i18n/context`:

- `I18nProvider({ storageAdapter, children })`
- `useTranslation()` → `{ language, t(key, params?), changeLanguage }`

### Global theme (subpath exports)

Import from `@apty/ui/theme/context`:

- `ThemeProvider({ storageAdapter, scope?, children })`
- `useTheme()` → `{ theme, effectiveTheme, changeTheme }`

### Misc components

- `Omni` (command palette)
- `FakeMouse` (+ controller/types)
- Intervention components: `InterventionCard`, `SelectionCard`, `MonitorCard`, `VoiceCard`, `InterventionModeToggle`

## Development (monorepo)

From the repository root:

```bash
pnpm --filter @apty/ui build
pnpm --filter @apty/ui typecheck
pnpm --filter @apty/ui test
```

## License

MIT
