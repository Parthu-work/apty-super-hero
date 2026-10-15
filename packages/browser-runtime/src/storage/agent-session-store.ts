import { IndexedDBStorage } from "./indexeddb-storage.js";

/**
 * The agent's own session history (raw tool outputs, before the outbound
 * filter). Every deletion path for conversations must reach it too.
 */
export const AGENT_SESSION_DB = {
  dbName: "aipex-sessions",
  storeName: "sessions",
} as const;

interface StoredSession {
  id: string;
  parentSessionId?: string;
}

let store: IndexedDBStorage<StoredSession> | null = null;

function sessions(): IndexedDBStorage<StoredSession> {
  store ??= new IndexedDBStorage<StoredSession>(AGENT_SESSION_DB);
  return store;
}

/** Delete these sessions and every session forked from them. */
export async function deleteAgentSessions(
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const all = await sessions().listAll();
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
  await Promise.all([...doomed].map((id) => sessions().delete(id)));
}

export async function clearAgentSessions(): Promise<void> {
  await sessions().clear();
}
