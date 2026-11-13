/**
 * This browser's KB pack fetcher (KB-RAG K26, D2): the shared store, the KB
 * database's records, the managed policy, and the send record. Only the
 * background runs it; Options and Preflight ask the background by message.
 */
import {
  createKbPackSync,
  type KbPackSync,
  readKbSyncRecords,
} from "@apty/browser-runtime/kb/kb-pack-sync";
import { noteKbPacksChanged } from "@apty/browser-runtime/runtime/effective-settings";
import { loadOrgPolicy } from "@apty/browser-runtime/runtime/org-policy";
import { indexedDbRecords } from "@apty/browser-runtime/storage/kb-store";
import { kbEgressLog } from "./kb-egress-log";
import { kbPackStore } from "./kb-pack";

let records: ReturnType<typeof indexedDbRecords> | undefined;
const kbRecords = () => {
  records ??= indexedDbRecords();
  return records;
};

let shared: KbPackSync | undefined;

/** The fetcher, created on first use. */
export function kbPackSync(): KbPackSync {
  shared ??= createKbPackSync({
    store: kbPackStore(),
    records: kbRecords(),
    policy: loadOrgPolicy,
    record: (row) => kbEgressLog().appendPackFetch(row),
    onUpdated: noteKbPacksChanged,
  });
  return shared;
}

/** The last check of each sourced version, read from the KB database. */
export function kbSyncRecords() {
  return readKbSyncRecords(kbRecords());
}

/** The message Options and Preflight send for Check now. */
export const KB_PACK_SYNC_NOW = "kb-pack-sync-now";
