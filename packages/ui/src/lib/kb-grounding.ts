/**
 * Checks an answer against the KB chunks its turn's search_kb calls
 * returned (KB-RAG K18): the setting-like phrases it names (quoted, or two
 * or more Title Case words) that no returned chunk holds. Deterministic,
 * no model call, and it never changes the answer's text: the side panel
 * underlines the phrases and lists them under the answer.
 */
import { kbContainsPhrase, kbTerms, namedPhrases } from "@apty/agent-core";

const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;
const MARKDOWN_LINK = /\[([^\]\n]*)\]\([^)\n]*\)/g;
const CITATION = /kb:\/\/\d+(?:#L[1-4])?/g;
const HEADING_MARK = /^#{1,6}\s+/gm;

const TITLE_WORDS = "[A-Z][\\w-]*(?: [A-Z][\\w-]*)*";
/** A menu path such as "Admin Portal → Applications → Settings" (K27, F2). */
const MENU_PATH = new RegExp(
  `${TITLE_WORDS}(?:\\s*(?:→|->|›|>|»)\\s*${TITLE_WORDS})+`,
  "g",
);
const PATH_SEPARATOR = /\s*(?:→|->|›|>|»)\s*/g;

/**
 * The menu paths and setting-like phrases an answer names (quoted, or two
 * or more Title Case words) that no chunk holds. With no chunks, as on a
 * model turn the KB returned no card for, every one is named.
 */
export function ungroundedPhrases(
  answer: string,
  chunks: readonly string[],
): string[] {
  if (!answer.trim()) return [];
  const prose = answer
    .replace(CODE, " . ")
    .replace(MARKDOWN_LINK, "$1")
    .replace(CITATION, " ")
    .replace(HEADING_MARK, "");
  const chunkTerms = chunks.map(kbTerms);
  const held = (phrase: string) =>
    chunkTerms.some((terms) => kbContainsPhrase(terms, phrase));
  // A path is grounded when a chunk holds each step; a step's first word
  // may be the sentence's verb ("Open Studio").
  const stepHeld = (step: string) =>
    held(step) || held(step.split(" ").slice(1).join(" "));
  const allPaths = [...prose.matchAll(MENU_PATH)].map((match) => match[0]);
  const paths = allPaths.filter(
    (path) => !path.split(PATH_SEPARATOR).every(stepHeld),
  );
  const pathWords = allPaths.map((path) =>
    path.replace(PATH_SEPARATOR, " ").toLowerCase(),
  );
  const phrases = namedPhrases(prose, { everyRun: true }).filter(
    (phrase) =>
      !held(phrase) &&
      !pathWords.some((words) => words.includes(phrase.toLowerCase())),
  );
  return [...new Set([...paths, ...phrases])];
}

const SKIPPED = "code, pre, a, [data-kb-ungrounded]";

/**
 * Wraps each occurrence of `phrases` in the rendered answer with a dotted
 * underline and `title`, outside code and links. The text stays as it was;
 * running it again changes nothing.
 */
export function markUngrounded(
  root: HTMLElement,
  phrases: readonly string[],
  title: string,
): void {
  if (phrases.length === 0) return;
  const lower = phrases.map((phrase) => phrase.toLowerCase());
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest(SKIPPED)) texts.push(node as Text);
  }
  for (const text of texts) {
    let node: Text | null = text;
    while (node) {
      const value = node.data.toLowerCase();
      let at = -1;
      let length = 0;
      lower.forEach((phrase) => {
        const found = value.indexOf(phrase);
        if (found !== -1 && (at === -1 || found < at)) {
          at = found;
          length = phrase.length;
        }
      });
      if (at === -1) break;
      const match = node.splitText(at);
      const rest = match.splitText(length);
      const mark = root.ownerDocument.createElement("span");
      mark.dataset.kbUngrounded = "";
      mark.title = title;
      mark.className = "underline decoration-dotted underline-offset-2";
      match.replaceWith(mark);
      mark.append(match);
      node = rest;
    }
  }
}
