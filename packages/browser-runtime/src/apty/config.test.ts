import { beforeEach, describe, expect, it } from "vitest";

let store: Record<string, unknown>;

// A fake that round-trips through a macrotask like the real
// chrome.storage.local API does — a naive (non-serialized) get-then-set
// implementation would race under this, which is exactly what the
// concurrency test below depends on to be a meaningful regression test.
function makeFakeStorage() {
  return {
    get: (key: string) => Promise.resolve({ [key]: store[key] }),
    set: (items: Record<string, unknown>) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          store = { ...store, ...items };
          resolve();
        }, 0);
      }),
  };
}

(global as any).chrome = {
  storage: { local: makeFakeStorage() },
};

import {
  getAptyIntegrationConfig,
  seedAptyIntegrationConfigDefaults,
  updateAptyIntegrationConfig,
} from "./config";

beforeEach(() => {
  store = {};
});

describe("Apty integration config", () => {
  it("returns an empty object when nothing has been stored", async () => {
    expect(await getAptyIntegrationConfig()).toEqual({});
  });

  it("updateAptyIntegrationConfig merges a patch into the existing config", async () => {
    await updateAptyIntegrationConfig({ clientExtensionId: "client-id" });
    await updateAptyIntegrationConfig({ studioExtensionId: "studio-id" });

    expect(await getAptyIntegrationConfig()).toEqual({
      clientExtensionId: "client-id",
      studioExtensionId: "studio-id",
    });
  });

  it("updateAptyIntegrationConfig can explicitly clear a field with undefined", async () => {
    await updateAptyIntegrationConfig({ clientExtensionId: "client-id" });
    await updateAptyIntegrationConfig({ clientExtensionId: undefined });

    expect(
      (await getAptyIntegrationConfig()).clientExtensionId,
    ).toBeUndefined();
  });

  it("seeding fills a key that has never been set", async () => {
    await seedAptyIntegrationConfigDefaults({
      clientExtensionId: "buildtime-default",
    });

    expect((await getAptyIntegrationConfig()).clientExtensionId).toBe(
      "buildtime-default",
    );
  });

  it("seeding with no build-time value for a key never touches it (keeps a previously configured value)", async () => {
    await updateAptyIntegrationConfig({ clientExtensionId: "user-configured" });

    await seedAptyIntegrationConfigDefaults({ clientExtensionId: undefined });

    expect((await getAptyIntegrationConfig()).clientExtensionId).toBe(
      "user-configured",
    );
  });

  it("seeding never overrides an already-configured value, even when the build provides a default for it", async () => {
    await updateAptyIntegrationConfig({ clientExtensionId: "user-configured" });

    await seedAptyIntegrationConfigDefaults({
      clientExtensionId: "buildtime-default",
    });

    expect((await getAptyIntegrationConfig()).clientExtensionId).toBe(
      "user-configured",
    );
  });

  it("seeding fills different unset keys independently without touching already-set ones", async () => {
    await updateAptyIntegrationConfig({ clientExtensionId: "user-configured" });

    await seedAptyIntegrationConfigDefaults({
      clientExtensionId: "buildtime-default",
      studioExtensionId: "studio-buildtime-default",
    });

    expect(await getAptyIntegrationConfig()).toEqual({
      clientExtensionId: "user-configured",
      studioExtensionId: "studio-buildtime-default",
    });
  });

  it("does not lose a write when two updates race (storage get-then-set is not atomic without serialization)", async () => {
    const [a, b] = await Promise.all([
      updateAptyIntegrationConfig({ clientExtensionId: "client-id" }),
      updateAptyIntegrationConfig({ studioExtensionId: "studio-id" }),
    ]);

    // Each call's own return value reflects everything merged so far in
    // the serialized queue, not just its own patch.
    expect(a.clientExtensionId).toBe("client-id");
    expect(b.studioExtensionId).toBe("studio-id");

    const final = await getAptyIntegrationConfig();
    expect(final.clientExtensionId).toBe("client-id");
    expect(final.studioExtensionId).toBe("studio-id");
  });

  it("does not lose a write when seeding races a concurrent user update", async () => {
    await Promise.all([
      seedAptyIntegrationConfigDefaults({
        clientExtensionId: "buildtime-default",
      }),
      updateAptyIntegrationConfig({ studioExtensionId: "studio-id" }),
    ]);

    const final = await getAptyIntegrationConfig();
    expect(final.clientExtensionId).toBe("buildtime-default");
    expect(final.studioExtensionId).toBe("studio-id");
  });
});
