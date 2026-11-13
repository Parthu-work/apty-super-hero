/**
 * Where cases and wrong-card feedback live (KB-RAG K25, L1, L3, D-CASE1):
 * the extension's IndexedDB `apty-cases-db`, stores `cases` and `feedback`,
 * on this device only. Nothing here is sent anywhere; an SE copies or
 * downloads what they choose after reviewing it.
 */
import {
  CASE_RETENTION_DAYS,
  type CaseRecord,
  caseExpired,
} from "@apty/agent-core";
import { CASES_DB } from "./database-names.js";

/** One wrong-card mark or closed case's answer, for the KB owner (L3): ids, numbers and codes. */
export interface FeedbackRow {
  id?: number;
  at: string;
  caseId?: string;
  aptyVersion?: string;
  /** The pack's build date and sha256 prefix. */
  packBuilt?: string;
  packSha256?: string;
  shownCardId?: string;
  shownLayer?: number;
  rightCardId?: string;
  outcome?: string;
  coverage?: number;
  reason?: string;
  note?: string;
  /** The SE's question, Strict-redacted; exported only when the SE ticks "Include my question". */
  question?: string;
}

type StoreName = "cases" | "feedback";

/** The operations the store needs; tests use the in-memory one. @internal */
export interface CaseRecords {
  all<T>(store: StoreName): Promise<T[]>;
  put(store: StoreName, value: unknown): Promise<void>;
  delete(store: StoreName, key: IDBValidKey): Promise<void>;
  clear(store: StoreName): Promise<void>;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** `CaseRecords` on IndexedDB. @internal exported for tests, which pass fake-indexeddb. */
export function indexedDbCaseRecords(
  factory?: IDBFactory,
  name = CASES_DB,
): CaseRecords {
  let opened: Promise<IDBDatabase> | undefined;
  const db = () => {
    opened ??= new Promise((resolve, reject) => {
      const open = (factory ?? indexedDB).open(name, 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("cases")) {
          open.result.createObjectStore("cases", { keyPath: "id" });
        }
        if (!open.result.objectStoreNames.contains("feedback")) {
          open.result.createObjectStore("feedback", {
            keyPath: "id",
            autoIncrement: true,
          });
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => {
        opened = undefined;
        reject(open.error);
      };
    });
    return opened;
  };
  const write = async (
    store: StoreName,
    act: (objects: IDBObjectStore) => void,
  ) => {
    const transaction = (await db()).transaction(store, "readwrite");
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("The case write was aborted."));
    });
    act(transaction.objectStore(store));
    await done;
  };
  return {
    all: async <T>(store: StoreName) =>
      (await request(
        (await db()).transaction(store, "readonly").objectStore(store).getAll(),
      )) as T[],
    put: (store, value) => write(store, (objects) => objects.put(value)),
    delete: (store, key) => write(store, (objects) => objects.delete(key)),
    clear: (store) => write(store, (objects) => objects.clear()),
  };
}

/** In-memory records, for tests. @internal */
export function memoryCaseRecords(): CaseRecords {
  const stores = { cases: new Map(), feedback: new Map() } as Record<
    StoreName,
    Map<IDBValidKey, unknown>
  >;
  let next = 1;
  return {
    all: async <T>(store: StoreName) =>
      [...stores[store].values()].map((v) => structuredClone(v)) as T[],
    put: async (store, value) => {
      const record = structuredClone(value) as { id?: IDBValidKey };
      if (store === "feedback" && record.id === undefined) record.id = next++;
      stores[store].set(record.id as IDBValidKey, record);
    },
    delete: async (store, key) => {
      stores[store].delete(key);
    },
    clear: async (store) => {
      stores[store].clear();
    },
  };
}

export interface CaseStore {
  list(): Promise<CaseRecord[]>;
  get(id: string): Promise<CaseRecord | undefined>;
  /** The conversation's newest case. */
  forConversation(conversationId: string): Promise<CaseRecord | undefined>;
  /** Stores the case, then deletes every case past the retention. */
  put(record: CaseRecord): Promise<void>;
  delete(id: string): Promise<void>;
  deleteAll(): Promise<void>;
  /** Deletes the cases past the retention; how many went. */
  prune(): Promise<number>;
  addFeedback(row: FeedbackRow): Promise<void>;
  feedback(): Promise<FeedbackRow[]>;
  clearFeedback(): Promise<void>;
}

export function createCaseStore({
  records = indexedDbCaseRecords(),
  now = () => new Date(),
  retentionDays = async () => CASE_RETENTION_DAYS.default,
}: {
  records?: CaseRecords;
  now?: () => Date;
  /** The policy's `caseRetentionDays`, read at each prune. */
  retentionDays?: () => Promise<number>;
} = {}): CaseStore {
  const newestFirst = (list: CaseRecord[]) =>
    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const prune = async () => {
    const days = await retentionDays();
    const old = (await records.all<CaseRecord>("cases")).filter((record) =>
      caseExpired(record, now(), days),
    );
    for (const record of old) await records.delete("cases", record.id);
    return old.length;
  };
  return {
    list: async () => newestFirst(await records.all<CaseRecord>("cases")),
    get: async (id) =>
      (await records.all<CaseRecord>("cases")).find((r) => r.id === id),
    forConversation: async (conversationId) =>
      newestFirst(
        (await records.all<CaseRecord>("cases")).filter(
          (r) => r.conversationId === conversationId,
        ),
      )[0],
    async put(record) {
      await records.put("cases", record);
      await prune();
    },
    delete: (id) => records.delete("cases", id),
    deleteAll: () => records.clear("cases"),
    prune,
    addFeedback: (row) => records.put("feedback", row),
    feedback: async () =>
      (await records.all<FeedbackRow>("feedback")).sort((a, b) =>
        a.at.localeCompare(b.at),
      ),
    clearFeedback: () => records.clear("feedback"),
  };
}
