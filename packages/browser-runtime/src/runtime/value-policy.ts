import type { RedactionMode } from "@apty/debug-contract";
import type { ValuePolicy } from "@apty/dom-snapshot";
import { currentRedactionMode } from "./redaction-mode.js";

/**
 * What the page-reading tools say about typed or chosen values in each redaction mode.
 * @internal
 */
export function valuePolicyForMode(mode: RedactionMode): ValuePolicy {
  if (mode === "strict") return "withhold";
  if (mode === "standard") return "mask";
  return "show";
}

export function currentValuePolicy(): ValuePolicy {
  return valuePolicyForMode(currentRedactionMode());
}
