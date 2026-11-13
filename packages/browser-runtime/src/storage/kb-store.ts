import {
  describeKbPack,
  KB_APTY_VERSIONS,
  type KbAptyVersion,
  type KbImportResult,
  type KbPack,
  type KbPackInfo,
  type KbReplaceStop,
  parseKbPack,
  type Sha256Hex,
} from "@apty/agent-core";
import {
  type KbPackAssessor,
  type KbPackState,
  sharedKbPackAssessor,
  withUsability,
} from "../kb/kb-trust.js";
import { KB_DB } from "./database-names.js";

/**
 * The KB packs this browser holds, one per Apty version (KB-RAG K3, K12).
 * Each pack body stays in IndexedDB on the extension's origin, not
 * chrome.storage.local, because it can be megabytes; a small
 * `meta:<version>` record next to `pack:<version>` answers "what is loaded"
 * without reading the body.
 */
export interface KbPackStore {
  /** The loaded packs, in version order (4.x, 5.x, common), each with whether it is used, judged now (K23 P4). */
  info(): Promise<KbPackState[]>;
  load(version: KbAptyVersion): Promise<KbPack | null>;
  /**
   * Validates the file's text, its signature against the current trust and
   * its dates (K23 P4) and, if it passes, replaces the loaded pack of the
   * file's own version. A refused file keeps the loaded pack.
   */
  replace(text: string, options?: KbReplaceOptions): Promise<KbImportResult>;
  remove(version: KbAptyVersion): Promise<void>;
}

/** What a fetched pack must also pass before it is stored (KB-RAG K26, D-DEL6). */
export interface KbReplaceOptions {
  /** Checked after parsing and before trust, against the stored pack of the same version, if any. */
  guard?(
    incoming: KbPackInfo,
    stored: KbPackInfo | undefined,
  ): KbReplaceStop | undefined;
}

/**
 * The operations the store needs from a key-value database. `putAll` and
 * `moveAll` write all or nothing, in one read-write transaction (K21 F8),
 * so a stop between two writes never leaves a pack without its meta.
 * @internal exported for tests, which use an in-memory one.
 */
export interface KbRecords {
  get<T>(key: string): Promise<T | undefined>;
  putAll(entries: ReadonlyArray<readonly [string, unknown]>): Promise<void>;
  moveAll(
    puts: ReadonlyArray<readonly [string, unknown]>,
    deletes: readonly string[],
  ): Promise<void>;
}

/** The keys of the one pack an earlier version of the Agent stored, always 5.x. */
const LEGACY_META = "meta";
const LEGACY_PACK = "pack";
const meta = (version: KbAptyVersion) => `meta:${version}`;
const pack = (version: KbAptyVersion) => `pack:${version}`;
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

/**
 * `KbRecords` on an IndexedDB database with one object store, opened on first use.
 * @internal exported for tests, which pass an in-memory IndexedDB factory.
 */
export function indexedDbRecords(
  dbName?: string,
  factory?: IDBFactory,
): KbRecords {
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
  /** Every put and delete in one read-write transaction: resolves on complete, rejects on error or abort. */
  const writeAll = async (
    puts: ReadonlyArray<readonly [string, unknown]>,
    deletes: readonly string[],
  ) => {
    const transaction = (await db()).transaction(STORE, "readwrite");
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("The KB write was aborted."));
    });
    const store = transaction.objectStore(STORE);
    try {
      for (const [key, value] of puts) store.put(value, key);
      for (const key of deletes) store.delete(key);
    } catch (error) {
      transaction.abort();
      await done.catch(() => undefined);
      throw error;
    }
    await done;
  };
  return {
    get: async <T>(key: string) =>
      (await request(
        (await db()).transaction(STORE, "readonly").objectStore(STORE).get(key),
      )) as T | undefined,
    putAll: (entries) => writeAll(entries, []),
    moveAll: (puts, deletes) => writeAll(puts, deletes),
  };
}

/** Why an import is refused, from a pack's usability (K23 P4): the P1 codes. */
function refusalOf(
  state: KbPackState["usability"],
): KbImportResult | undefined {
  if (state.usable) return undefined;
  const trust = state.trust.status;
  if (trust === "unsigned" && state.reason === "unsigned") {
    return { ok: false, code: "unsigned" };
  }
  if (
    trust === "untrusted_key" ||
    trust === "revoked_key" ||
    trust === "bad_signature"
  ) {
    return { ok: false, code: trust };
  }
  if (state.reason === "expired" || state.reason === "not_yet_valid") {
    const date = state.validity.date;
    return { ok: false, code: state.reason, ...(date ? { date } : {}) };
  }
  return { ok: false, code: "untrusted_key" };
}

export function createKbPackStore({
  records = indexedDbRecords(),
  sha256 = webCryptoSha256,
  now = () => new Date(),
  assess = sharedKbPackAssessor(),
}: {
  records?: KbRecords;
  sha256?: Sha256Hex;
  now?: () => Date;
  /** Whether a pack is used: the managed policy's trust and the clock by default. */
  assess?: KbPackAssessor;
} = {}): KbPackStore {
  /**
   * Moves the earlier single pack to the 5.x keys, once, in one
   * transaction: the 5.x pair is written and the old keys go together, or
   * nothing changes and the legacy pack stays loadable.
   */
  let migrated: Promise<void> | undefined;
  const migrate = () => {
    migrated ??= (async () => {
      const [oldMeta, oldPack] = await Promise.all([
        records.get<Omit<KbPackInfo, "aptyVersion" | "stubCount">>(LEGACY_META),
        records.get<KbPack>(LEGACY_PACK),
      ]);
      if (oldMeta === undefined && oldPack === undefined) return;
      const puts: Array<readonly [string, unknown]> =
        oldMeta && oldPack && oldMeta.sha256 === oldPack.sha256
          ? [
              [
                pack("5.x"),
                {
                  ...oldPack,
                  cards: oldPack.cards.map((card) => ({
                    ...card,
                    status: card.status ?? "full",
                    symptom: card.symptom ?? null,
                  })),
                },
              ],
              [
                meta("5.x"),
                {
                  ...oldMeta,
                  aptyVersion: "5.x",
                  stubCount: 0,
                } satisfies KbPackInfo,
              ],
            ]
          : [];
      await records.moveAll(puts, [LEGACY_META, LEGACY_PACK]);
    })().catch((error) => {
      migrated = undefined;
      throw error;
    });
    return migrated;
  };

  return {
    async info() {
      await migrate();
      const all = await Promise.all(
        KB_APTY_VERSIONS.map((version) =>
          records.get<KbPackInfo>(meta(version)),
        ),
      );
      return withUsability(
        all.filter((info): info is KbPackInfo => info !== undefined),
        assess,
      );
    },
    async load(version) {
      await migrate();
      const [info, body] = await Promise.all([
        records.get<KbPackInfo>(meta(version)),
        records.get<KbPack>(pack(version)),
      ]);
      // Written together; the check still refuses a pair that disagrees.
      return info && body && info.sha256 === body.sha256 ? body : null;
    },
    async replace(text, options = {}) {
      await migrate();
      const parsed = await parseKbPack(text, { sha256 });
      if (!parsed.ok) return { ok: false, code: parsed.code };
      const info = describeKbPack(parsed.pack, now().toISOString());
      if (options.guard) {
        const stored = await records.get<KbPackInfo>(meta(info.aptyVersion));
        const stop = options.guard(info, stored);
        if (stop) return { ok: false, code: stop };
      }
      let refusal: KbImportResult | undefined;
      try {
        refusal = refusalOf(await assess(info));
      } catch {
        refusal = { ok: false, code: "bad_signature" };
      }
      if (refusal) return refusal;
      await records.putAll([
        [pack(info.aptyVersion), parsed.pack],
        [meta(info.aptyVersion), info],
      ]);
      return { ok: true, info };
    },
    async remove(version) {
      await migrate();
      await records.moveAll([], [meta(version), pack(version)]);
    },
  };
}
