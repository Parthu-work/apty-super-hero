/**
 * The KB cards a search_kb result found (KB-RAG K6): each card's title as
 * a link to its Confluence page, the best layer's text, its "Verified on"
 * line and a Not verified badge. Shown for the chat's own answer to a
 * symptom no check pack claims, and for the model's search_kb calls. The
 * card text is rendered as text.
 */
import { kbCardUrl } from "@apty/agent-core";
import type {
  KbTabVersion,
  KbToolResult,
} from "@apty/browser-runtime/kb/kb-index";
import {
  kbAnswerOf,
  localKbMatches,
} from "@apty/browser-runtime/kb/kb-matches";
import { StatusBadge } from "@apty/ui/components/ui/badge";
import { useTranslation } from "@apty/ui/i18n/context";
import type { ToolDisplaySlotProps } from "@apty/ui/types";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { KbEgressNote } from "./kb-egress-note";
import { KbVersionControl, useActiveSiteHost } from "./kb-version-control";

const CITE = /^kb:\/\/(\d+)#L([1-4])$/;
const EXCERPT_CHARS = 280;

const STUB_CITE = /^kb:\/\/(\d+)$/;

/** A search_kb result with a card not written yet. */
function isKbStub(result: Partial<KbToolResult>): boolean {
  return result.status === "stub" && STUB_CITE.test(String(result.stub?.cite));
}

/** A search_kb result with cards to show; anything else keeps the default display. */
export function isKbMatches(output: unknown): output is KbToolResult {
  const result = output as Partial<KbToolResult> | null;
  if (
    typeof result === "object" &&
    result !== null &&
    (isKbStub(result) ||
      result.status === "non_english" ||
      (result.status === "pack_unusable" && result.unusable !== undefined) ||
      (result.status === "not_in_version" &&
        STUB_CITE.test(String(result.absent?.cite))))
  ) {
    return true;
  }
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

const LINK_CLASS =
  "inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The search again for the version the user picked; undefined: not covered there. */
type Rerun = { version: KbTabVersion; result: KbToolResult | undefined };

export function KbMatchesCard({ tool }: ToolDisplaySlotProps) {
  const { t } = useTranslation();
  const host = useActiveSiteHost();
  const [rerun, setRerun] = useState<Rerun | undefined>();
  if (!isKbMatches(tool.output)) return null;
  const query = String((tool.input as { query?: unknown })?.query ?? "");
  const output = rerun ? rerun.result : tool.output;
  const title = t("kbMatches.title");
  const versionControl = query ? (
    <KbVersionControl
      host={host}
      onChange={(version) => {
        localKbMatches(query, undefined, { version, modelAvailable: true })
          .then((outcome) => setRerun({ version, result: kbAnswerOf(outcome) }))
          .catch(() => setRerun({ version, result: undefined }));
      }}
    />
  ) : null;
  if (!output) {
    return (
      <section
        aria-label={title}
        className="space-y-2 rounded-lg border border-border bg-card p-3"
      >
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="text-sm text-foreground">
          {t("kbMatches.noneForVersion", {
            version: rerun?.version === "unknown" ? "" : (rerun?.version ?? ""),
          })}
        </p>
        {versionControl}
      </section>
    );
  }
  const { stub } = output;
  if (output.status === "pack_unusable" && output.unusable) {
    const { reason, aptyVersion, date } = output.unusable;
    return (
      <section
        aria-label={title}
        className="rounded-lg border border-border bg-card p-3"
      >
        <p className="text-sm text-foreground" data-testid="kb-pack-unusable">
          {`${t(`turnDecision.packUnusable.${reason}`, {
            version: aptyVersion,
            date: date?.slice(0, 10) ?? "",
          })} ${t("kbMatches.askForNewPack")}`}
        </p>
      </section>
    );
  }
  if (output.status === "non_english") {
    return (
      <section
        aria-label={title}
        className="rounded-lg border border-border bg-card p-3"
      >
        <p className="text-sm text-foreground">{t("kbMatches.nonEnglish")}</p>
      </section>
    );
  }
  if (output.status === "stub" && stub) {
    return (
      <section
        aria-label={title}
        className="space-y-2 rounded-lg border border-border bg-card p-3"
      >
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="text-sm text-foreground">
          {t("kbMatches.stub", { version: stub.aptyVersion })}
        </p>
        <a
          href={kbCardUrl(STUB_CITE.exec(stub.cite)?.[1] ?? "", {
            site: stub.site,
            space: stub.space,
          })}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_CLASS}
        >
          {stub.title}
          <ExternalLinkIcon aria-hidden="true" className="size-3" />
        </a>
        {versionControl}
      </section>
    );
  }
  const absent = output.status === "not_in_version" ? output.absent : undefined;
  return (
    <section
      aria-label={title}
      className="space-y-2 rounded-lg border border-border bg-card p-3"
    >
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {absent && (
        <div className="space-y-1" data-testid="kb-not-in-version">
          <p className="text-sm font-medium text-foreground">
            {t("kbMatches.notInVersion", { version: absent.aptyVersion })}
          </p>
          {absent.absentReason && (
            <p className="text-sm text-foreground">{absent.absentReason}</p>
          )}
          <a
            href={kbCardUrl(STUB_CITE.exec(absent.cite)?.[1] ?? "", {
              site: absent.site,
              space: absent.space,
            })}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK_CLASS}
          >
            {absent.title}
            <ExternalLinkIcon aria-hidden="true" className="size-3" />
          </a>
          {output.results.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("kbMatches.otherVersions")}
            </p>
          )}
        </div>
      )}
      <ul className="space-y-2">
        {output.results.map((hit) => {
          const [, pageId = "", layer = ""] = CITE.exec(hit.cite) ?? [];
          return (
            <li
              key={hit.cite}
              className="space-y-1 rounded-md border border-border p-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={kbCardUrl(pageId, {
                    site: hit.site,
                    space: hit.space,
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={LINK_CLASS}
                >
                  {hit.title}
                  <ExternalLinkIcon aria-hidden="true" className="size-3" />
                </a>
                {hit.aptyVersion && (
                  <StatusBadge tone="neutral">{hit.aptyVersion}</StatusBadge>
                )}
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
      {output.mixedVersions && (
        <p className="text-sm font-medium text-foreground">
          {t("kbMatches.mixedVersions")}
        </p>
      )}
      {versionControl}
      <p className="text-xs text-muted-foreground">
        {t("kbMatches.provenance")}
      </p>
      <KbEgressNote />
    </section>
  );
}
