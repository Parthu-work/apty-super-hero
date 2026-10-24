import { IndexedDBStorage } from "./indexeddb-storage.js";

/**
 * The agent's own session history (raw tool outputs, before the outbound
 * filter). Every deletion path for conversations must reach it too.
 */
export const AGENT_SESSION_DB = {
  dbName: "apty-sessions",
  storeName: "sessions",
} as const;

interface StoredSession {
  id: string;
  parentSessionId?: string;
  metadata?: { lastActiveAt?: unknown; createdAt?: unknown };
}

/** A session this long idle, with no saved conversation, is not a chat in progress. */
const ORPHAN_SESSION_AGE_MS = 24 * 60 * 60 * 1000;

let store: IndexedDBStorage<StoredSession> | null = null;

function sessions(): IndexedDBStorage<StoredSession> {
  store ??= new IndexedDBStorage<StoredSession>(AGENT_SESSION_DB);
  return store;
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

/** Delete these sessions and every session forked from them. */
export async function deleteAgentSessions(
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await deleteWithForks(sessions(), ids);
}

export async function clearAgentSessions(): Promise<void> {
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
  { now = Date.now() }: { now?: number } = {},
): Promise<string[]> {
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
