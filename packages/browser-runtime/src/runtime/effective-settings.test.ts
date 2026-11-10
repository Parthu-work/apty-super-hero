import {
  type AppSettings,
  type KbPackInfo,
  type OrgPolicyState,
  STORAGE_KEYS,
} from "@apty/agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type EffectiveSettingsDeps,
  effectiveSettingsStorage,
  loadEffectiveSettings,
  saveSettings,
  watchEffectiveSettings,
} from "./effective-settings";

type ChangeListener = (
  changes: Record<string, { newValue?: unknown }>,
  area: string,
) => void;
let listeners: ChangeListener[] = [];

const pack = (site: string) => ({ site }) as KbPackInfo;

function depsWith(
  initial: AppSettings,
  policy: OrgPolicyState,
  packs: KbPackInfo[] = [],
) {
  let stored: AppSettings = { ...initial };
  const deps: EffectiveSettingsDeps & { stored(): AppSettings } = {
    storedSettings: async () => stored,
    writeSettings: async (next) => {
      stored = next;
    },
    policy: async () => policy,
    packs: async () => packs,
    stored: () => stored,
  };
  return deps;
}

const PRESET: OrgPolicyState = {
  kind: "active",
  policy: { preset: { aiProvider: "azure", aiModel: "gpt-org" } },
};

describe("effective settings in the browser", () => {
  beforeEach(() => {
    listeners = [];
    vi.stubGlobal("chrome", {
      storage: {
        onChanged: {
          addListener: (l: ChangeListener) => listeners.push(l),
          removeListener: (l: ChangeListener) => {
            listeners = listeners.filter((x) => x !== l);
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies the policy and the packs to what is stored", async () => {
    const deps = depsWith(
      { aiProvider: "openai", redactionMode: "off" },
      PRESET,
      [pack("synthetic.atlassian.example")],
    );
    const { settings, locked } = await loadEffectiveSettings(deps);
    expect(settings.aiProvider).toBe("azure");
    expect(settings.redactionMode).toBe("standard");
    expect(locked.has("aiProvider")).toBe(true);
  });

  it("keeps the SE's mode with only demo packs loaded", async () => {
    const deps = depsWith({ redactionMode: "off" }, { kind: "none" }, [
      pack("demo.atlassian.invalid"),
    ]);
    expect((await loadEffectiveSettings(deps)).settings.redactionMode).toBe(
      "off",
    );
  });

  it("counts an unreadable pack store as a non-demo pack (fail closed)", async () => {
    const deps = depsWith({ redactionMode: "off" }, { kind: "none" });
    deps.packs = async () => {
      throw new Error("IndexedDB blocked");
    };
    expect((await loadEffectiveSettings(deps)).settings.redactionMode).toBe(
      "standard",
    );
  });

  it("ignores a write to a locked field, and a direct write does not change the effective value", async () => {
    const deps = depsWith({ aiProvider: "openai" }, PRESET);
    const ignored = await saveSettings(
      { aiProvider: "deepseek", language: "zh" },
      deps,
    );
    expect(ignored).toEqual(["aiProvider"]);
    expect(deps.stored()).toEqual({ aiProvider: "openai", language: "zh" });
    await deps.writeSettings({ aiProvider: "deepseek", aiModel: "mine" });
    const { settings } = await loadEffectiveSettings(deps);
    expect(settings.aiProvider).toBe("azure");
    expect(settings.aiModel).toBe("gpt-org");
  });

  it("serves the settings UI the effective settings through its adapter", async () => {
    const base = {
      load: vi.fn(async () => "base"),
      save: vi.fn(),
      delete: vi.fn(),
      listAll: vi.fn(),
      query: vi.fn(),
      watch: vi.fn(() => () => {}),
    };
    const deps = depsWith({ aiProvider: "openai" }, PRESET);
    const adapter = effectiveSettingsStorage(base, deps);
    expect(await adapter.load(STORAGE_KEYS.SETTINGS)).toMatchObject({
      aiProvider: "azure",
    });
    expect(await adapter.load("other")).toBe("base");
    await adapter.save(STORAGE_KEYS.SETTINGS, { aiProvider: "groq" });
    expect(deps.stored().aiProvider).toBe("openai");
    expect(base.save).not.toHaveBeenCalled();
  });

  it("re-merges a settings change with the last policy, and re-reads on a pack change", async () => {
    const deps = depsWith({ redactionMode: "off" }, PRESET);
    const seen = vi.fn();
    watchEffectiveSettings(seen, deps);
    await vi.waitFor(() => expect(listeners.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const l of listeners) {
      l(
        { [STORAGE_KEYS.SETTINGS]: { newValue: { aiProvider: "groq" } } },
        "local",
      );
    }
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ aiProvider: "azure" }),
      }),
    );
    deps.packs = async () => [pack("synthetic.atlassian.example")];
    for (const l of listeners) {
      l({ apty_kb_packs_changed: { newValue: 1 } }, "local");
    }
    await vi.waitFor(() =>
      expect(seen).toHaveBeenLastCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ redactionMode: "standard" }),
        }),
      ),
    );
  });
});
