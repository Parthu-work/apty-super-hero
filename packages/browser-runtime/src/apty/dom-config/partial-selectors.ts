/**
 * Partial Selector conditions: for an attribute whose values change from
 * load to load in one part and tell elements apart in another, the
 * pattern that keeps only the part that tells them apart. Apty runs each
 * row's regex on the value and keeps capture group 1 (else the whole
 * match); it then matches that part with `^=`, `$=` or `*=` by where it
 * sat, and the part bypasses every ignore rule
 * (`partial-selector-conditions.ts`, `pattern.ts`).
 *
 * The engine reads it from the runs of each page. A value is split into
 * digit runs, letter runs and single other characters. Values of one
 * attribute with the same sequence of token kinds and punctuation form a
 * shape. Within a shape:
 *
 * - a digit run is dynamic when two runs hold values identical but for
 *   that digit run, i.e. the same element reloaded with a new number;
 * - a letter run is constant when every value holds the same letters
 *   there, and tells elements apart otherwise.
 *
 * A pattern is written when some digit run is dynamic, some letter run
 * tells elements apart, and no dynamic digit run sits between the first
 * and last letter run that does: that span is the part to keep. Constant
 * letters are page data, so they must pass the D3 identifier check, as in
 * an ignore rule; the kept part never appears in the pattern.
 */

import { fnv1a } from "@apty/dom-snapshot";
import { type AnalyzedPage, recordKindOf } from "./classify.js";
import { DOM_CONFIG_LIMITS } from "./limits.js";
import { escapeRegexLiteral } from "./regex.js";
import {
  compareText,
  isSafeLiteral,
  piiShapeOf,
  sortedUnique,
} from "./text.js";
import type { PartialSelectorRule } from "./types.js";

/** `partial-selector-conditions.ts`: the attribute names Apty accepts on save. */
const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

const MAX_PARTIAL_RULES = 50;

type TokenKind = "digit" | "word" | "other";

interface Token {
  kind: TokenKind;
  text: string;
}

const TOKEN = /\d+|[A-Za-z]+|[\s\S]/g;

function tokenize(value: string): Token[] {
  return (value.match(TOKEN) ?? []).map((text) => ({
    kind: /^\d/.test(text)
      ? "digit"
      : /^[A-Za-z]/.test(text)
        ? "word"
        : "other",
    text,
  }));
}

/** Kinds, with punctuation spelled out: values of one shape align token by token. */
function shapeOf(tokens: Token[]): string {
  return tokens
    .map((t) => (t.kind === "other" ? `o${t.text}` : t.kind[0]))
    .join("\u0000");
}

/** Everything but the digit runs: the same key in two runs is the same element with new numbers. */
function wordKeyOf(tokens: Token[]): string {
  return tokens.map((t) => (t.kind === "digit" ? "#" : t.text)).join("\u0000");
}

const SKIPPED_NAMES = new Set(["class", "style", "value"]);

function eligibleValues(page: AnalyzedPage, name: string): Array<Set<string>> {
  return page.diff.eligible.map(
    (index) => new Set(page.runs[index]!.attributes.get(name)?.keys() ?? []),
  );
}

interface ShapeValues {
  tokens: Token[];
  value: string;
  run: number;
}

interface Candidate {
  attribute: string;
  pattern: string;
  keeps: PartialSelectorRule["keeps"];
  pages: Set<string>;
  values: Set<string>;
  parts: Set<string>;
}

function patternFor(
  members: ShapeValues[],
): { pattern: string; keeps: PartialSelectorRule["keeps"] } | null {
  const length = members[0]!.tokens.length;
  const byWordKey = new Map<string, Map<number, string>>();
  for (const member of members) {
    const key = wordKeyOf(member.tokens);
    const runs = byWordKey.get(key) ?? new Map<number, string>();
    runs.set(member.run, member.value);
    byWordKey.set(key, runs);
  }
  if (byWordKey.size < 2) return null;

  const dynamic = new Set<number>();
  for (const runs of byWordKey.values()) {
    if (runs.size < 2) continue;
    const versions = [...runs.values()].map(tokenize);
    for (let i = 0; i < length; i++) {
      if (versions[0]![i]!.kind !== "digit") continue;
      if (versions.some((v) => v[i]!.text !== versions[0]![i]!.text)) {
        dynamic.add(i);
      }
    }
  }
  if (dynamic.size === 0) return null;

  const varying: number[] = [];
  for (let i = 0; i < length; i++) {
    const token = members[0]!.tokens[i]!;
    if (token.kind !== "word") continue;
    if (members.some((m) => m.tokens[i]!.text !== token.text)) varying.push(i);
  }
  if (varying.length === 0) return null;
  const first = varying[0]!;
  const last = varying[varying.length - 1]!;
  for (const i of dynamic) {
    if (i > first && i < last) return null;
  }

  // The kept part reaches out to the nearest changing number on each
  // side: a longer part is a narrower `^=` / `$=` / `*=` condition.
  const lo = Math.max(-1, ...[...dynamic].filter((i) => i < first));
  const hiCandidates = [...dynamic].filter((i) => i > last);
  const hi = hiCandidates.length ? Math.min(...hiCandidates) : length;
  const before = literalPattern(members[0]!.tokens.slice(0, lo + 1));
  const after = literalPattern(members[0]!.tokens.slice(hi));
  if (before === null || after === null) return null;
  const keeps: PartialSelectorRule["keeps"] =
    before && after ? "middle" : before ? "end" : "start";
  const capture = after ? "(.+?)" : "(.+)";
  const pattern = `^${before}${capture}${after}$`;
  return pattern.length <= DOM_CONFIG_LIMITS.maxRegexLength
    ? { pattern, keeps }
    : null;
}

/**
 * Tokens outside the kept part as a pattern: numbers as `\d+` (they
 * changed, or are the same for every element), the text between them
 * escaped. That text is page data, so each stretch of it must pass the
 * D3 identifier check, or there is no pattern.
 */
function literalPattern(tokens: Token[]): string | null {
  let out = "";
  let text = "";
  const flush = () => {
    if (text && !isSafeLiteral(text)) return false;
    out += escapeRegexLiteral(text);
    text = "";
    return true;
  };
  for (const token of tokens) {
    if (token.kind === "digit") {
      if (!flush()) return null;
      out += "\\d+";
    } else {
      text += token.text;
    }
  }
  return flush() ? out : null;
}

function keptPart(pattern: RegExp, value: string): string | null {
  const match = value.match(pattern);
  return match ? (typeof match[1] === "string" ? match[1] : match[0]) : null;
}

/** The partial selector rules the captured pages support, deduplicated across pages. */
export function derivePartialSelectors(
  pages: AnalyzedPage[],
): PartialSelectorRule[] {
  const candidates = new Map<string, Candidate>();
  const stable = new Map<string, Set<string>>();
  for (const page of pages) {
    for (const item of page.classified.items) {
      if (item.bucket !== "stable" || !item.verified) continue;
      const set = stable.get(item.name) ?? new Set<string>();
      set.add(item.value);
      stable.set(item.name, set);
    }
  }

  for (const page of pages) {
    if (page.diff.eligible.length < 2) continue;
    const changedNames = [...page.diff.changed.keys()].filter(
      (name) => !SKIPPED_NAMES.has(name) && VALID_KEY.test(name),
    );
    for (const name of sortedUnique(changedNames)) {
      const changed = page.diff.changed.get(name)!;
      const shapes = new Map<string, ShapeValues[]>();
      eligibleValues(page, name).forEach((values, run) => {
        for (const value of values) {
          if (piiShapeOf(value)) continue;
          const tokens = tokenize(value);
          const shape = shapeOf(tokens);
          const list = shapes.get(shape) ?? [];
          list.push({ tokens, value, run });
          shapes.set(shape, list);
        }
      });
      for (const members of shapes.values()) {
        if (!members.some((m) => changed.has(m.value))) continue;
        const found = patternFor(members);
        if (!found) continue;
        const regex = new RegExp(found.pattern);
        const parts = new Map<string, string>();
        let consistent = true;
        for (const member of members) {
          const part = keptPart(regex, member.value);
          const key = wordKeyOf(member.tokens);
          if (part === null || (parts.has(key) && parts.get(key) !== part)) {
            consistent = false;
            break;
          }
          parts.set(key, part);
        }
        if (!consistent || new Set(parts.values()).size < parts.size) continue;
        const id = `${name}\u0000${found.pattern}`;
        const candidate = candidates.get(id) ?? {
          attribute: name,
          pattern: found.pattern,
          keeps: found.keeps,
          pages: new Set<string>(),
          values: new Set<string>(),
          parts: new Set<string>(),
        };
        candidate.pages.add(page.pageId);
        for (const member of members) candidate.values.add(member.value);
        for (const part of parts.values()) candidate.parts.add(part);
        candidates.set(id, candidate);
      }
    }
  }

  return [...candidates.values()]
    .map((c) => {
      const regex = new RegExp(c.pattern);
      const stableMatches = [...(stable.get(c.attribute) ?? [])].filter(
        (value) => regex.test(value),
      ).length;
      const examples = sortedUnique(c.values)
        .filter((v) => isSafeLiteral(v) && !recordKindOf(v))
        .slice(0, DOM_CONFIG_LIMITS.maxExamples);
      const exampleParts = sortedUnique(c.parts)
        .filter(isSafeLiteral)
        .slice(0, DOM_CONFIG_LIMITS.maxExamples);
      const where =
        c.keeps === "end"
          ? "ends with"
          : c.keeps === "start"
            ? "starts with"
            : "contains";
      return {
        id: `p-${fnv1a(JSON.stringify([c.attribute, c.pattern]))}`,
        attribute: c.attribute,
        pattern: c.pattern,
        keeps: c.keeps,
        reason: `Values of ${c.attribute} changed between runs of the same page in their numbers, while another part told the elements apart. Apty keeps that part, and the selector says the value ${where} it.${
          stableMatches
            ? ` The pattern also fits ${stableMatches} value(s) that stayed the same; on those, Apty matches part of the value instead of all of it.`
            : ""
        }`,
        pages: sortedUnique(c.pages),
        coveredValueCount: c.values.size,
        elementCount: c.parts.size,
        exampleValues: examples,
        exampleParts,
        stableMatches,
      };
    })
    .sort(
      (a, b) =>
        compareText(a.attribute, b.attribute) ||
        b.pattern.length - a.pattern.length ||
        compareText(a.pattern, b.pattern),
    )
    .slice(0, MAX_PARTIAL_RULES);
}
