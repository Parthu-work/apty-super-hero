/**
 * The loaded packs' cards by id, title and link (KB-RAG K27, E7): what the
 * Wrong card picker searches, the closest-card suggestions name and the
 * synonym proposals compare against. Read from this device's packs only.
 */
import type { KbPack, KbPackState } from "@apty/agent-core";
import type { KbPackStore } from "@apty/browser-runtime";
import { useEffect, useState } from "react";

export interface KbCardEntry {
  pageId: string;
  title: string;
  aptyVersion: string;
  url: string;
}

export interface KbCardCatalog {
  cards: KbCardEntry[];
  /** The card's title, symptom and layers; from `aptyVersion`'s pack when given. */
  text(pageId: string, aptyVersion?: string): string | undefined;
}

let cached: { key: string; catalog: Promise<KbCardCatalog> } | undefined;

function catalogOf(packs: KbPack[]): KbCardCatalog {
  const texts = new Map<string, string>();
  for (const pack of packs) {
    const layers = new Map<string, string[]>();
    for (const chunk of pack.chunks) {
      layers.set(chunk.pageId, [
        ...(layers.get(chunk.pageId) ?? []),
        chunk.text,
      ]);
    }
    for (const card of pack.cards) {
      texts.set(
        `${pack.aptyVersion}:${card.pageId}`,
        [card.title, card.symptom ?? "", ...(layers.get(card.pageId) ?? [])]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }
  return {
    cards: packs.flatMap((pack) =>
      pack.cards.map((card) => ({
        pageId: card.pageId,
        title: card.title,
        aptyVersion: pack.aptyVersion,
        url: card.url,
      })),
    ),
    text(pageId, aptyVersion) {
      if (aptyVersion) return texts.get(`${aptyVersion}:${pageId}`);
      return packs
        .map((pack) => texts.get(`${pack.aptyVersion}:${pageId}`))
        .find((text) => text !== undefined);
    },
  };
}

type CatalogStore = Pick<KbPackStore, "info" | "load">;

export async function loadKbCatalog(
  given?: CatalogStore,
): Promise<KbCardCatalog> {
  // Loaded on use: the pack store opens IndexedDB.
  const store: CatalogStore =
    given ?? (await import("./kb-pack")).kbPackStore();
  const infos: Array<Pick<KbPackState, "aptyVersion" | "sha256">> =
    await store.info();
  const key = infos.map((info) => info.sha256).join(",");
  if (cached?.key !== key) {
    const catalog = Promise.all(
      infos.map((info) => store.load(info.aptyVersion)),
    ).then((packs) =>
      catalogOf(packs.filter((pack): pack is KbPack => pack !== null)),
    );
    cached = { key, catalog };
    catalog.catch(() => {
      if (cached?.catalog === catalog) cached = undefined;
    });
  }
  return cached.catalog;
}

/** The catalog once loaded (empty when the packs cannot be read); nothing is read until `enabled`. */
export function useKbCatalog(enabled = true): KbCardCatalog | undefined {
  const [catalog, setCatalog] = useState<KbCardCatalog>();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    loadKbCatalog()
      .then((loaded) => live && setCatalog(loaded))
      .catch(() => live && setCatalog(catalogOf([])));
    return () => {
      live = false;
    };
  }, [enabled]);
  return catalog;
}
