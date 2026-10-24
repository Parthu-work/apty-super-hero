import { IndexedDBStorage } from "./indexeddb-storage.js";

/**
 * The agent's own session history (raw tool outputs, before the outbound
 * filter). Every deletion path for conversations must reach it too.
 */
export const AGENT_SESSION_DB = {
  dbName: "apty-sessions",
  storeName: "sessions",
} as const;

/**
 * The same store under its upstream AIPex name, moved on first use.
 * @internal
 */
export const LEGACY_AGENT_SESSION_DB = {
  dbName: "aipex-sessions",
  storeName: "sessions",
} as const;

interface StoredSession {
  id: string;
  parentSessionId?: string;
  metadata?: { lastActiveAt?: unknown; createdAt?: unknown };
}

/** A session this long idle, with no saved conversation, is not a chat in progress. */
const ORPHAN_SESSION_AGE_MS = 24 * 60 * 60 * 1000;

/** Whole-database operations, swappable in tests. */
export interface SessionDbOps {
  exists: (dbName: string) => Promise<boolean>;
  drop: (dbName: string) => Promise<void>;
}

const browserDbOps: SessionDbOps = {
  exists: async (dbName) => {
    if (typeof indexedDB === "undefined" || !indexedDB.databases) return false;
    return (await indexedDB.databases()).some((db) => db.name === dbName);
  },
  drop: (dbName) =>
    new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }),
};

let store: IndexedDBStorage<StoredSession> | null = null;

function sessions(): IndexedDBStorage<StoredSession> {
  store ??= new IndexedDBStorage<StoredSession>(AGENT_SESSION_DB);
  return store;
}

/**
 * Copy every session from the legacy database, read each one back, then drop
 * the legacy database. A session already in the new database wins.
 * Idempotent; returns how many sessions the legacy database held.
 * @internal
 */
export async function migrateLegacyAgentSessions(
  ops: SessionDbOps = browserDbOps,
): Promise<number> {
  if (!(await ops.exists(LEGACY_AGENT_SESSION_DB.dbName))) return 0;
  const legacy = new IndexedDBStorage<StoredSession>(LEGACY_AGENT_SESSION_DB);
  let rows: StoredSession[];
  try {
    rows = await legacy.listAll();
    for (const row of rows) {
      if (!(await sessions().load(row.id))) await sessions().save(row.id, row);
    }
    for (const row of rows) {
      if (!(await sessions().load(row.id))) {
        throw new Error("agent_session_migration_verify_failed");
      }
    }
  } finally {
    // An open connection would block the drop here or in another context.
    await legacy.close();
  }
  await ops.drop(LEGACY_AGENT_SESSION_DB.dbName);
  return rows.length;
}

let migration: Promise<number> | null = null;

/** Runs the legacy-database move once per context; a failed run is retried on the next call. */
export function ensureAgentSessionsMigrated(
  ops: SessionDbOps = browserDbOps,
): Promise<number> {
  migration ??= migrateLegacyAgentSessions(ops).catch((error) => {
    migration = null;
    throw error;
  });
  return migration;
}

async function deleteWithForks(
  from: IndexedDBStorage<StoredSession>,
  ids: readonly string[],
): Promise<void> {
  const all = await from.listAll();
  const doomed = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of all) {
      if (
        s.parentSessionId &&
        doomed.has(s.parentSessionId) &&
        !doomed.has(s.id)
      ) {
        doomed.add(s.id);
        grew = true;
      }
    }
  }
  await Promise.all([...doomed].map((id) => from.delete(id)));
}

/**
 * Delete these sessions and every session forked from them, also from the
 * legacy database when it couldn't be moved yet.
 */
export async function deleteAgentSessions(
  ids: readonly string[],
  ops: SessionDbOps = browserDbOps,
): Promise<void> {
  if (ids.length === 0) return;
  migration = null;
  const moved = await ensureAgentSessionsMigrated(ops).then(
    () => true,
    () => false,
  );
  if (!moved && (await ops.exists(LEGACY_AGENT_SESSION_DB.dbName))) {
    const legacy = new IndexedDBStorage<StoredSession>(LEGACY_AGENT_SESSION_DB);
    try {
      await deleteWithForks(legacy, ids);
    } finally {
      await legacy.close();
    }
  }
  await deleteWithForks(sessions(), ids);
}

export async function clearAgentSessions(
  ops: SessionDbOps = browserDbOps,
): Promise<void> {
  if (await ops.exists(LEGACY_AGENT_SESSION_DB.dbName)) {
    await ops.drop(LEGACY_AGENT_SESSION_DB.dbName);
  }
  await sessions().clear();
}

function lastActive(session: StoredSession): number | undefined {
  const at = session.metadata?.lastActiveAt ?? session.metadata?.createdAt;
  return typeof at === "number" ? at : undefined;
}

/**
 * Delete sessions that no saved conversation leads to (by id or through the
 * session it was forked from) and that have been idle for
 * ORPHAN_SESSION_AGE_MS. A side panel closed without "New chat" leaves one.
 * Returns the deleted ids.
 */
export async function deleteOrphanAgentSessions(
  referenced: ReadonlySet<string>,
  {
    now = Date.now(),
    ops = browserDbOps,
  }: { now?: number; ops?: SessionDbOps } = {},
): Promise<string[]> {
  await ensureAgentSessionsMigrated(ops).catch(() => undefined);
  const all = await sessions().listAll();
  const byId = new Map(all.map((s) => [s.id, s]));
  const leadsToReferenced = (session: StoredSession): boolean => {
    const seen = new Set<string>();
    for (
      let current: StoredSession | undefined = session;
      current && !seen.has(current.id);
      current = current.parentSessionId
        ? byId.get(current.parentSessionId)
        : undefined
    ) {
      if (referenced.has(current.id)) return true;
      seen.add(current.id);
    }
    return false;
  };
  const orphans = all.filter((session) => {
    const at = lastActive(session);
    return (
      at !== undefined &&
      now - at >= ORPHAN_SESSION_AGE_MS &&
      !leadsToReferenced(session)
    );
  });
  await Promise.all(orphans.map((s) => sessions().delete(s.id)));
  return orphans.map((s) => s.id);
}
