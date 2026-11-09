/**
 * A generic Apty vocabulary for KB search: words a user and a card may use
 * for the same thing. No card text: a pack can add its own groups
 * (`retrieval.synonyms`, `kb:pack --synonyms`). A term matched only through
 * a synonym weighs 0.8 in ranking and in coverage.
 */
export const KB_SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["balloon", "tooltip", "popup", "pop-up", "bubble", "hint"],
  ["workflow", "walkthrough", "guide", "flow", "tour"],
  ["reload", "refresh", "f5"],
  ["production", "prod", "live"],
  ["test", "uat", "staging", "qa", "sandbox"],
  ["freeze", "hang", "unresponsive", "stuck"],
  ["crash", "tab crashed", "out of memory"],
  ["slow", "sluggish", "lag", "laggy", "performance"],
  ["disappear", "vanish", "missing", "gone"],
  ["repeat", "again", "keeps coming back", "every time", "each login"],
  [
    "language",
    "translated",
    "translation",
    "locale",
    "french",
    "german",
    "spanish",
    "italian",
    "portuguese",
    "dutch",
    "japanese",
    "chinese",
    "korean",
    "arabic",
    "hindi",
  ],
  ["split step", "decision step", "branch", "condition"],
  ["launcher", "button", "icon", "beacon"],
  ["segment", "audience", "user group", "targeting"],
  ["publish", "release", "go live", "deploy content"],
  ["selector", "xpath", "css", "locator"],
  ["csp", "content-security-policy", "nonce"],
  ["cors", "cross-origin"],
  ["iframe", "frame", "embedded"],
  ["shadow dom", "shadow root", "lwc"],
  ["skip", "jump", "starts at step"],
];

/** The weight of a term matched only through a synonym. */
export const SYNONYM_MATCH = 0.8;
