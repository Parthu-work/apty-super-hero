import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@apty/browser-runtime", () => ({}));

import type {
  ApplicationAuditOutcome,
  DomHealthAuditOutcome,
  RunApplicationAuditOptions,
} from "@apty/browser-runtime";
import { acquireTabLock, releaseTabLock } from "./dom-config/tab-lock";
import { createDomHealthStore, domHealthPhase } from "./dom-health-store";

const TAB = 7;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function harness() {
  const page = deferred<DomHealthAuditOutcome>();
  const app = deferred<ApplicationAuditOutcome>();
  let appOptions: RunApplicationAuditOptions | undefined;
  const deps = {
    checkPage: vi.fn(() => page.promise),
    auditApplication: vi.fn(
      (_tabId: number, options?: RunApplicationAuditOptions) => {
        appOptions = options;
        return app.promise;
      },
    ),
    now: () => 1000,
  };
  const store = createDomHealthStore(deps as never);
  return { store, deps, page, app, options: () => appOptions };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  releaseTabLock(TAB, "dom-health");
  releaseTabLock(TAB, "dom-config");
});

describe("DOM health store", () => {
  it("goes from idle to running to a result, and frees the tab", async () => {
    const { store, page } = harness();
    expect(domHealthPhase(store.getState())).toBe("idle");

    expect(store.checkPage({ tabId: TAB })).toBe("started");
    expect(domHealthPhase(store.getState())).toBe("running");
    expect(store.getState()).toMatchObject({
      running: "page",
      tabId: TAB,
      startedAt: 1000,
    });

    page.resolve({ available: true, score: 80 } as never);
    await settled();
    expect(domHealthPhase(store.getState())).toBe("result");
    expect(store.getState()).toMatchObject({ running: null, startedAt: null });
    expect(acquireTabLock(TAB, "dom-config")).toBe(true);
  });

  it("reads a check that could not run, or threw, as failed", async () => {
    const first = harness();
    first.store.checkPage({ tabId: TAB });
    first.page.resolve({ available: false, error: "No page" });
    await settled();
    expect(domHealthPhase(first.store.getState())).toBe("failed");

    const second = harness();
    second.deps.checkPage.mockRejectedValueOnce(new Error("port closed"));
    second.store.checkPage({ tabId: TAB });
    await settled();
    expect(second.store.getState().pageOutcome).toEqual({
      available: false,
      error: "Error: port closed",
    });
  });

  it("starts nothing while a check runs or DOM config holds the tab", () => {
    const { store, deps } = harness();
    store.checkPage({ tabId: TAB });
    expect(store.auditApplication({ tabId: TAB })).toBe("busy");

    const other = harness();
    releaseTabLock(TAB, "dom-health");
    acquireTabLock(TAB, "dom-config");
    expect(other.store.checkPage({ tabId: TAB })).toBe("locked");
    expect(other.deps.checkPage).not.toHaveBeenCalled();
    expect(deps.auditApplication).not.toHaveBeenCalled();
  });

  it("stops the application audit through its signal and keeps what it reached", async () => {
    const { store, app, options } = harness();
    store.setDiscoveryMode("application-deep");
    store.auditApplication({ tabId: TAB, ignoredRoots: ["tag:chat"] });
    expect(options()).toMatchObject({
      discoveryMode: "application-deep",
      ignoredRoots: ["tag:chat"],
    });

    options()?.onProgress?.({
      phase: "auditing",
      url: "https://app.example.com/a",
      pageIndex: 1,
      pagesQueued: 3,
    });
    expect(store.getState().progress).toMatchObject({ pageIndex: 1 });

    store.stop();
    expect(options()?.signal?.aborted).toBe(true);
    expect(store.getState()).toMatchObject({
      running: "application",
      stopping: true,
    });

    app.resolve({ available: true, stopped: true, score: 70 } as never);
    await settled();
    expect(store.getState()).toMatchObject({
      running: null,
      stopping: false,
      progress: null,
      scope: "application",
      appOutcome: { stopped: true, score: 70 },
    });
  });

  it("keeps the page result when the application audit runs after it", async () => {
    const { store, page, app } = harness();
    store.checkPage({ tabId: TAB });
    page.resolve({ available: true, score: 80 } as never);
    await settled();
    store.auditApplication({ tabId: TAB });
    app.resolve({ available: true, score: 60 } as never);
    await settled();

    expect(store.getState().pageOutcome).toMatchObject({ score: 80 });
    expect(store.getState().appOutcome).toMatchObject({ score: 60 });
    store.setScope("page");
    expect(store.getState().scope).toBe("page");
  });
});
