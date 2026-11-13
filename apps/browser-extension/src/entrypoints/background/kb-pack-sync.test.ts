import type { OrgPolicyState } from "@apty/agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/kb-pack-sync", () => ({
  KB_PACK_SYNC_NOW: "kb-pack-sync-now",
  kbPackSync: vi.fn(),
}));

import {
  KB_PACK_STARTUP_DELAY_MS,
  KB_PACK_SYNC_ALARM,
  type KbPackSyncDeps,
  registerKbPackSync,
} from "./kb-pack-sync";

const EXTENSION_ID = "this-extension-id";
const TRUSTED = {
  id: EXTENSION_ID,
  url: `chrome-extension://${EXTENSION_ID}/src/entrypoints/options/index.html`,
};
const CONTENT_SCRIPT = { id: EXTENSION_ID, url: "https://example.com/" };

const SOURCED: OrgPolicyState = {
  kind: "active",
  policy: {
    kbPackSources: { "5.x": "https://packs.example.com/5x.json" },
    kbPackCheckHours: 12,
  },
};
const NONE: OrgPolicyState = { kind: "none" };

type Listener = (...args: never[]) => unknown;

function fakeChrome() {
  const listeners: Record<string, Listener[]> = {};
  const on = (name: string) => ({
    addListener: (listener: Listener) => {
      listeners[name] = [...(listeners[name] ?? []), listener];
    },
  });
  const alarms = new Map<string, chrome.alarms.Alarm>();
  const api = {
    runtime: {
      id: EXTENSION_ID,
      onStartup: on("startup"),
      onInstalled: on("installed"),
      onMessage: on("message"),
    },
    alarms: {
      onAlarm: on("alarm"),
      get: vi.fn(async (name: string) => alarms.get(name)),
      clear: vi.fn(async (name: string) => alarms.delete(name)),
      create: vi.fn(
        async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
          alarms.set(name, {
            name,
            scheduledTime: 0,
            periodInMinutes: info.periodInMinutes,
          });
        },
      ),
    },
  };
  const fire = (name: string, ...args: unknown[]) =>
    (listeners[name] ?? []).map((listener) =>
      (listener as (...a: unknown[]) => unknown)(...args),
    );
  return { api, alarms, fire };
}

function setup(initial: OrgPolicyState) {
  const chromeFake = fakeChrome();
  let state = initial;
  let onPolicy: ((next: OrgPolicyState) => void) | undefined;
  const syncAll = vi.fn(async () => [
    { version: "5.x" as const, outcome: "updated" as const, httpStatus: 200 },
  ]);
  const delayed: Array<{ run: () => void; ms: number }> = [];
  const deps: KbPackSyncDeps = {
    chromeApi: chromeFake.api as unknown as KbPackSyncDeps["chromeApi"],
    sync: () => ({ syncAll }),
    policy: async () => state,
    watchPolicy: (listener) => {
      onPolicy = listener;
      return () => undefined;
    },
    delay: (run, ms) => {
      delayed.push({ run, ms });
    },
  };
  registerKbPackSync(deps);
  return {
    ...chromeFake,
    syncAll,
    delayed,
    async changePolicy(next: OrgPolicyState) {
      state = next;
      onPolicy?.(next);
      await vi.waitFor(() => undefined);
    },
  };
}

describe("registerKbPackSync (KB-RAG K26 D3)", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", { runtime: { id: EXTENSION_ID } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("with no policy source: no alarm and no request, at start-up or on the alarm", async () => {
    const env = setup(NONE);
    await vi.waitFor(() =>
      expect(env.api.alarms.clear).toHaveBeenCalledWith(KB_PACK_SYNC_ALARM),
    );
    expect(env.api.alarms.create).not.toHaveBeenCalled();
    env.fire("startup");
    for (const { run } of env.delayed) run();
    env.fire("alarm", { name: KB_PACK_SYNC_ALARM });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(env.syncAll).not.toHaveBeenCalled();
  });

  it("creates the alarm at kbPackCheckHours and runs 30 seconds after start-up", async () => {
    const env = setup(SOURCED);
    await vi.waitFor(() =>
      expect(env.api.alarms.create).toHaveBeenCalledWith(KB_PACK_SYNC_ALARM, {
        delayInMinutes: 720,
        periodInMinutes: 720,
      }),
    );
    env.fire("startup");
    env.fire("installed");
    expect(env.delayed.map((entry) => entry.ms)).toEqual([
      KB_PACK_STARTUP_DELAY_MS,
      KB_PACK_STARTUP_DELAY_MS,
    ]);
    env.delayed[0]?.run();
    await vi.waitFor(() =>
      expect(env.syncAll).toHaveBeenCalledWith({ reason: "startup" }),
    );
    env.fire("alarm", { name: "something-else" });
    env.fire("alarm", { name: KB_PACK_SYNC_ALARM });
    await vi.waitFor(() =>
      expect(env.syncAll).toHaveBeenCalledWith({ reason: "alarm" }),
    );
    expect(env.syncAll).toHaveBeenCalledTimes(2);
  });

  it("recreates the alarm when the policy changes, and removes it with the source", async () => {
    const env = setup(SOURCED);
    await vi.waitFor(() =>
      expect(env.alarms.has(KB_PACK_SYNC_ALARM)).toBe(true),
    );
    await env.changePolicy({
      kind: "active",
      policy: {
        kbPackSources: { "5.x": "https://packs.example.com/5x.json" },
        kbPackCheckHours: 2,
      },
    });
    await vi.waitFor(() =>
      expect(env.alarms.get(KB_PACK_SYNC_ALARM)?.periodInMinutes).toBe(120),
    );
    await env.changePolicy(NONE);
    await vi.waitFor(() =>
      expect(env.alarms.has(KB_PACK_SYNC_ALARM)).toBe(false),
    );
  });

  it("runs Check now for the extension's own pages only, and returns the outcomes", async () => {
    const env = setup(SOURCED);
    const answers: unknown[] = [];
    const [kept] = env.fire(
      "message",
      { request: "kb-pack-sync-now" },
      TRUSTED,
      (answer: unknown) => answers.push(answer),
    );
    expect(kept).toBe(true);
    await vi.waitFor(() =>
      expect(answers).toEqual([
        {
          ok: true,
          results: [{ version: "5.x", outcome: "updated", httpStatus: 200 }],
        },
      ]),
    );
    expect(env.syncAll).toHaveBeenCalledWith({ reason: "manual" });
    env.fire(
      "message",
      { request: "kb-pack-sync-now" },
      CONTENT_SCRIPT,
      (answer: unknown) => answers.push(answer),
    );
    expect(answers.at(-1)).toEqual({ ok: false, error: "Unauthorized sender" });
    expect(env.syncAll).toHaveBeenCalledTimes(1);
    const [ignored] = env.fire(
      "message",
      { request: "other" },
      TRUSTED,
      () => undefined,
    );
    expect(ignored).toBe(false);
  });
});
