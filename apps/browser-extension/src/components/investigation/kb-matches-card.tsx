/**
 * The KB cards a search_kb result found (KB-RAG K6): each card's title as
 * a link to its Confluence page, the best layer's text, its "Verified on"
 * line and a Not verified badge. Shown for the chat's own answer to a
 * symptom no check pack claims, and for the model's search_kb calls. The
 * card text is rendered as text.
 */
import { kbCardUrl } from "@apty/agent-core";
import type { KbToolResult } from "@apty/browser-runtime/kb/kb-index";
import { StatusBadge } from "@apty/ui/components/ui/badge";
import { useTranslation } from "@apty/ui/i18n/context";
import type { ToolDisplaySlotProps } from "@apty/ui/types";
import { ExternalLinkIcon } from "lucide-react";

const CITE = /^kb:\/\/(\d+)#L([1-4])$/;
const EXCERPT_CHARS = 280;

/** A search_kb result with cards to show; anything else keeps the default display. */
export function isKbMatches(output: unknown): output is KbToolResult {
  const result = output as Partial<KbToolResult> | null;
  return (
    typeof result === "object" &&
    result !== null &&
    result.status === "ok" &&
    Array.isArray(result.results) &&
    result.results.length > 0 &&
    result.results.every((hit) => CITE.test(String(hit?.cite)))
  );
}

function excerpt(text: string): string {
  if (text.length <= EXCERPT_CHARS) return text;
  const cut = text.slice(0, EXCERPT_CHARS);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : EXCERPT_CHARS)}…`;
}

export function KbMatchesCard({ tool }: ToolDisplaySlotProps) {
  const { t } = useTranslation();
  if (!isKbMatches(tool.output)) return null;
  const title = t("kbMatches.title");
  return (
    <section
      aria-label={title}
      className="space-y-2 rounded-lg border border-border bg-card p-3"
    >
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <ul className="space-y-2">
        {tool.output.results.map((hit) => {
          const [, pageId = "", layer = ""] = CITE.exec(hit.cite) ?? [];
          return (
            <li
              key={hit.cite}
              className="space-y-1 rounded-md border border-border p-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={kbCardUrl(pageId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {hit.title}
                  <ExternalLinkIcon aria-hidden="true" className="size-3" />
                </a>
                {hit.notVerified && (
                  <StatusBadge tone="warning">
                    {t("checkPack.kbCard.notVerified")}
                  </StatusBadge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("kbMatches.layer", { layer })}
              </p>
              <p className="whitespace-pre-line text-sm text-foreground">
                {excerpt(hit.text)}
              </p>
              {hit.verifiedOn && (
                <p className="text-xs text-muted-foreground">
                  {hit.verifiedOn}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        {t("kbMatches.provenance")}
      </p>
    </section>
  );
}
