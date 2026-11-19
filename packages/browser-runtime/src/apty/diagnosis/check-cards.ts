/**
 * K27, E5: from a KB card to the check that reads its symptom. Each check
 * pack's own card (the one its result cites when no rule names another) is
 * mapped to that pack, so a KB answer whose top card is one of them can
 * offer "Run the check". Ids only; the card's text is never read here.
 */
import type { RunCheckRequest } from "@apty/agent-core";
import {
  WIDGET_MISSING_EVERYWHERE,
  WORKFLOW_NOT_IN_WIDGET,
} from "./cards-4x.js";
import { CARD_PAGE_ID } from "./content-not-visible.js";
import { SELECTOR_CARD } from "./element-not-found.js";
import { PAGE_CARD } from "./page-readiness.js";
import { contentKindOf } from "./router.js";
import { WIDGET_CARD } from "./widget-not-visible.js";

type CardCheck =
  | "content-not-visible"
  | "widget-not-visible"
  | "page-readiness"
  | "element-not-found";

const CARD_CHECKS: ReadonlyMap<string, CardCheck> = new Map([
  [CARD_PAGE_ID, "content-not-visible"],
  [WORKFLOW_NOT_IN_WIDGET, "content-not-visible"],
  [WIDGET_CARD, "widget-not-visible"],
  [WIDGET_MISSING_EVERYWHERE, "widget-not-visible"],
  [PAGE_CARD, "page-readiness"],
  [SELECTOR_CARD, "element-not-found"],
]);

/** The check a card's symptom belongs to, for the SE's question; undefined when no check reads it. */
export function checkForCard(
  pageId: string,
  question: string,
): RunCheckRequest | undefined {
  const packId = CARD_CHECKS.get(pageId);
  if (!packId) return undefined;
  const kind = contentKindOf(question);
  if (packId === "content-not-visible") {
    return { packId, kind: kind ?? "workflow" };
  }
  if (packId === "element-not-found") {
    return kind ? { packId, kind } : undefined;
  }
  return { packId };
}
