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
