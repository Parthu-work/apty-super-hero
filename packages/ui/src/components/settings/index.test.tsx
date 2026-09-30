import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/context";
import { ThemeProvider } from "../../theme/context";
import { SettingsPage } from "./index";

// jsdom does not implement matchMedia; the theme provider's "system" theme
// resolution needs it.
beforeEach(() => {
  window.matchMedia =
    window.matchMedia ??
    ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
});

// WP18/WP19 regression: this product is BYOK-only (no login/proxy fallback
// exists), so the AI configuration fields must always be visible with no
// gate toggle in front of them, and the Privacy card must be a truthful
// statement rather than a toggle that controls nothing (no analytics or
// telemetry code exists anywhere in this repo).

function createMemoryStorage<T>() {
  const store = new Map<string, T>();
  return {
    save: vi.fn(async (key: string, data: T) => {
      store.set(key, data);
    }),
    load: vi.fn(async (key: string) => store.get(key) ?? null),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    listAll: vi.fn(async () => Array.from(store.values())),
    query: vi.fn(async () => []),
    watch: vi.fn(() => () => {}),
  };
}

function renderSettings(initialTab: "ai" | "general" = "ai") {
  const storageAdapter = createMemoryStorage<unknown>();
  const i18nStorage = createMemoryStorage<string>();
  const themeStorage = createMemoryStorage<string>();
  return render(
    <I18nProvider storageAdapter={i18nStorage as never}>
      <ThemeProvider storageAdapter={themeStorage as never}>
        <SettingsPage storageAdapter={storageAdapter} initialTab={initialTab} />
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the AI configuration fields without any BYOK gate toggle", async () => {
    renderSettings();

    // The model list / config form must be visible immediately, not behind
    // a toggle the user has to find and enable first.
    expect(await screen.findByText(/add model/i)).toBeInTheDocument();
    expect(screen.queryByText(/bring your own key/i)).not.toBeInTheDocument();
  });

  it("never renders a Data Sharing control (there is nothing for it to control)", async () => {
    renderSettings("general");

    // The truthful replacement statement is present instead.
    expect(
      await screen.findByText(/no analytics or telemetry are collected/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/data sharing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/privacy mode/i)).not.toBeInTheDocument();
  });
});
