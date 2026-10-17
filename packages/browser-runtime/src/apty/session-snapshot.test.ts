import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sessionStore: Record<string, unknown> = {};

beforeEach(() => {
  sessionStore = {};
  vi.resetModules();
  (global as any).chrome = {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: sessionStore[key] }),
        set: async (items: Record<string, unknown>) => {
          sessionStore = { ...sessionStore, ...structuredClone(items) };
        },
      },
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
});

/** A fresh module instance, as after a side-panel reload or worker restart. */
async function freshEvidenceStore() {
  vi.resetModules();
  const store = await import("./evidence-store");
  await store.evidenceRestored;
  return store;
}

function networkEvidence(timestamp: number, body: string) {
  return {
    conversationId: "conv-1",
    source: "service-worker" as const,
    type: "network-response" as const,
    timestamp,
    tabId: null,
    requestId: `req-${timestamp}`,
    data: { resourceName: `r${timestamp}`, body },
  };
}

describe("evidence persistence", () => {
  it("restores evidence after a reload", async () => {
    vi.useFakeTimers();
    const before = await freshEvidenceStore();
    const recorded = before.recordEvidence(networkEvidence(1, "{}") as any);
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();

    const after = await freshEvidenceStore();

    expect(after.getEvidence("conv-1").map((e) => e.evidenceId)).toEqual([
      recorded.evidenceId,
    ]);
  });

  it("keeps de-duplication working after a restore", async () => {
    vi.useFakeTimers();
    const before = await freshEvidenceStore();
    before.recordEvidence(networkEvidence(1, "{}") as any);
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();

    const after = await freshEvidenceStore();
    after.recordEvidence(networkEvidence(1, "{}") as any);

    expect(after.getEvidence("conv-1")).toHaveLength(1);
  });

  it("drops the oldest bodies first when over the persistence budget", async () => {
    const store = await freshEvidenceStore();
    store.recordEvidence(networkEvidence(1, "a".repeat(1000)) as any);
    store.recordEvidence(networkEvidence(2, "b".repeat(1000)) as any);

    const [[, persisted]] = store.serializeEvidence(1800) as any;

    expect(persisted.list[0].data).toEqual({
      resourceName: "r1",
      bodyDropped: true,
    });
    expect(persisted.list[1].data.body).toBe("b".repeat(1000));
    expect(
      (store.getEvidence("conv-1")[0]?.data as { body: string }).body,
    ).toHaveLength(1000);
  });
});

describe("investigation persistence", () => {
  it("restores an active investigation after a reload", async () => {
    vi.useFakeTimers();
    const before = await import("./investigation-session");
    await before.investigationsRestored;
    before.startInvestigation({
      conversationId: "conv-1",
      userProblem: "widget missing",
    } as any);
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();

    vi.resetModules();
    const after = await import("./investigation-session");
    await after.investigationsRestored;

    expect(after.getInvestigation("conv-1")?.userProblem).toBe(
      "widget missing",
    );
  });
});

describe("createSessionSnapshot", () => {
  it("keeps the side panel's and the service worker's state apart", async () => {
    const { createSessionSnapshot } = await import("./session-snapshot");
    const panel = createSessionSnapshot("k", () => ["panel"], vi.fn(), "page");
    const worker = createSessionSnapshot(
      "k",
      () => ["worker"],
      vi.fn(),
      "worker",
    );
    await panel.flush();
    await worker.flush();

    const restoredPanel = vi.fn();
    await createSessionSnapshot("k", () => [], restoredPanel, "page").ready;
    const restoredWorker = vi.fn();
    await createSessionSnapshot("k", () => [], restoredWorker, "worker").ready;

    expect(restoredPanel).toHaveBeenCalledWith(["panel"]);
    expect(restoredWorker).toHaveBeenCalledWith(["worker"]);
  });

  it("reports a failed write with a code and the key, never the content", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    (
      globalThis as unknown as {
        chrome: { storage: { session: { set: () => Promise<void> } } };
      }
    ).chrome.storage.session.set = async () => {
      throw new Error("QUOTA_BYTES quota exceeded");
    };
    const { createSessionSnapshot } = await import("./session-snapshot");
    const snapshot = createSessionSnapshot(
      "apty_evidence_store",
      () => ({ body: "PATIENT-SECRET" }),
      vi.fn(),
      "page",
    );

    await expect(snapshot.flush()).resolves.toBe("failed");
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("session_snapshot_write_failed");
    expect(logged).toContain("apty_evidence_store");
    expect(logged).not.toContain("PATIENT-SECRET");
    expect(logged).not.toContain("quota exceeded");
    warn.mockRestore();
  });
});
