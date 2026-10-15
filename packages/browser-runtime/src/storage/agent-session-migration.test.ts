import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; parentSessionId?: string; turns?: number };

const { dbs, failSaves } = vi.hoisted(() => ({
  dbs: new Map<string, Map<string, Row>>(),
  failSaves: { count: 0 },
}));

vi.mock("./indexeddb-storage.js", () => ({
  IndexedDBStorage: class {
    constructor(private config: { dbName: string }) {}
    private get rows(): Map<string, Row> {
      if (!dbs.has(this.config.dbName)) dbs.set(this.config.dbName, new Map());
      return dbs.get(this.config.dbName) as Map<string, Row>;
    }
    listAll = async () => [...this.rows.values()];
    load = async (id: string) => this.rows.get(id) ?? null;
    save = async (id: string, row: Row) => {
      if (failSaves.count > 0) {
        failSaves.count--;
        throw new Error("quota");
      }
      this.rows.set(id, { ...row, id });
    };
    delete = async (id: string) => {
      this.rows.delete(id);
    };
    clear = async () => this.rows.clear();
    close = async () => {};
  },
}));

import {
  AGENT_SESSION_DB,
  clearAgentSessions,
  deleteAgentSessions,
  LEGACY_AGENT_SESSION_DB,
  migrateLegacyAgentSessions,
} from "./agent-session-store";

const ops = {
  exists: async (name: string) => dbs.has(name),
  drop: async (name: string) => {
    dbs.delete(name);
  },
};

function seedLegacy(...rows: Row[]) {
  dbs.set(
    LEGACY_AGENT_SESSION_DB.dbName,
    new Map(rows.map((row) => [row.id, row])),
  );
}

const current = () => dbs.get(AGENT_SESSION_DB.dbName) ?? new Map();

describe("agent session database rename", () => {
  beforeEach(() => {
    dbs.clear();
    failSaves.count = 0;
  });

  it("is named apty-sessions now", () => {
    expect(AGENT_SESSION_DB.dbName).toBe("apty-sessions");
    expect(LEGACY_AGENT_SESSION_DB.dbName).toBe("aipex-sessions");
  });

  it("copies every session, then drops the old database", async () => {
    seedLegacy({ id: "a", turns: 3 }, { id: "a-fork", parentSessionId: "a" });

    expect(await migrateLegacyAgentSessions(ops)).toBe(2);

    expect([...current().keys()].sort()).toEqual(["a", "a-fork"]);
    expect(current().get("a")).toMatchObject({ turns: 3 });
    expect(dbs.has(LEGACY_AGENT_SESSION_DB.dbName)).toBe(false);
  });

  it("is idempotent, and keeps a session already copied", async () => {
    seedLegacy({ id: "a", turns: 1 });
    dbs.set(AGENT_SESSION_DB.dbName, new Map([["a", { id: "a", turns: 9 }]]));

    await migrateLegacyAgentSessions(ops);
    expect(await migrateLegacyAgentSessions(ops)).toBe(0);

    expect(current().get("a")).toMatchObject({ turns: 9 });
  });

  it("keeps the old database when a copy fails, and finishes on the next run", async () => {
    seedLegacy({ id: "a" }, { id: "b" });
    failSaves.count = 1;

    await expect(migrateLegacyAgentSessions(ops)).rejects.toThrow();
    expect(dbs.has(LEGACY_AGENT_SESSION_DB.dbName)).toBe(true);

    await migrateLegacyAgentSessions(ops);
    expect([...current().keys()].sort()).toEqual(["a", "b"]);
    expect(dbs.has(LEGACY_AGENT_SESSION_DB.dbName)).toBe(false);
  });

  it("deleting a conversation's sessions also reaches sessions not yet migrated", async () => {
    seedLegacy(
      { id: "a" },
      { id: "a-fork", parentSessionId: "a" },
      { id: "b" },
    );
    failSaves.count = 99;

    await deleteAgentSessions(["a"], ops);

    expect([
      ...(dbs.get(LEGACY_AGENT_SESSION_DB.dbName)?.keys() ?? []),
    ]).toEqual(["b"]);
  });

  it("clearing everything drops the old database too", async () => {
    seedLegacy({ id: "a" });
    failSaves.count = 99;

    await clearAgentSessions(ops);

    expect(dbs.has(LEGACY_AGENT_SESSION_DB.dbName)).toBe(false);
    expect(current().size).toBe(0);
  });
});
