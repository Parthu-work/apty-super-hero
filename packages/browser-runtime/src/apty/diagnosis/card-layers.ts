import type { KbLayer } from "@apty/agent-core";
import type { RuleId } from "./types.js";

type RuleFamily = RuleId extends `${infer Family}-${string}` ? Family : never;

/**
 * Which layer of its KB card a cause reads (KB-RAG K5): 1 the settings in
 * Studio and Admin, 2 the page and its elements (Console and Elements), 3
 * the network data. A rule takes its family's layer unless it is listed
 * below; a new family does not compile until it is given one.
 */
const FAMILY_LAYER: Record<RuleFamily, KbLayer> = {
  CNV: 1,
  WNV: 1,
  W4X: 1,
  C4X: 1,
  LOG: 3,
  SEL: 2,
  DOM: 2,
  DAP: 1,
};

const RULE_LAYER: Partial<Record<RuleId, KbLayer>> = {
  // rule.json lacks the segments' rules: data, not a setting.
  "CNV-08": 3,
  // app-urls.json is empty or failed its schema check.
  "WNV-01": 3,
  // No environment's URL pattern matches: the patterns are Admin settings.
  "LOG-01": 1,
  "LOG-03": 1,
  // A 4.x cause citing a file's mirror card reads that card's network data.
  "W4X-00": 3,
  "W4X-01": 3,
  "W4X-03": 3,
  "C4X-00": 3,
  "C4X-01": 3,
  "C4X-05": 3,
  "C4X-06": 3,
  // A CSP block is read in the page's Console.
  "LOG-04": 2,
};

export function cardLayerOf(ruleId: RuleId): KbLayer {
  return (
    RULE_LAYER[ruleId] ?? FAMILY_LAYER[ruleId.slice(0, 3) as RuleFamily] ?? 1
  );
}
