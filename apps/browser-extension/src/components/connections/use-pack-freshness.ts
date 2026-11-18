/**
 * The loaded packs, delivery's records and the packs the SE has seen, read
 * again whenever a pack is imported, delivered or removed (KB-RAG K27, E9).
 */
import type { KbPackState } from "@apty/agent-core";
import { readKbSyncRecords } from "@apty/browser-runtime/kb/kb-pack-sync";
import { indexedDbRecords } from "@apty/browser-runtime/storage/kb-store";
import { useCallback, useEffect, useState } from "react";
import { kbPackStore } from "../../services/kb-pack";
import {
  type DeliveredPack,
  deliveredPacks,
  type PackHeaderItem,
  packHeaderItems,
  type SeenPacks,
} from "./pack-freshness";

/** The SE's "Got it" on the banner, per version: the pack's sha256. */
const SEEN_KEY = "apty_kb_pack_seen";
/** Written by every import, delivery and removal (effective-settings). */
const PACKS_CHANGED_KEY = "apty_kb_packs_changed";

let records: ReturnType<typeof indexedDbRecords> | undefined;

async function readFreshness(): Promise<{
  states: KbPackState[];
  delivered: (seen: SeenPacks) => DeliveredPack[];
  seen: SeenPacks;
}> {
  records ??= indexedDbRecords();
  const [states, kept, stored] = await Promise.all([
    kbPackStore().info(),
    readKbSyncRecords(records).catch(() => ({})),
    Promise.resolve(globalThis.chrome?.storage?.local?.get(SEEN_KEY)).catch(
      () => undefined,
    ),
  ]);
  return {
    states,
    delivered: (seen) => deliveredPacks(states, kept, seen),
    seen: (stored?.[SEEN_KEY] as SeenPacks | undefined) ?? {},
  };
}

export interface PackFreshness {
  /** Undefined until the packs are read. */
  items: PackHeaderItem[] | undefined;
  delivered: DeliveredPack[];
  dismiss: () => void;
}

export function usePackFreshness(): PackFreshness {
  const [items, setItems] = useState<PackHeaderItem[] | undefined>();
  const [delivered, setDelivered] = useState<DeliveredPack[]>([]);
  const [seen, setSeen] = useState<SeenPacks>({});

  useEffect(() => {
    let live = true;
    const read = () =>
      readFreshness()
        .then((fresh) => {
          if (!live) return;
          setItems(packHeaderItems(fresh.states));
          setSeen(fresh.seen);
          setDelivered(fresh.delivered(fresh.seen));
        })
        .catch(() => live && setItems([]));
    void read();
    const onChanged = globalThis.chrome?.storage?.onChanged;
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (
        area === "local" &&
        (PACKS_CHANGED_KEY in changes || SEEN_KEY in changes)
      ) {
        void read();
      }
    };
    onChanged?.addListener(listener);
    return () => {
      live = false;
      onChanged?.removeListener(listener);
    };
  }, []);

  const dismiss = useCallback(() => {
    const next = { ...seen };
    for (const pack of delivered) next[pack.version] = pack.sha256;
    setSeen(next);
    setDelivered([]);
    void globalThis.chrome?.storage?.local?.set({ [SEEN_KEY]: next });
  }, [seen, delivered]);

  return { items, delivered, dismiss };
}
