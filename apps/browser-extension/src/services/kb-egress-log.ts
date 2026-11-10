/**
 * The record of KB text sent to an AI model (KB-RAG K22, S7, D-SEC6): one
 * entry per model request that left with KB card text, holding when, where
 * (provider, origin, model), which cards and layers, which packs, and
 * whether it was the chat or the summary request. Never the text, the
 * question or the answer. Kept in the extension's IndexedDB (not
 * apty-kb-db) for the policy's `auditRetentionDays` (30 by default), pruned
 * on every write and at start-up. Under an organization policy it cannot be
 * cleared.
 */
import {
  type AiDestination,
  auditRetentionDays,
  type KbCardRef,
  type KbPackInfo,
  type OrgPolicyState,
} from "@apty/agent-core";
import { loadOrgPolicy } from "@apty/browser-runtime/runtime/org-policy";
import { KB_EGRESS_DB } from "@apty/browser-runtime/storage/database-names";

export interface KbEgressRecord {
  /** ISO time the request left. */
  at: string;
  request: "chat" | "summary";
  provider: string;
  origin?: string;
  model?: string;
  cards: KbCardRef[];
  packs: { aptyVersion: string; sha256: string }[];
}

/** What the outbound filter reports for a request that carries KB text. */
export interface KbEgressSent {
  purpose: "chat" | "summary";
  destination?: AiDestination;
  cards: KbCardRef[];
  packs: KbPackInfo[];
}

/** Where the records live: one list under one key. Tests use memory. */
export interface KbEgressRecords {
  read(): Promise<KbEgressRecord[]>;
  write(records: KbEgressRecord[]): Promise<void>;
}

export interface KbEgressLog {
  append(sent: KbEgressSent): Promise<void>;
  prune(): Promise<void>;
  list(): Promise<KbEgressRecord[]>;
  /** How many requests carried KB text in the last `days` days. */
  countSince(days: number): Promise<number>;
  exportJson(): Promise<string>;
  /** Whether the SE may clear the record: not under a policy. */
  clearAllowed(): Promise<boolean>;
  /** Refused under an organization policy. */
  clear(): Promise<void>;
}

const DAY_MS = 86_400_000;
const STORE = "records";
const KEY = "log";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function indexedDbRecords(): KbEgressRecords {
  let opened: Promise<IDBDatabase> | undefined;
  const db = () => {
    opened ??= new Promise((resolve, reject) => {
      const open = indexedDB.open(KB_EGRESS_DB, 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(STORE)) {
          open.result.createObjectStore(STORE);
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
  return {
    async read() {
      const store = (await db()).transaction(STORE).objectStore(STORE);
      return ((await request(store.get(KEY))) as KbEgressRecord[]) ?? [];
    },
    async write(records) {
      const store = (await db())
        .transaction(STORE, "readwrite")
        .objectStore(STORE);
      await request(store.put(records, KEY));
    },
  };
}

/** One record of `sent`: ids, layers, packs and the destination; no text. */
export function kbEgressRecordOf(sent: KbEgressSent, at: Date): KbEgressRecord {
  const { destination } = sent;
  return {
    at: at.toISOString(),
    request: sent.purpose,
    provider: destination?.provider ?? "unknown",
    ...(destination?.origin ? { origin: destination.origin } : {}),
    ...(destination?.model ? { model: destination.model } : {}),
    cards: sent.cards.map(({ pageId, layer }) => ({
      pageId,
      ...(layer ? { layer } : {}),
    })),
    packs: sent.packs.map(({ aptyVersion, sha256 }) => ({
      aptyVersion,
      sha256,
    })),
  };
}

export function createKbEgressLog({
  records = indexedDbRecords(),
  now = () => new Date(),
  policy = loadOrgPolicy,
}: {
  records?: KbEgressRecords;
  now?: () => Date;
  policy?: () => Promise<OrgPolicyState>;
} = {}): KbEgressLog {
  const kept = async (list: KbEgressRecord[]) => {
    const days = auditRetentionDays(await policy());
    const oldest = now().getTime() - days * DAY_MS;
    return list.filter((record) => Date.parse(record.at) >= oldest);
  };
  return {
    async append(sent) {
      const list = await kept(await records.read());
      list.push(kbEgressRecordOf(sent, now()));
      await records.write(list);
    },
    async prune() {
      const list = await records.read();
      const left = await kept(list);
      if (left.length !== list.length) await records.write(left);
    },
    list: () => records.read(),
    async countSince(days) {
      const since = now().getTime() - days * DAY_MS;
      return (await records.read()).filter(
        (record) => Date.parse(record.at) >= since,
      ).length;
    },
    async exportJson() {
      return JSON.stringify(
        { schema: "apty-kb-egress/1", records: await records.read() },
        null,
        2,
      );
    },
    async clearAllowed() {
      return (await policy()).kind === "none";
    },
    async clear() {
      if ((await policy()).kind !== "none") {
        throw new Error("The record is kept by your organization's policy.");
      }
      await records.write([]);
    },
  };
}

let shared: KbEgressLog | undefined;

/** This browser's record. */
export function kbEgressLog(): KbEgressLog {
  shared ??= createKbEgressLog();
  return shared;
}
