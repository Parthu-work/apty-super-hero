import { describe, expect, it, vi } from "vitest";

vi.mock("@apty/browser-runtime", () => ({
  getAptyIntegrationConfig: vi.fn(),
  watchAptyIntegrationConfig: vi.fn(),
}));
vi.mock("../services/apty-client-check", () => ({
  checkPeer: vi.fn(),
  connectPeer: vi.fn(),
}));

import type { ClientCheck } from "../services/apty-client-check";
import {
  createPeerStore,
  type PeerStatus,
  readinessStates,
  setupCount,
} from "./readiness-store";

const CLIENT_ID = "abcdefghijklmnopabcdefghijklmnop";
const STUDIO_ID = "ponmlkjihgfedcbaponmlkjihgfedcba";

const PEER_CASES: Array<[PeerStatus, boolean]> = [
  [{ kind: "checking" }, false],
  [{ kind: "not-configured" }, false],
  [{ kind: "connected", extensionId: CLIENT_ID }, false],
  [{ kind: "not-answering", extensionId: CLIENT_ID }, true],
];

describe("setupCount", () => {
  const combinations = [true, false].flatMap((providerConfigured) =>
    PEER_CASES.flatMap(([client, clientWarns]) =>
      PEER_CASES.flatMap(([studio, studioWarns]) =>
        [null, true, false].map((pageInspectable) => ({
          facts: {
            providerConfigured,
            peers: { client, studio },
            pageInspectable,
          },
          expected:
            Number(!providerConfigured) +
            Number(clientWarns) +
            Number(studioWarns) +
            Number(pageInspectable === false),
        })),
      ),
    ),
  );

  it(`counts warnings only, in all ${combinations.length} combinations`, () => {
    for (const { facts, expected } of combinations) {
      expect(setupCount(readinessStates(facts)), JSON.stringify(facts)).toBe(
        expected,
      );
    }
  });

  it("does not count a Client or Studio that was never set up", () => {
    const states = readinessStates({
      providerConfigured: true,
      peers: {
        client: { kind: "not-configured" },
        studio: { kind: "not-configured" },
      },
      pageInspectable: true,
    });
    expect(states).toMatchObject({ client: "info", studio: "info" });
    expect(setupCount(states)).toBe(0);
  });
});

function harness(config: Record<string, unknown> = {}) {
  let onConfigChange = () => {};
  const unwatch = vi.fn();
  const deps = {
    getConfig: vi.fn().mockResolvedValue(config),
    watchConfig: vi.fn((listener: () => void) => {
      onConfigChange = listener;
      return unwatch;
    }),
    check: vi.fn<(peer: string, id: string) => Promise<ClientCheck>>(),
    connect: vi.fn<(peer: string, id: string) => Promise<ClientCheck>>(),
  };
  const store = createPeerStore(deps as never);
  return { store, deps, unwatch, configChanged: () => onConfigChange() };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("peer store", () => {
  it("checks each configured peer when the first view subscribes", async () => {
    const { store, deps } = harness({
      clientExtensionId: CLIENT_ID,
      peers: { studio: { extensionId: STUDIO_ID } },
    });
    deps.check.mockImplementation(async (peer) =>
      peer === "client"
        ? { status: "ok" }
        : { status: "not_answering", message: "No receiver", fix: "Add it" },
    );

    expect(store.getState().client).toEqual({ kind: "checking" });
    store.subscribe(() => {});
    await settled();

    expect(deps.check).toHaveBeenCalledWith("client", CLIENT_ID);
    expect(deps.check).toHaveBeenCalledWith("studio", STUDIO_ID);
    expect(store.getState()).toEqual({
      client: { kind: "connected", extensionId: CLIENT_ID },
      studio: {
        kind: "not-answering",
        extensionId: STUDIO_ID,
        message: "No receiver",
        fix: "Add it",
      },
    });
  });

  it("marks a peer that was never set up as not configured, without checking it", async () => {
    const { store, deps } = harness();
    store.subscribe(() => {});
    await settled();
    expect(deps.check).not.toHaveBeenCalled();
    expect(store.getState()).toEqual({
      client: { kind: "not-configured" },
      studio: { kind: "not-configured" },
    });
  });

  it("treats a check that throws as not answering", async () => {
    const { store, deps } = harness({ clientExtensionId: CLIENT_ID });
    deps.check.mockRejectedValue(new Error("port closed"));
    store.subscribe(() => {});
    await settled();
    expect(store.getState().client).toMatchObject({
      kind: "not-answering",
      extensionId: CLIENT_ID,
    });
  });

  it("re-checks when the stored IDs change, and stops watching with the last view", async () => {
    const { store, deps, unwatch, configChanged } = harness();
    const unsubscribe = store.subscribe(() => {});
    await settled();

    deps.getConfig.mockResolvedValue({ clientExtensionId: CLIENT_ID });
    deps.check.mockResolvedValue({ status: "ok" });
    configChanged();
    await settled();
    expect(store.getState().client).toEqual({
      kind: "connected",
      extensionId: CLIENT_ID,
    });

    unsubscribe();
    expect(unwatch).toHaveBeenCalled();
  });

  it("connects through the shared connect path and shows the checking state meanwhile", async () => {
    const { store, deps } = harness();
    let answer: (check: ClientCheck) => void = () => {};
    deps.connect.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    const connecting = store.connect("client", CLIENT_ID);
    expect(store.getState().client).toEqual({ kind: "checking" });
    answer({ status: "ok" });

    await expect(connecting).resolves.toEqual({ status: "ok" });
    expect(deps.connect).toHaveBeenCalledWith("client", CLIENT_ID);
    expect(store.getState().client).toEqual({
      kind: "connected",
      extensionId: CLIENT_ID,
    });
  });

  it("goes back to what is stored when the extension is not installed", async () => {
    const { store, deps } = harness();
    deps.connect.mockResolvedValue({
      status: "error",
      message: "Not installed",
    });

    await store.connect("studio", STUDIO_ID);

    expect(store.getState().studio).toEqual({ kind: "not-configured" });
  });
});
