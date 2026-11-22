/**
 * The KB cards a search_kb result found (KB-RAG K6): each card's title as
 * a link to its Confluence page, the best layer's text, its "Verified on"
 * line and a Not verified badge. Shown for the chat's own answer to a
 * symptom no check pack claims, and for the model's search_kb calls. The
 * card text is rendered as text.
 */
import { type KbLayer, kbCardUrl } from "@apty/agent-core";
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
import { cn } from "@apty/ui/lib/utils";
import type { ToolDisplaySlotProps } from "@apty/ui/types";
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { HelpedButton } from "../cases/helped-button";
import { WrongCardButton } from "../cases/wrong-card-button";
import { KbChoices } from "./kb-choices";
import { KbEgressNote } from "./kb-egress-note";
import { KbLayerSwitcher } from "./kb-layer-switcher";
import { UnknownSettingCard } from "./kb-unknown-setting";
import { KbVersionControl, useActiveSiteHost } from "./kb-version-control";

const CITE = /^kb:\/\/(\d+)#L([1-4])$/;

const STUB_CITE = /^kb:\/\/(\d+)$/;

/** A search_kb result with a card not written yet. */
function isKbStub(result: Partial<KbToolResult>): boolean {
  return result.status === "stub" && STUB_CITE.test(String(result.stub?.cite));
}

/** K27, F2: the question names a setting no card has, with the closest cards. */
function isUnknownSetting(result: Partial<KbToolResult>): boolean {
  return (
    result.status === "not_covered" &&
    result.reason === "unknown_setting" &&
    Array.isArray(result.closest)
  );
}

/** A search_kb result with cards to show; anything else keeps the default display. */
export function isKbMatches(output: unknown): output is KbToolResult {
  const result = output as Partial<KbToolResult> | null;
  if (
    typeof result === "object" &&
    result !== null &&
    (isKbStub(result) ||
      isUnknownSetting(result) ||
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

const LINK_CLASS =
  "inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

type KbHit = KbToolResult["results"][number];

function citeOf(hit: KbHit): { pageId: string; layer: KbLayer } {
  const [, pageId = "", layer = "1"] = CITE.exec(hit.cite) ?? [];
  return { pageId, layer: Number(layer) as KbLayer };
}

/**
 * K29, D1: the best card open at its layer, the others folded under one
 * line each; picking a folded card opens it in place of the open one.
 */
function KbAnswerCards({
  results,
  query,
}: {
  results: KbHit[];
  query: string;
}) {
  const { t } = useTranslation();
  const foldId = useId();
  const [openCite, setOpenCite] = useState(results[0]?.cite);
  const [foldOpen, setFoldOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const open = results.find((hit) => hit.cite === openCite) ?? results[0];
  if (!open) return null;
  const folded = results.filter((hit) => hit !== open);
  const { pageId, layer } = citeOf(open);
  const foldLabel =
    folded.length === 1
      ? t("kbMatches.otherCardsOne")
      : t("kbMatches.otherCards", { count: folded.length });
  return (
    <>
      <article
        key={open.cite}
        aria-labelledby={`${foldId}-title`}
        className="space-y-1.5 rounded-md border border-border p-2.5"
      >
        <h4
          id={`${foldId}-title`}
          ref={heading}
          tabIndex={-1}
          className="flex flex-wrap items-center gap-2 outline-none"
        >
          <a
            href={kbCardUrl(pageId, { site: open.site, space: open.space })}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK_CLASS}
          >
            {open.title}
            <ExternalLinkIcon aria-hidden="true" className="size-3" />
          </a>
          {open.aptyVersion && (
            <StatusBadge tone="neutral">{open.aptyVersion}</StatusBadge>
          )}
        </h4>
        <KbLayerSwitcher
          pageId={pageId}
          layer={layer}
          text={open.text}
          notVerified={open.notVerified}
        />
        {open.verifiedOn && (
          <p className="text-xs text-muted-foreground">{open.verifiedOn}</p>
        )}
      </article>
      {folded.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={foldOpen}
            aria-controls={`${foldId}-fold`}
            className="group inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => setFoldOpen((value) => !value)}
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 transition-transform",
                foldOpen && "rotate-90",
              )}
            />
            {foldLabel}
          </button>
          {foldOpen && (
            <ul
              id={`${foldId}-fold`}
              aria-label={foldLabel}
              className="mt-1 space-y-0.5"
            >
              {folded.map((hit) => (
                <li key={hit.cite}>
                  <button
                    type="button"
                    aria-label={`${hit.title}${hit.aptyVersion ? `, ${hit.aptyVersion}` : ""}`}
                    className="flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    onClick={() => {
                      setOpenCite(hit.cite);
                      setFoldOpen(false);
                      requestAnimationFrame(() => heading.current?.focus());
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{hit.title}</span>
                    {hit.aptyVersion && (
                      <StatusBadge tone="neutral">
                        {hit.aptyVersion}
                      </StatusBadge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <HelpedButton
          pageId={pageId}
          layer={layer}
          aptyVersion={open.aptyVersion}
        />
        <WrongCardButton
          pageId={pageId}
          layer={layer}
          aptyVersion={open.aptyVersion}
          question={query}
          otherCards={results.map((other) => ({
            pageId: citeOf(other).pageId,
            title: other.title,
          }))}
        />
      </div>
    </>
  );
}

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
  if (isUnknownSetting(output)) {
    return (
      <UnknownSettingCard
        title={title}
        query={query}
        missing={output.missingPhrases ?? []}
        closest={output.closest ?? []}
      />
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
  if (output.choices && output.choices.options.length > 0) {
    return (
      <section
        aria-label={title}
        className="space-y-2 rounded-lg border border-border bg-card p-3"
      >
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <KbChoices options={output.choices.options} />
        {versionControl}
        <p className="text-xs text-muted-foreground">
          {t("kbMatches.provenance")}
        </p>
        <KbEgressNote />
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
      {output.fileVersion && (
        <p className="text-sm text-foreground" data-testid="kb-file-version">
          {t("kbMatches.fileVersion", {
            file: output.fileVersion.file,
            version: output.fileVersion.version,
            siteVersion: output.fileVersion.siteVersion,
            what: t(`kbMatches.fileKinds.${output.fileVersion.kind}`),
            counterpart: output.fileVersion.counterpart,
          })}
        </p>
      )}
      <KbAnswerCards results={output.results} query={query} />
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
