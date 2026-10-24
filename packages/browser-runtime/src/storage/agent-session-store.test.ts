import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: new Map<
    string,
    {
      id: string;
      parentSessionId?: string;
      metadata?: { lastActiveAt?: number };
    }
  >(),
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

import {
  clearAgentSessions,
  deleteAgentSessions,
  deleteOrphanAgentSessions,
} from "./agent-session-store";

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

describe("orphan agent sessions", () => {
  beforeEach(() => db.clear());

  const HOUR = 60 * 60 * 1000;
  const NOW = 100 * 24 * HOUR;
  function session(id: string, ageHours: number, parentSessionId?: string) {
    db.set(id, {
      id,
      parentSessionId,
      metadata: { lastActiveAt: NOW - ageHours * HOUR },
    });
  }

  it("deletes old sessions no saved conversation points to, keeping forks of kept ones and anything recent", async () => {
    session("kept", 72);
    session("kept-fork", 72, "kept");
    session("orphan", 48);
    session("orphan-fork", 30, "orphan");
    session("in-progress", 0.5);

    const deleted = await deleteOrphanAgentSessions(new Set(["kept"]), {
      now: NOW,
    });

    expect(deleted.sort()).toEqual(["orphan", "orphan-fork"]);
    expect([...db.keys()].sort()).toEqual(["in-progress", "kept", "kept-fork"]);
  });

  it("keeps a session with no timestamp rather than guess its age", async () => {
    db.set("old", { id: "old" });

    expect(await deleteOrphanAgentSessions(new Set(), { now: NOW })).toEqual(
      [],
    );
  });
});
