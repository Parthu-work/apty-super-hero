import { createKbPackStore, type KbPackStore } from "@apty/browser-runtime";

let store: KbPackStore | undefined;

/** The KB pack this browser holds, in the extension origin's IndexedDB (KB-RAG K3). */
export function kbPackStore(): KbPackStore {
  store ??= createKbPackStore();
  return store;
}
