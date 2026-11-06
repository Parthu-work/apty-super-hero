import {
  describeKbPack,
  type KbImportResult,
  type KbPack,
  type KbPackInfo,
  parseKbPack,
  type Sha256Hex,
} from "@apty/agent-core";
import { KB_DB } from "./database-names.js";

/**
 * The one KB pack this browser holds (KB-RAG K3). The pack body stays in
 * IndexedDB on the extension's origin, not chrome.storage.local, because it
 * can be megabytes; a small `meta` record next to it answers "what is
 * loaded" without reading the body.
 */
export interface KbPackStore {
  info(): Promise<KbPackInfo | null>;
  load(): Promise<KbPack | null>;
  /** Validates the file's text and, if it passes, replaces the loaded pack. */
  replace(text: string): Promise<KbImportResult>;
  remove(): Promise<void>;
}

/**
 * The three operations the store needs from a key-value database.
 * @internal exported for tests, which use an in-memory one.
 */
export interface KbRecords {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

const META = "meta";
const PACK = "pack";
const STORE = "records";

/** @internal exported for tests. */
export const webCryptoSha256: Sha256Hex = async (text) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** `KbRecords` on an IndexedDB database with one object store, opened on first use. */
function indexedDbRecords(dbName?: string, factory?: IDBFactory): KbRecords {
  let opened: Promise<IDBDatabase> | undefined;
  const db = () => {
    opened ??= new Promise((resolve, reject) => {
      const open = (factory ?? indexedDB).open(dbName ?? KB_DB, 1);
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
  const store = async (mode: IDBTransactionMode) =>
    (await db()).transaction(STORE, mode).objectStore(STORE);
  return {
    get: async <T>(key: string) =>
      (await request((await store("readonly")).get(key))) as T | undefined,
    put: async (key, value) => {
      await request((await store("readwrite")).put(value, key));
    },
    delete: async (key) => {
      await request((await store("readwrite")).delete(key));
    },
  };
}

export function createKbPackStore({
  records = indexedDbRecords(),
  sha256 = webCryptoSha256,
  now = () => new Date(),
}: {
  records?: KbRecords;
  sha256?: Sha256Hex;
  now?: () => Date;
} = {}): KbPackStore {
  return {
    info: async () => (await records.get<KbPackInfo>(META)) ?? null,
    async load() {
      const [meta, pack] = await Promise.all([
        records.get<KbPackInfo>(META),
        records.get<KbPack>(PACK),
      ]);
      // A replace that stopped between its two writes leaves them apart.
      return meta && pack && meta.sha256 === pack.sha256 ? pack : null;
    },
    async replace(text) {
      const parsed = await parseKbPack(text, { sha256 });
      if (!parsed.ok) return { ok: false, code: parsed.code };
      const info = describeKbPack(parsed.pack, now().toISOString());
      await records.put(PACK, parsed.pack);
      await records.put(META, info);
      return { ok: true, info };
    },
    async remove() {
      await records.delete(META);
      await records.delete(PACK);
    },
  };
}
