/**
 * KB-RAG K29, B3: a content file named in a question already says the
 * tenant's Apty version (the K13 markers). The 4.x player reads flow.json,
 * a flow-<id>.json per flow, segments.json and rules.json; the 5.x player
 * reads workflow.json, a workflow-<id>.json per workflow, segment.json and
 * rule.json. Each has its other version's counterpart.
 */

export type NamedFileKind =
  | "workflows"
  | "workflowSteps"
  | "segments"
  | "rules";

export interface NamedFileVersion {
  /** The file as the question names it, lower-cased. */
  file: string;
  version: "4.x" | "5.x";
  /** The other version's file for the same thing. */
  counterpart: string;
  kind: NamedFileKind;
}

interface FileRule {
  pattern: RegExp;
  version: "4.x" | "5.x";
  counterpart: string;
  kind: NamedFileKind;
}

const RULES: readonly FileRule[] = [
  {
    pattern: /(?<![\w-])flows?\.json\b/i,
    version: "4.x",
    counterpart: "workflow.json",
    kind: "workflows",
  },
  {
    pattern: /(?<![\w-])flow-[\w-]+\.json\b/i,
    version: "4.x",
    counterpart: "workflow-<id>.json",
    kind: "workflowSteps",
  },
  {
    pattern: /(?<![\w-])segments\.json\b/i,
    version: "4.x",
    counterpart: "segment.json",
    kind: "segments",
  },
  {
    pattern: /(?<![\w-])rules\.json\b/i,
    version: "4.x",
    counterpart: "rule.json",
    kind: "rules",
  },
  {
    pattern: /(?<![\w-])workflow\.json\b/i,
    version: "5.x",
    counterpart: "flow.json",
    kind: "workflows",
  },
  {
    pattern: /(?<![\w-])workflow-[\w-]+\.json\b/i,
    version: "5.x",
    counterpart: "flow-<id>.json",
    kind: "workflowSteps",
  },
  {
    pattern: /(?<![\w-])segment\.json\b/i,
    version: "5.x",
    counterpart: "segments.json",
    kind: "segments",
  },
  {
    pattern: /(?<![\w-])rule\.json\b/i,
    version: "5.x",
    counterpart: "rules.json",
    kind: "rules",
  },
];

/**
 * The version the question's content file names, with the first such file;
 * undefined when it names none, or files of both versions.
 */
export function namedFileVersion(text: string): NamedFileVersion | undefined {
  const found = RULES.flatMap((rule) => {
    const match = rule.pattern.exec(text);
    return match ? [{ rule, match }] : [];
  }).sort((a, b) => a.match.index - b.match.index);
  const [first] = found;
  if (!first || found.some(({ rule }) => rule.version !== first.rule.version)) {
    return undefined;
  }
  return {
    file: first.match[0].toLowerCase(),
    version: first.rule.version,
    counterpart: first.rule.counterpart,
    kind: first.rule.kind,
  };
}
