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
  urlOf: (pageId: string) => string | undefined = () => undefined,
): string {
  if (!markdown.includes("kb://")) return markdown;
  const link = (pageId: string) => urlOf(pageId) ?? kbCardUrl(pageId);
  return markdown
    .split(CODE)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(LINKED, (_, pageId: string) => `](${link(pageId)})`)
            .replace(
              BARE,
              (_, pageId: string, layer: string) =>
                `[${label(pageId, layer)}](${link(pageId)})`,
            ),
    )
    .join("");
}

/** What a turn's search_kb calls returned: each card's link, and the chunk text the answer may rest on. */
export interface KbReturnedCards {
  /** Whether the turn called search_kb at all. */
  searched: boolean;
  urls: Map<string, string>;
  texts: string[];
}

const CITE_PAGE = /^kb:\/\/(\d+)/;

type Part = {
  type: string;
  toolName?: string;
  output?: unknown;
  text?: string;
};
type Returned = {
  cite?: unknown;
  site?: unknown;
  space?: unknown;
  text?: unknown;
};

export function kbReturnedCards(parts: readonly Part[]): KbReturnedCards {
  const urls = new Map<string, string>();
  const texts: string[] = [];
  let searched = false;
  const keep = (item: Returned | undefined) => {
    const pageId = CITE_PAGE.exec(String(item?.cite ?? ""))?.[1];
    if (pageId) {
      urls.set(
        pageId,
        kbCardUrl(pageId, {
          site: String(item?.site ?? ""),
          space: String(item?.space ?? ""),
        }),
      );
    }
    if (typeof item?.text === "string") texts.push(item.text);
  };
  for (const part of parts) {
    if (part.type !== "tool" || part.toolName !== "search_kb") continue;
    searched = true;
    const output = part.output as
      | { results?: Returned[]; stub?: Returned }
      | undefined;
    for (const item of output?.results ?? []) keep(item);
    if (output?.stub) keep({ ...output.stub, text: undefined });
  }
  return { searched, urls, texts };
}
