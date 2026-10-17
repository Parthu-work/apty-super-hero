import {
  type AppSettings,
  type CustomModelConfig,
  SETTINGS_VERSION,
} from "@apty/agent-core";
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
import type { SettingsPageProps } from "./types";

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
    await storageAdapter.save("apty_settings", {
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
    fireEvent.click(screen.getByRole("switch", { name: "Developer tools" }));

    await waitFor(() =>
      expect(storageAdapter.save).toHaveBeenLastCalledWith(
        "apty_settings",
        expect.objectContaining({
          aiToken: "stored-key",
          networkBodyCaptureEnabled: true,
          verboseLogging: true,
          developerTools: true,
        }),
      ),
    );
  });

  it("fills fields the stored settings leave out with their defaults, and saves the schema version", async () => {
    const storageAdapter = createMemoryStorage<unknown>();
    await storageAdapter.save("apty_settings", { aiToken: "stored-key" });
    storageAdapter.save.mockClear();
    render(
      <I18nProvider storageAdapter={createMemoryStorage<string>() as never}>
        <ThemeProvider storageAdapter={createMemoryStorage<string>() as never}>
          <SettingsPage storageAdapter={storageAdapter} initialTab="general" />
        </ThemeProvider>
      </I18nProvider>,
    );

    fireEvent.click(
      await screen.findByRole("switch", { name: "Verbose logging" }),
    );

    await waitFor(() =>
      expect(storageAdapter.save).toHaveBeenLastCalledWith(
        "apty_settings",
        expect.objectContaining({
          aiToken: "stored-key",
          verboseLogging: true,
          settingsVersion: SETTINGS_VERSION,
          redactionMode: "strict",
          screenshotPolicy: "ask",
          pageHooksEnabled: true,
          networkBodyCaptureEnabled: false,
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

  describe("Save and Test Connection", () => {
    function renderWith(props: {
      onSave?: (settings: AppSettings) => void;
      onTestConnection?: SettingsPageProps["onTestConnection"];
      onFetchModels?: SettingsPageProps["onFetchModels"];
    }) {
      const storageAdapter = createMemoryStorage<unknown>();
      render(
        <I18nProvider storageAdapter={createMemoryStorage<string>() as never}>
          <ThemeProvider
            storageAdapter={createMemoryStorage<string>() as never}
          >
            <SettingsPage
              storageAdapter={storageAdapter}
              initialTab="ai"
              onSave={props.onSave}
              onTestConnection={props.onTestConnection}
              onFetchModels={props.onFetchModels}
            />
          </ThemeProvider>
        </I18nProvider>,
      );
      return storageAdapter;
    }

    async function typeKey(key: string) {
      fireEvent.change(await screen.findByPlaceholderText("Your API Key"), {
        target: { value: key },
      });
    }

    function typeModel(model: string) {
      const field = screen.getByPlaceholderText("deepseek-chat");
      fireEvent.change(field, { target: { value: model } });
    }

    it("keeps Save and Test Connection disabled for an enabled provider until it has a model", async () => {
      const onSave = vi.fn();
      const storageAdapter = renderWith({ onSave });
      await typeKey("sk-test");
      typeModel("");

      const save = screen.getByRole("button", { name: "Save Settings" });
      expect(save).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Test Connection" }),
      ).toBeDisabled();
      fireEvent.click(save);
      expect(onSave).not.toHaveBeenCalled();
      expect(storageAdapter.save).not.toHaveBeenCalled();

      typeModel("gpt-4o-mini");
      expect(save).toBeEnabled();
    });

    it("saves the active provider's key and model as the settings the agent uses", async () => {
      const onSave = vi.fn();
      const storageAdapter = renderWith({ onSave });
      await typeKey("sk-test");
      typeModel("gpt-4o-mini");

      fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

      expect(
        await screen.findByText("Settings saved successfully!"),
      ).toBeInTheDocument();
      expect(storageAdapter.save).toHaveBeenCalledWith(
        "apty_settings",
        expect.objectContaining({
          aiToken: "sk-test",
          aiModel: "gpt-4o-mini",
          providerEnabled: true,
        }),
      );
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ aiToken: "sk-test" }),
      );
    });

    it("tests the connection with the typed key and model and reports failure and errors", async () => {
      const onTestConnection = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error("401 Unauthorized"))
        .mockResolvedValueOnce(true);
      renderWith({ onTestConnection });
      await typeKey("sk-test");
      typeModel("gpt-4o-mini");
      const test = screen.getByRole("button", { name: "Test Connection" });

      fireEvent.click(test);
      expect(
        await screen.findByText("Connection test failed"),
      ).toBeInTheDocument();
      expect(onTestConnection).toHaveBeenCalledWith(
        expect.objectContaining({ aiToken: "sk-test", aiModel: "gpt-4o-mini" }),
      );

      await waitFor(() => expect(test).toBeEnabled());
      fireEvent.click(test);
      expect(
        await screen.findByText("Connection test failed: 401 Unauthorized"),
      ).toBeInTheDocument();

      await waitFor(() => expect(test).toBeEnabled());
      fireEvent.click(test);
      expect(
        await screen.findByText("Connection test successful"),
      ).toBeInTheDocument();
    });
  });

  describe("Anthropic workspace ID", () => {
    it("is offered only for Anthropic, and goes with the key into Test Connection and the saved settings, behind a proxy host too", async () => {
      const onTestConnection = vi.fn().mockResolvedValue(true);
      const onSave = vi.fn();
      render(
        <I18nProvider storageAdapter={createMemoryStorage<string>() as never}>
          <ThemeProvider
            storageAdapter={createMemoryStorage<string>() as never}
          >
            <SettingsPage
              storageAdapter={createMemoryStorage<unknown>()}
              initialTab="ai"
              onSave={onSave}
              onTestConnection={onTestConnection}
            />
          </ThemeProvider>
        </I18nProvider>,
      );
      await screen.findByPlaceholderText("Your API Key");
      expect(screen.queryByLabelText("Workspace ID")).toBeNull();

      const anthropic = screen
        .getAllByText("Anthropic")
        .map((node) => node.closest("button"))
        .find(Boolean);
      fireEvent.click(anthropic as HTMLElement);
      fireEvent.change(await screen.findByPlaceholderText("sk-ant-..."), {
        target: { value: "sk-ant-test" },
      });
      fireEvent.change(screen.getByLabelText("AI Host"), {
        target: { value: "https://llm-proxy.example.com/v1" },
      });
      fireEvent.change(screen.getByLabelText("Workspace ID"), {
        target: { value: "wrkspc_01Test" },
      });
      expect(screen.getByLabelText("Workspace ID")).toHaveAccessibleDescription(
        /Claude Console → Settings → Workspaces/,
      );

      fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
      await waitFor(() =>
        expect(onTestConnection).toHaveBeenCalledWith(
          expect.objectContaining({
            aiProvider: "anthropic",
            aiToken: "sk-ant-test",
            aiWorkspaceId: "wrkspc_01Test",
          }),
        ),
      );
      fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
      await waitFor(() =>
        expect(onSave).toHaveBeenCalledWith(
          expect.objectContaining({ aiWorkspaceId: "wrkspc_01Test" }),
        ),
      );
    });
  });

  describe("health-data warning (D7)", () => {
    it("warns, for a provider not confirmed for health data, to check the agreement first", async () => {
      render(
        <I18nProvider storageAdapter={createMemoryStorage<string>() as never}>
          <ThemeProvider
            storageAdapter={createMemoryStorage<string>() as never}
          >
            <SettingsPage
              storageAdapter={createMemoryStorage<unknown>()}
              initialTab="ai"
            />
          </ThemeProvider>
        </I18nProvider>,
      );
      await screen.findByPlaceholderText("Your API Key");
      const anthropic = screen
        .getAllByText("Anthropic")
        .map((node) => node.closest("button"))
        .find(Boolean);
      fireEvent.click(anthropic as HTMLElement);

      expect(
        await screen.findByText(/covers health or other regulated data/),
      ).toBeInTheDocument();
    });
  });

  describe("Fetch models and the tool-calling probe (C1)", () => {
    function renderWith(props: Partial<SettingsPageProps>) {
      render(
        <I18nProvider storageAdapter={createMemoryStorage<string>() as never}>
          <ThemeProvider
            storageAdapter={createMemoryStorage<string>() as never}
          >
            <SettingsPage
              storageAdapter={createMemoryStorage<unknown>()}
              initialTab="ai"
              {...props}
            />
          </ThemeProvider>
        </I18nProvider>,
      );
    }

    function suggestions() {
      const list = document.querySelector("datalist");
      return [...(list?.querySelectorAll("option") ?? [])].map(
        (option) => option.value,
      );
    }

    it("adds the provider's live models to the suggestions, keeping the presets", async () => {
      const onFetchModels = vi
        .fn()
        .mockResolvedValue({ ok: true, models: ["live-a", "live-b"] });
      renderWith({ onFetchModels });
      const fetch = await screen.findByRole("button", { name: "Fetch models" });
      expect(fetch).toBeDisabled();

      fireEvent.change(screen.getByPlaceholderText("Your API Key"), {
        target: { value: "sk-test" },
      });
      fireEvent.click(fetch);

      expect(
        await screen.findByText("2 models from the provider"),
      ).toBeInTheDocument();
      expect(onFetchModels).toHaveBeenCalledWith(
        expect.objectContaining({ aiToken: "sk-test" }),
      );
      expect(suggestions().slice(0, 2)).toEqual(["live-a", "live-b"]);
    });

    it("names a failure and leaves manual entry working", async () => {
      renderWith({
        onFetchModels: vi.fn().mockResolvedValue({
          ok: false,
          error: "The provider rejected the API key (401).",
        }),
      });
      fireEvent.change(await screen.findByPlaceholderText("Your API Key"), {
        target: { value: "sk-bad" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The provider rejected the API key (401). Pick a suggestion or type the model id.",
      );
      fireEvent.change(screen.getByPlaceholderText("deepseek-chat"), {
        target: { value: "typed-model" },
      });
      expect(screen.getByPlaceholderText("deepseek-chat")).toHaveValue(
        "typed-model",
      );
    });

    it("shows the probe's verdict, and warns before selecting a model that did not call tools", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      renderWith({
        onTestConnection: vi
          .fn()
          .mockResolvedValue({ ok: true, toolCalling: "no" }),
      });
      fireEvent.change(await screen.findByPlaceholderText("Your API Key"), {
        target: { value: "sk-test" },
      });
      fireEvent.change(screen.getByPlaceholderText("deepseek-chat"), {
        target: { value: "text-only-model" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

      expect(
        await screen.findAllByText("Tool calling: no — the agent needs it"),
      ).not.toHaveLength(0);
      expect(screen.getByText("No tools")).toBeInTheDocument();

      const tested = screen.getByText("No tools").closest("div.group");
      const other = [...document.querySelectorAll("div.group")].find(
        (row) => row !== tested,
      );
      fireEvent.click(other?.querySelector("button") as HTMLElement);
      fireEvent.click(tested?.querySelector("button") as HTMLElement);

      expect(confirm).toHaveBeenCalledWith(
        "text-only-model did not call a tool in the last connection test. The agent needs function calling to work. Use it anyway?",
      );
    });
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
