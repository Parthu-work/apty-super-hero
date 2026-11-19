/**
 * One question per turn (KB-RAG K28, F5): a model reply that ends by asking
 * the user several questions shows the first and folds the rest under a
 * disclosure. Nothing is deleted: `shown` and `folded` together are the
 * reply. Questions inside code, block quotes or quotation marks do not
 * count. No model call.
 */

export interface FoldedQuestions {
  /** The reply up to and including its first question. */
  shown: string;
  /** The rest of the reply, from the second question on. */
  folded: string;
  /** How many questions are folded. */
  count: number;
}

const FENCE = /^\s*(```|~~~)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const QUOTE_LINE = /^\s*>/;

/** Inline code and quoted spans, blanked to spaces so their "?" is ignored. */
function masked(text: string): string {
  return text.replace(
    /`[^`\n]*`|"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|(?<!\w)'[^'\n]*'(?!\w)/g,
    (span) => " ".repeat(span.length),
  );
}

interface Block {
  start: number;
  end: number;
  code: boolean;
}

/** The reply's paragraphs, lists and code blocks, as offsets into it. */
function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  let offset = 0;
  let current: Block | undefined;
  let inFence = false;
  for (const line of text.split("\n")) {
    const lineEnd = offset + line.length;
    const fence = FENCE.test(line);
    if (inFence) {
      if (current) current.end = lineEnd;
      if (fence) {
        inFence = false;
        current = undefined;
      }
    } else if (fence) {
      current = { start: offset, end: lineEnd, code: true };
      blocks.push(current);
      inFence = true;
    } else if (line.trim() === "") {
      current = undefined;
    } else if (current && !current.code) {
      current.end = lineEnd;
    } else {
      current = {
        start: offset,
        end: lineEnd,
        code: QUOTE_LINE.test(line),
      };
      blocks.push(current);
    }
    offset = lineEnd + 1;
  }
  return blocks;
}

/** Where each question in `block` ends: after its "?", or its list item's end. */
function questionEnds(text: string, block: Block): number[] {
  const body = masked(text.slice(block.start, block.end));
  const lines = body.split("\n");
  const ends: number[] = [];
  let offset = block.start;
  const isList = lines.some((line) => LIST_ITEM.test(line));
  for (const line of lines) {
    if (QUOTE_LINE.test(line)) return [];
    if (isList) {
      if (LIST_ITEM.test(line) && line.trimEnd().endsWith("?")) {
        ends.push(offset + line.trimEnd().length);
      }
    } else {
      for (const match of line.matchAll(/\?+(?=\s|$)/g)) {
        ends.push(offset + (match.index ?? 0) + match[0].length);
      }
    }
    offset += line.length + 1;
  }
  return ends;
}

/** The reply split at its second question to the user, or undefined when it asks one or none. */
export function foldQuestions(reply: string): FoldedQuestions | undefined {
  const last = blocksOf(reply).at(-1);
  if (!last || last.code) return undefined;
  const ends = questionEnds(reply, last);
  if (ends.length < 2) return undefined;
  const cut = ends[0] as number;
  const shown = reply.slice(0, cut);
  const folded = reply.slice(cut).replace(/^[ \t]*\n?/, "");
  return { shown, folded, count: ends.length - 1 };
}
