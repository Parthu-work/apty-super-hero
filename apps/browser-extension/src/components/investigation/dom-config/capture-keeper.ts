/**
 * The held DOM Config capture, kept on the device so an SE can close the
 * panel and come back (KB-RAG K26, C1, D-DOM1; this changes D12, memory
 * only). What is kept is exactly what the panel held: the capture the engine
 * built (its redaction and identifier checks already applied), the crawl's
 * own result and the SE's coverage marks; nothing is added. It is deleted
 * after the policy's `domConfigRetentionDays` (30 by default) and by Discard
 * capture or Clear results.
 */
import { domConfigRetentionDays, type OrgPolicyState } from "@apty/agent-core";
import type { DomConfigApplicationCapture } from "@apty/browser-runtime/apty/dom-config/index";
import { loadOrgPolicy } from "@apty/browser-runtime/runtime/org-policy";
import { DOM_CONFIG_DB } from "@apty/browser-runtime/storage/database-names";
import {
  indexedDbRecords,
  type KbRecords,
} from "@apty/browser-runtime/storage/kb-store";
import type {
  CompletedCapture,
  CoverageMarks,
  DomConfigStartOptions,
} from "./dom-config-store";

export interface KeptCapture {
  savedAt: string;
  capture: DomConfigApplicationCapture;
  outcome: CompletedCapture | null;
  coverageMarks: CoverageMarks;
  crawlMs: number | null;
  crawlOptions: DomConfigStartOptions | null;
}

export interface CaptureKeeper {
  save(kept: Omit<KeptCapture, "savedAt">): Promise<void>;
  /** The kept capture, or undefined when there is none or it is past its retention (then deleted). */
  load(): Promise<KeptCapture | undefined>;
  discard(): Promise<void>;
}

const KEY = "held";
const DAY_MS = 86_400_000;

/** A keeper that keeps nothing: where IndexedDB is missing. */
const NO_KEEPER: CaptureKeeper = {
  save: async () => undefined,
  load: async () => undefined,
  discard: async () => undefined,
};

/** @internal exported for tests, which give it records in memory. */
export function createCaptureKeeper({
  records,
  now = () => new Date(),
  policy = loadOrgPolicy,
}: {
  records: KbRecords;
  now?: () => Date;
  policy?: () => Promise<OrgPolicyState>;
}): CaptureKeeper {
  const discard = () => records.moveAll([], [KEY]);
  return {
    async save(kept) {
      await records.putAll([
        [KEY, { ...kept, savedAt: now().toISOString() } satisfies KeptCapture],
      ]);
    },
    async load() {
      const kept = await records.get<KeptCapture>(KEY);
      if (!kept) return undefined;
      const days = domConfigRetentionDays(await policy());
      if (now().getTime() - Date.parse(kept.savedAt) > days * DAY_MS) {
        await discard();
        return undefined;
      }
      return kept;
    },
    discard,
  };
}

/** This browser's keeper, in its own IndexedDB database. */
export function browserCaptureKeeper(): CaptureKeeper {
  if (typeof indexedDB === "undefined") return NO_KEEPER;
  return createCaptureKeeper({ records: indexedDbRecords(DOM_CONFIG_DB) });
}
