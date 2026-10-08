import type { CustomModelConfig } from "@apty/agent-core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/context";
import { ThemeProvider } from "../../theme/context";
import {
  isLikelyLoopbackHost,
  parseImportedModels,
  SettingsPage,
  serializeModelsForExport,
} from "./index";

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

function renderSettings(
  initialTab: "ai" | "general" = "ai",
  storedSettings?: unknown,
) {
  const storageAdapter = createMemoryStorage<unknown>();
  if (storedSettings !== undefined) {
    storageAdapter.load.mockResolvedValue(storedSettings);
  }
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

  it("seeds the built-in providers on a genuinely fresh install (storage.load returns null, not {})", async () => {
    // Regression test for a real bug: storageAdapter.load returning null
    // (no settings key written yet, as on first install) used to skip the
    // provider-seeding branch entirely, leaving "No providers found" with
    // nothing to enable instead of the three disabled built-in providers.
    renderSettings("ai", null);

    expect(screen.queryByText(/no providers found/i)).not.toBeInTheDocument();
    expect((await screen.findAllByText(/openai/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/anthropic/i)).length).toBeGreaterThan(
      0,
    );
    expect((await screen.findAllByText(/google/i)).length).toBeGreaterThan(0);
  });

  it("migrates a stored legacy 'byokEnabled:false' with a real token/model into a configured, enabled model", async () => {
    // Before byokEnabled was removed, a legacy flat settings object with
    // the flag false (its default) but a real token+model already saved
    // would be silently skipped by the one-time customModels migration,
    // showing "No providers found" despite having a real key stored.
    renderSettings("ai", {
      aiToken: "sk-legacy-test",
      aiModel: "gpt-legacy-test",
      aiProvider: "openai",
      providerType: "openai",
      byokEnabled: false,
    });

    expect(
      (await screen.findAllByText("gpt-legacy-test")).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/no providers found/i)).not.toBeInTheDocument();
  });

  it("saves General-tab switches at once, keeping the stored AI settings", async () => {
    const storageAdapter = createMemoryStorage<unknown>();
    await storageAdapter.save("aipex_settings", {
      aiToken: "stored-key",
      aiModel: "gpt-4o",
    });
    storageAdapter.save.mockClear();
    render(
      <I18nProvider storageAdapter={createMemoryStorage<string>() as never}>
        <ThemeProvider storageAdapter={createMemoryStorage<string>() as never}>
          <SettingsPage storageAdapter={storageAdapter} initialTab="general" />
        </ThemeProvider>
      </I18nProvider>,
    );

    fireEvent.click(
      await screen.findByRole("switch", { name: "Capture response bodies" }),
    );
    fireEvent.click(screen.getByRole("switch", { name: "Verbose logging" }));

    await waitFor(() =>
      expect(storageAdapter.save).toHaveBeenLastCalledWith(
        "aipex_settings",
        expect.objectContaining({
          aiToken: "stored-key",
          networkBodyCaptureEnabled: true,
          verboseLogging: true,
        }),
      ),
    );
  });

  it("turns a provider on when its first API key is typed in", async () => {
    renderSettings("ai");

    const enable = await screen.findByRole("switch", { name: "Enable" });
    expect(enable.getAttribute("aria-checked")).toBe("false");
    fireEvent.change(screen.getByPlaceholderText("Your API Key"), {
      target: { value: "sk-test" },
    });

    expect(
      screen
        .getByRole("switch", { name: "Enable" })
        .getAttribute("aria-checked"),
    ).toBe("true");
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

describe("isLikelyLoopbackHost", () => {
  it("recognizes localhost, 127.x, and ::1 as loopback", () => {
    expect(isLikelyLoopbackHost("http://localhost:11434")).toBe(true);
    expect(isLikelyLoopbackHost("http://127.0.0.1:11434")).toBe(true);
    expect(isLikelyLoopbackHost("http://[::1]:11434")).toBe(true);
  });

  it("does not flag an ordinary public or private-but-non-loopback host", () => {
    expect(isLikelyLoopbackHost("https://api.openai.com/v1")).toBe(false);
    expect(isLikelyLoopbackHost("https://10.0.0.5/v1")).toBe(false);
  });

  it("returns false for an empty or invalid URL rather than throwing", () => {
    expect(isLikelyLoopbackHost("")).toBe(false);
    expect(isLikelyLoopbackHost("not a url")).toBe(false);
  });
});

describe("serializeModelsForExport / parseImportedModels", () => {
  const sampleModels: CustomModelConfig[] = [
    {
      id: "m1",
      name: "My GPT",
      providerType: "openai",
      aiHost: "https://api.openai.com/v1",
      aiToken: "sk-secret",
      aiModel: "gpt-4o",
      enabled: true,
    },
  ];

  it("strips API keys by default", () => {
    const json = serializeModelsForExport(sampleModels, false);
    const parsed = JSON.parse(json);
    expect(parsed.includesApiKeys).toBe(false);
    expect(parsed.models[0].aiToken).toBeUndefined();
    expect(parsed.models[0].aiModel).toBe("gpt-4o");
  });

  it("includes API keys only when explicitly opted in", () => {
    const json = serializeModelsForExport(sampleModels, true);
    const parsed = JSON.parse(json);
    expect(parsed.includesApiKeys).toBe(true);
    expect(parsed.models[0].aiToken).toBe("sk-secret");
  });

  it("round-trips an exported file back into disabled model configs with fresh ids", () => {
    const json = serializeModelsForExport(sampleModels, true);
    const imported = parseImportedModels(json);

    expect(imported).toHaveLength(1);
    const first = imported[0];
    expect(first?.id).not.toBe("m1");
    expect(first?.enabled).toBe(false);
    expect(first?.aiModel).toBe("gpt-4o");
    expect(first?.aiToken).toBe("sk-secret");
  });

  it("defaults a missing/invalid providerType to openai instead of throwing", () => {
    const imported = parseImportedModels(
      JSON.stringify({ models: [{ aiModel: "x", providerType: "bogus" }] }),
    );
    expect(imported[0]?.providerType).toBe("openai");
  });

  it("throws a descriptive error for non-JSON input", () => {
    expect(() => parseImportedModels("not json")).toThrow(/not valid json/i);
  });

  it("throws a descriptive error when the models array is missing", () => {
    expect(() => parseImportedModels(JSON.stringify({ foo: 1 }))).toThrow(
      /models.*array/i,
    );
  });
});
