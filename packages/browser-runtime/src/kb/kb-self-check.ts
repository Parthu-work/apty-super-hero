/**
 * The self-check of a loaded pack for Options (KB-RAG K27, E9): the same
 * report as `pnpm kb:eval --self-check`, counts and page ids only, run once
 * per pack (by its sha256) since it searches every card's title.
 */
import {
  type KbAptyVersion,
  type KbSelfCheckSummary,
  kbSelfCheck,
  kbSelfCheckSummary,
} from "@apty/agent-core";
import type { KbPackStore } from "../storage/kb-store.js";

export function createKbSelfCheckRunner(
  store: Pick<KbPackStore, "load">,
): (version: KbAptyVersion) => Promise<KbSelfCheckSummary | null> {
  const done = new Map<string, KbSelfCheckSummary>();
  return async (version) => {
    const pack = await store.load(version);
    if (!pack) return null;
    const kept = done.get(pack.sha256);
    if (kept) return kept;
    const summary = kbSelfCheckSummary(kbSelfCheck(pack));
    done.set(pack.sha256, summary);
    return summary;
  };
}
