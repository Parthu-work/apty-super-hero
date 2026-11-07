import { kbCardUrl } from "@apty/agent-core";

const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/;
const LINKED = /\]\(kb:\/\/(\d+)#L([1-4])\)/g;
const BARE = /(?<![[/\w])kb:\/\/(\d+)#L([1-4])\b/g;

export type KbCitationLabel = (pageId: string, layer: string) => string;

const asWritten: KbCitationLabel = (pageId, layer) =>
  `kb://${pageId}#L${layer}`;

/**
 * The answer's `kb://<pageId>#L<layer>` citations as Markdown links to the
 * card's Confluence page (KB-RAG K4), a bare one labelled by `label`. Code
 * is left as written. The sanitizer drops any link that is not http(s), so
 * the citation is turned into one before the Markdown is rendered.
 */
export function linkKbCitations(
  markdown: string,
  label: KbCitationLabel = asWritten,
): string {
  if (!markdown.includes("kb://")) return markdown;
  return markdown
    .split(CODE)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(LINKED, (_, pageId: string) => `](${kbCardUrl(pageId)})`)
            .replace(
              BARE,
              (_, pageId: string, layer: string) =>
                `[${label(pageId, layer)}](${kbCardUrl(pageId)})`,
            ),
    )
    .join("");
}
