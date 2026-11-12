import { newCase } from "@apty/agent-core";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  createCaseStore,
  indexedDbCaseRecords,
  memoryCaseRecords,
} from "./case-store.js";

const NOW = new Date("2026-11-12T10:00:00.000Z");

describe("the case store (KB-RAG K25, L1)", () => {
  it("keeps cases per conversation, newest first, and deletes one or all", async () => {
    const store = createCaseStore({
      records: memoryCaseRecords(),
      now: () => NOW,
    });
    const a = { ...newCase("conv-a", NOW, { random: () => 0 }) };
    const b = {
      ...newCase("conv-b", NOW, { random: () => 0.5 }),
      updatedAt: "2026-11-12T11:00:00.000Z",
    };
    await store.put(a);
    await store.put(b);
    expect((await store.list()).map((c) => c.id)).toEqual([b.id, a.id]);
    expect((await store.forConversation("conv-a"))?.id).toBe(a.id);
    await store.delete(a.id);
    expect(await store.get(a.id)).toBeUndefined();
    await store.deleteAll();
    expect(await store.list()).toEqual([]);
  });

  it("deletes cases past the retention on every write, with the policy's days", async () => {
    let days = 90;
    const store = createCaseStore({
      records: memoryCaseRecords(),
      now: () => NOW,
      retentionDays: async () => days,
    });
    const old = {
      ...newCase("old", NOW, { random: () => 0.1 }),
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    await store.put(old);
    expect(await store.get(old.id)).toBeDefined();
    days = 30;
    await store.put(newCase("new", NOW, { random: () => 0.2 }));
    expect(await store.get(old.id)).toBeUndefined();
  });

  it("works on IndexedDB (fake-indexeddb): cases and feedback in apty-cases-db", async () => {
    const factory = new IDBFactory();
    const store = createCaseStore({
      records: indexedDbCaseRecords(factory),
      now: () => NOW,
    });
    const record = newCase("conv", NOW);
    await store.put(record);
    await store.addFeedback({
      at: NOW.toISOString(),
      caseId: record.id,
      shownCardId: "4001",
    });
    await store.addFeedback({
      at: "2026-11-12T11:00:00.000Z",
      shownCardId: "4002",
    });
    const reopened = createCaseStore({
      records: indexedDbCaseRecords(factory),
      now: () => NOW,
    });
    expect((await reopened.get(record.id))?.conversationId).toBe("conv");
    expect((await reopened.feedback()).map((f) => f.shownCardId)).toEqual([
      "4001",
      "4002",
    ]);
    await reopened.clearFeedback();
    expect(await reopened.feedback()).toEqual([]);
  });
});
