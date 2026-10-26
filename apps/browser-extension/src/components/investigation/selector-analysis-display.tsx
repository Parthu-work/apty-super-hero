/**
 * Dedicated selector-debugging visual (product spec sections 19/20) —
 * replaces the generic tool-call card only for `analyze_element_selectors`,
 * whose output (recommended selector, ranked candidates, iframe/Shadow DOM
 * boundary) deserves better presentation than a raw JSON dump. Falls back
 * to the default tool display for every other tool, in-flight states, and
 * errors, so nothing here can hide a real failure.
 *
 * The recommended selector is a card with its reasoning spelled out; every
 * other candidate gets a compact row with the same reliability meter so the
 * whole ranked list stays easy to scan at a glance.
 */
import { Badge, StatusBadge } from "@apty/ui/components/ui/badge";
import { CopyButton } from "@apty/ui/components/ui/copy-button";
import { Notice } from "@apty/ui/components/ui/notice";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import type { ToolDisplaySlotProps } from "@apty/ui/types";
import { CircleXIcon, LayersIcon } from "lucide-react";
import { toneDotClass, toneTextClass } from "./tone-classes";

interface RankedSelectorCandidate {
  selector: string;
  type: string;
  staticRisk: "low" | "medium" | "high";
  reasons: string[];
  verdict: "recommended" | "risky" | "broken";
  verdictReason: string;
  live?: { matchCount: number; matchesTarget: boolean };
}

interface SelectorAnalysisOutput {
  available: boolean;
  message?: string;
  tagName?: string;
  inIframe?: boolean;
  inShadowDom?: boolean;
  recommendedSelector?: string;
  candidates?: RankedSelectorCandidate[];
}

function isSelectorAnalysisOutput(
  value: unknown,
): value is SelectorAnalysisOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    "available" in value &&
    typeof (value as { available: unknown }).available === "boolean"
  );
}

const VERDICT_META: Record<
  RankedSelectorCandidate["verdict"],
  { label: TranslationKey; tone: "success" | "warning" | "danger" }
> = {
  recommended: { label: "investigation.selector.recommended", tone: "success" },
  risky: { label: "investigation.selector.risky", tone: "warning" },
  broken: { label: "investigation.selector.broken", tone: "danger" },
};

const RISK_META: Record<
  RankedSelectorCandidate["staticRisk"],
  {
    label: TranslationKey;
    bars: number;
    tone: "success" | "warning" | "danger";
  }
> = {
  low: { label: "investigation.selector.strong", bars: 3, tone: "success" },
  medium: {
    label: "investigation.selector.moderate",
    bars: 2,
    tone: "warning",
  },
  high: { label: "investigation.selector.weak", bars: 1, tone: "danger" },
};

/** Three segments filled by the static risk, and the word for it. No number: the analysis has none. */
function ReliabilityMeter({
  risk,
}: {
  risk: RankedSelectorCandidate["staticRisk"];
}) {
  const { t } = useTranslation();
  const meta = RISK_META[risk];
  return (
    <span className="inline-flex items-center gap-2" data-risk={risk}>
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((segment) => (
          <span
            key={segment}
            data-filled={segment <= meta.bars || undefined}
            className={cn(
              "h-1.5 w-4 rounded-full",
              segment <= meta.bars ? toneDotClass(meta.tone) : "bg-muted",
            )}
          />
        ))}
      </span>
      <span
        aria-hidden="true"
        className={cn("text-xs font-medium", toneTextClass(meta.tone))}
      >
        {t(meta.label)}
      </span>
      <span className="sr-only">
        {t("investigation.selector.reliability", {
          level: t(meta.label).toLowerCase(),
        })}
      </span>
    </span>
  );
}

function MatchCount({ live }: { live: RankedSelectorCandidate["live"] }) {
  const { t } = useTranslation();
  if (!live) return null;
  return (
    <span className="text-xs text-muted-foreground">
      {t(
        live.matchCount === 1
          ? "investigation.selector.matchesOne"
          : "investigation.selector.matchesMany",
        { count: live.matchCount },
      )}
    </span>
  );
}

function RecommendedCandidate({
  candidate,
}: {
  candidate: RankedSelectorCandidate;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("investigation.selector.recommendedSelector")}
      className="space-y-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-foreground">
          {t("investigation.selector.recommendedSelector")}
        </h4>
        <StatusBadge tone="success">
          {t("investigation.selector.recommended")}
        </StatusBadge>
      </div>
      <div className="flex items-start gap-1 rounded-md border border-border bg-muted py-1 pl-3 pr-1">
        <code className="min-w-0 flex-1 break-all py-1.5 font-mono text-xs leading-4 text-foreground">
          {candidate.selector}
        </code>
        <CopyButton
          text={candidate.selector}
          label={t("investigation.selector.copy", {
            selector: candidate.selector,
          })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ReliabilityMeter risk={candidate.staticRisk} />
        <MatchCount live={candidate.live} />
      </div>
      {candidate.reasons.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {candidate.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CandidateRow({ candidate }: { candidate: RankedSelectorCandidate }) {
  const { t } = useTranslation();
  const meta = VERDICT_META[candidate.verdict];
  return (
    <li className="space-y-1 py-2">
      <div className="flex items-start gap-1">
        <code className="min-w-0 flex-1 break-all py-1.5 font-mono text-xs leading-4 text-foreground">
          {candidate.selector}
        </code>
        <CopyButton
          text={candidate.selector}
          label={t("investigation.selector.copy", {
            selector: candidate.selector,
          })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusBadge
          tone={meta.tone}
          icon={candidate.verdict === "broken" ? CircleXIcon : undefined}
        >
          {t(meta.label)}
        </StatusBadge>
        <ReliabilityMeter risk={candidate.staticRisk} />
        <MatchCount live={candidate.live} />
      </div>
      <p className="text-xs text-muted-foreground">{candidate.verdictReason}</p>
    </li>
  );
}

export function SelectorAnalysisDisplay({ tool }: ToolDisplaySlotProps) {
  const { t } = useTranslation();
  const output = isSelectorAnalysisOutput(tool.output)
    ? tool.output
    : undefined;

  if (!output || !output.available) {
    return (
      <Notice tone="info" title={t("investigation.selector.unable")}>
        <p className="text-muted-foreground">
          {output?.message ??
            tool.errorText ??
            t("investigation.selector.unavailable")}
        </p>
      </Notice>
    );
  }

  const candidates = output.candidates ?? [];
  const recommended = candidates.find((c) => c.verdict === "recommended");
  const others = candidates.filter((c) => c !== recommended);

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">
          {t("investigation.selector.title")}
        </h3>
        {output.tagName && (
          <Badge variant="neutral" className="font-mono">
            {output.tagName}
          </Badge>
        )}
      </div>

      {(output.inIframe || output.inShadowDom) && (
        <Notice tone="info" icon={LayersIcon}>
          {t(
            output.inIframe && output.inShadowDom
              ? "investigation.selector.insideBoth"
              : output.inIframe
                ? "investigation.selector.insideIframe"
                : "investigation.selector.insideShadow",
          )}
        </Notice>
      )}

      {recommended && <RecommendedCandidate candidate={recommended} />}

      {others.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground">
            {t("investigation.selector.others")}
          </h4>
          <ul className="divide-y divide-border">
            {others.map((candidate) => (
              <CandidateRow key={candidate.selector} candidate={candidate} />
            ))}
          </ul>
        </div>
      )}

      {candidates.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("investigation.selector.none")}
        </p>
      )}
    </div>
  );
}
