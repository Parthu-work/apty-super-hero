import { beforeEach, describe, expect, it, vi } from "vitest";

const device = vi.hoisted(() => {
  const state = {
    items: {} as Record<string, unknown>,
    listeners: [] as Array<
      (changes: Record<string, { newValue?: unknown }>, area: string) => void
    >,
  };
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: state.items[key] }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(state.items, structuredClone(values));
        },
        remove: async (key: string) => {
          delete state.items[key];
        },
      },
      onChanged: {
        addListener: (listener: (typeof state.listeners)[number]) =>
          state.listeners.push(listener),
      },
    },
  };
  return state;
});

import {
  clearKbVersions,
  forgetKbVersions,
  KB_VERSION_MAX_AGE_MS,
  KB_VERSION_QUESTIONS_KEY,
  KB_VERSIONS_KEY,
  kbVersionForHost,
  kbVersionQuestioned,
  kbVersionSourceForHost,
  markKbVersionQuestioned,
  reloadKbVersionsForTests,
  rememberKbVersion,
  resolveKbVersionFromClient,
  subscribeKbVersions,
  versionFromFileNames,
  whenKbVersionsLoaded,
} from "./kb-version.js";

beforeEach(async () => {
  await whenKbVersionsLoaded();
  device.items = {};
  forgetKbVersions();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the tab's Apty version", () => {
  it("is unknown until a check's files or the user say", () => {
    expect(kbVersionForHost("crm.example.com")).toBe("unknown");
    expect(kbVersionForHost(undefined)).toBe("unknown");
  });

  it("takes the user's choice per site host", () => {
    rememberKbVersion("crm.example.com", "4.x", "user");
    expect(kbVersionForHost("crm.example.com")).toBe("4.x");
    expect(kbVersionForHost("hr.example.com")).toBe("unknown");
    rememberKbVersion("crm.example.com", "unknown", "user");
    expect(kbVersionForHost("crm.example.com")).toBe("unknown");
  });

  it("prefers what a check's files showed over the user's choice", () => {
    rememberKbVersion("crm.example.com", "5.x", "evidence");
    rememberKbVersion("crm.example.com", "4.x", "user");
    expect(kbVersionForHost("crm.example.com")).toBe("5.x");
    rememberKbVersion("crm.example.com", "unknown", "evidence");
    expect(kbVersionForHost("crm.example.com")).toBe("5.x");
    rememberKbVersion("crm.example.com", "4.x", "evidence");
    expect(kbVersionForHost("crm.example.com")).toBe("4.x");
  });
});

describe("the version from the Client's files (KB-RAG K27, F7)", () => {
  it("reads the K13 markers: 4.x, 5.x, or unknown when both or neither", () => {
    expect(versionFromFileNames(["app.json", "flow.json"])).toBe("4.x");
    expect(versionFromFileNames(["segments.json", "rules.json"])).toBe("4.x");
    expect(versionFromFileNames(["workflow.json", "segment.json"])).toBe("5.x");
    expect(versionFromFileNames(["flow.json", "workflow.json"])).toBe(
      "unknown",
    );
    expect(versionFromFileNames(["app.json"])).toBe("unknown");
  });

  it("resolves a site once, asks again for a new site, and gives way to the SE's choice", async () => {
    forgetKbVersions();
    const names = vi.fn(async () => ["flow.json"]);
    await resolveKbVersionFromClient("one.example.com", names);
    await resolveKbVersionFromClient("one.example.com", names);
    expect(names).toHaveBeenCalledTimes(1);
    expect(kbVersionForHost("one.example.com")).toBe("4.x");
    expect(kbVersionSourceForHost("one.example.com")).toBe("client");
    rememberKbVersion("one.example.com", "5.x", "user");
    expect(kbVersionForHost("one.example.com")).toBe("5.x");

    await resolveKbVersionFromClient("two.example.com", async () => [
      "workflow.json",
    ]);
    expect(kbVersionForHost("two.example.com")).toBe("5.x");

    const later = vi.fn(async () => undefined);
    await resolveKbVersionFromClient("three.example.com", later);
    await resolveKbVersionFromClient("three.example.com", later);
    expect(later).toHaveBeenCalledTimes(2);
  });
});

describe("each site's version kept on the device (KB-RAG K29, B1)", () => {
  it("keeps a version chosen in one chat for a new chat and after a panel reload", async () => {
    rememberKbVersion("acc.tenant.example", "5.x", "user");
    await settle();

    await reloadKbVersionsForTests();

    expect(kbVersionForHost("acc.tenant.example")).toBe("5.x");
    expect(kbVersionSourceForHost("acc.tenant.example")).toBe("user");
    const stored = device.items[KB_VERSIONS_KEY] as Record<string, unknown>;
    expect(Object.keys(stored)).toEqual(["acc.tenant.example"]);
    expect(stored["acc.tenant.example"]).toEqual({
      version: "5.x",
      source: "user",
      at: expect.any(Number),
    });
  });

  it("lets the files override a choice, and keeps the files' version after a reload", async () => {
    rememberKbVersion("acc.tenant.example", "4.x", "user");
    rememberKbVersion("acc.tenant.example", "5.x", "evidence");
    rememberKbVersion("acc.tenant.example", "4.x", "user");
    await settle();

    await reloadKbVersionsForTests();

    expect(kbVersionForHost("acc.tenant.example")).toBe("5.x");
    expect(kbVersionSourceForHost("acc.tenant.example")).toBe("evidence");
  });

  it("ranks a file name in the question below every other source", () => {
    rememberKbVersion("one.example.com", "4.x", "question");
    expect(kbVersionForHost("one.example.com")).toBe("4.x");
    rememberKbVersion("one.example.com", "5.x", "client");
    expect(kbVersionForHost("one.example.com")).toBe("5.x");
    rememberKbVersion("one.example.com", "4.x", "question");
    expect(kbVersionForHost("one.example.com")).toBe("5.x");
  });

  it("clears every site with Delete stored data now, here and on the device", async () => {
    rememberKbVersion("acc.tenant.example", "5.x", "user");
    await settle();
    const changed = vi.fn();
    const stop = subscribeKbVersions(changed);

    await clearKbVersions();
    stop();

    expect(kbVersionForHost("acc.tenant.example")).toBe("unknown");
    expect(device.items[KB_VERSIONS_KEY]).toBeUndefined();
    expect(changed).toHaveBeenCalled();
    await reloadKbVersionsForTests();
    expect(kbVersionForHost("acc.tenant.example")).toBe("unknown");
  });

  it("drops a site unused for 90 days, and ignores malformed entries", async () => {
    const now = Date.now();
    device.items[KB_VERSIONS_KEY] = {
      "old.example.com": {
        version: "4.x",
        source: "user",
        at: now - KB_VERSION_MAX_AGE_MS - 1,
      },
      "fresh.example.com": { version: "4.x", source: "user", at: now - 1000 },
      "odd.example.com": { version: "6.x", source: "user", at: now },
      "odder.example.com": { version: "5.x", source: "guess", at: now },
    };

    await reloadKbVersionsForTests();

    expect(kbVersionForHost("old.example.com")).toBe("unknown");
    expect(kbVersionForHost("fresh.example.com")).toBe("4.x");
    expect(kbVersionForHost("odd.example.com")).toBe("unknown");
    expect(kbVersionForHost("odder.example.com")).toBe("unknown");
  });

  it("follows a change another extension page makes", async () => {
    await reloadKbVersionsForTests();
    for (const listener of device.listeners) {
      listener(
        {
          [KB_VERSIONS_KEY]: {
            newValue: {
              "acc.tenant.example": {
                version: "4.x",
                source: "user",
                at: Date.now(),
              },
            },
          },
        },
        "local",
      );
    }
    expect(kbVersionForHost("acc.tenant.example")).toBe("4.x");
  });
});

describe("the version question, asked once per site (KB-RAG K29, D3)", () => {
  it("remembers that the SE answered Not sure for a new chat and after a panel reload", async () => {
    expect(kbVersionQuestioned("acc.tenant.example")).toBe(false);
    const changed = vi.fn();
    const stop = subscribeKbVersions(changed);
    markKbVersionQuestioned("acc.tenant.example");
    stop();
    expect(changed).toHaveBeenCalled();
    await settle();
    expect(
      Object.keys(device.items[KB_VERSION_QUESTIONS_KEY] as object),
    ).toEqual(["acc.tenant.example"]);
    await reloadKbVersionsForTests();
    expect(kbVersionQuestioned("acc.tenant.example")).toBe(true);
    expect(kbVersionQuestioned("other.tenant.example")).toBe(false);
    expect(kbVersionForHost("acc.tenant.example")).toBe("unknown");
  });

  it("forgets the answers with Delete stored data now, and after 90 days unused", async () => {
    markKbVersionQuestioned("acc.tenant.example");
    await settle();
    await clearKbVersions();
    expect(kbVersionQuestioned("acc.tenant.example")).toBe(false);
    expect(device.items[KB_VERSION_QUESTIONS_KEY]).toBeUndefined();
    device.items[KB_VERSION_QUESTIONS_KEY] = {
      "old.example.com": Date.now() - KB_VERSION_MAX_AGE_MS - 1,
      "new.example.com": Date.now(),
      "bad.example.com": "yesterday",
    };
    await reloadKbVersionsForTests();
    expect(kbVersionQuestioned("old.example.com")).toBe(false);
    expect(kbVersionQuestioned("bad.example.com")).toBe(false);
    expect(kbVersionQuestioned("new.example.com")).toBe(true);
  });
});
