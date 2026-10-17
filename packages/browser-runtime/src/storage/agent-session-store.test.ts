import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: new Map<string, { id: string; parentSessionId?: string }>(),
}));

vi.mock("./indexeddb-storage.js", () => ({
  IndexedDBStorage: class {
    listAll = async () => [...db.values()];
    delete = async (id: string) => {
      db.delete(id);
    };
    clear = async () => db.clear();
  },
}));

import { clearAgentSessions, deleteAgentSessions } from "./agent-session-store";

function put(id: string, parentSessionId?: string) {
  db.set(id, { id, parentSessionId });
}

describe("agent session store", () => {
  beforeEach(() => db.clear());

  it("deletes the named sessions and every session forked from them", async () => {
    put("a");
    put("a-fork", "a");
    put("a-fork-fork", "a-fork");
    put("b");
    put("b-fork", "b");

    await deleteAgentSessions(["a"]);

    expect([...db.keys()].sort()).toEqual(["b", "b-fork"]);
  });

  it("does nothing for an empty list", async () => {
    put("a");
    await deleteAgentSessions([]);
    expect([...db.keys()]).toEqual(["a"]);
  });

  it("clears every session", async () => {
    put("a");
    put("b");
    await clearAgentSessions();
    expect(db.size).toBe(0);
  });
});
