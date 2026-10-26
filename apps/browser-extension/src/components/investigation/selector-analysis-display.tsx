/**
 * Dedicated selector-debugging visual (product spec sections 19/20) —
 * replaces the generic tool-call card only for `analyze_element_selectors`,
 * whose output (recommended selector, ranked candidates, iframe/Shadow DOM
 * boundary) deserves better presentation than a raw JSON dump. Falls back
 * to the default tool display for every other tool, in-flight states, and
 * errors, so nothing here can hide a real failure.
 *
 * The recommended selector is rendered as a visually dominant card (larger
 * type, tinted background, its full reasoning spelled out); every other
 * candidate gets a compact row with the same reliability meter so the whole
 * ranked list stays easy to scan at a glance.
 */
import { Badge } from "@apty/ui/components/ui/badge";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import type { ToolDisplaySlotProps } from "@apty/ui/types";
import {
  CheckCircle2Icon,
  CopyIcon,
  LayersIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";
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

function ReliabilityMeter({
  risk,
}: {
  risk: RankedSelectorCandidate["staticRisk"];
}) {
  const { t } = useTranslation();
  const meta = RISK_META[risk];
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={t("investigation.selector.reliability", {
        level: t(meta.label).toLowerCase(),
      })}
    >
      <span className="flex items-end gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((bar) => (
          <span
            key={bar}
            className={cn(
              "w-1 rounded-sm",
              bar === 1 ? "h-1.5" : bar === 2 ? "h-2.5" : "h-3.5",
              bar <= meta.bars ? toneDotClass(meta.tone) : "bg-muted",
            )}
          />
        ))}
      </span>
      <span className={cn("text-xs font-medium", toneTextClass(meta.tone))}>
        {t(meta.label)}
      </span>
    </span>
  );
}

function useCopySelector(selector: string) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selector);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied — the selector is still visible to copy manually.
    }
  };
  return { copied, handleCopy };
}

function RecommendedCandidate({
  candidate,
}: {
  candidate: RankedSelectorCandidate;
}) {
  const { t } = useTranslation();
  const { copied, handleCopy } = useCopySelector(candidate.selector);

  return (
    <div className="rounded-lg border border-success/30 bg-success-muted p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <CheckCircle2Icon
          className={cn("size-4 shrink-0", toneTextClass("success"))}
        />
        <span
          className={cn(
            "text-xs font-semibold uppercase tracking-wide",
            toneTextClass("success"),
          )}
        >
          {t("investigation.selector.recommendedSelector")}
        </span>
      </div>
      <div className="flex items-start gap-2">
        <code className="block min-w-0 flex-1 break-all rounded-sm bg-background/80 px-2 py-1.5 text-sm font-medium">
          {candidate.selector}
        </code>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 shrink-0"
          onClick={() => void handleCopy()}
          aria-label={t("investigation.selector.copy", {
            selector: candidate.selector,
          })}
        >
          <CopyIcon className="size-3.5" />
        </Button>
      </div>
      {copied && (
        <p className={cn("mt-1 text-xs", toneTextClass("success"))}>
          {t("common.copied")}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <ReliabilityMeter risk={candidate.staticRisk} />
        {candidate.live && (
          <span className="text-xs text-muted-foreground">
            {t(
              candidate.live.matchCount === 1
                ? "investigation.selector.matchesOne"
                : "investigation.selector.matchesMany",
              { count: candidate.live.matchCount },
            )}
          </span>
        )}
      </div>
      {candidate.reasons.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {candidate.reasons.map((reason) => (
            <li key={reason} className="flex gap-1.5">
              <span aria-hidden="true">·</span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CandidateRow({ candidate }: { candidate: RankedSelectorCandidate }) {
  const { t } = useTranslation();
  const meta = VERDICT_META[candidate.verdict];
  const { copied, handleCopy } = useCopySelector(candidate.selector);

  return (
    <li className="rounded-md border p-2">
      <div className="flex items-start gap-2">
        {candidate.verdict === "broken" ? (
          <XCircleIcon
            className={cn("mt-0.5 size-3.5 shrink-0", toneTextClass(meta.tone))}
            aria-hidden="true"
          />
        ) : (
          <span
            className={cn(
              "mt-0.5 shrink-0 font-semibold",
              toneTextClass(meta.tone),
            )}
            aria-hidden="true"
          >
            ⚠
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <code className="block break-all text-xs">{candidate.selector}</code>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <ReliabilityMeter risk={candidate.staticRisk} />
            <span
              className={cn(
                "text-[11px] font-medium",
                toneTextClass(meta.tone),
              )}
            >
              {t(meta.label)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {candidate.verdictReason}
          </p>
          {candidate.live && (
            <p className="text-xs text-muted-foreground">
              {t(
                candidate.live.matchCount === 1
                  ? "investigation.selector.matchesOne"
                  : "investigation.selector.matchesMany",
                { count: candidate.live.matchCount },
              )}
            </p>
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-6 shrink-0"
          onClick={() => void handleCopy()}
          aria-label={t("investigation.selector.copy", {
            selector: candidate.selector,
          })}
        >
          <CopyIcon className="size-3.5" />
        </Button>
      </div>
      {copied && (
        <p className={cn("mt-1 text-xs", toneTextClass("success"))}>
          {t("common.copied")}
        </p>
      )}
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
      <div className="rounded-md border p-3 text-sm">
        <p className="font-medium">{t("investigation.selector.unable")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {output?.message ??
            tool.errorText ??
            t("investigation.selector.unavailable")}
        </p>
      </div>
    );
  }

  const candidates = output.candidates ?? [];
  const recommended = candidates.find((c) => c.verdict === "recommended");
  const others = candidates.filter((c) => c !== recommended);

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("investigation.selector.title")}
        </span>
        {output.tagName && <Badge variant="outline">{output.tagName}</Badge>}
      </div>

      {(output.inIframe || output.inShadowDom) && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-md p-2 text-xs",
            toneTextClass("warning"),
            "bg-warning-muted",
          )}
        >
          <LayersIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {t(
              output.inIframe && output.inShadowDom
                ? "investigation.selector.insideBoth"
                : output.inIframe
                  ? "investigation.selector.insideIframe"
                  : "investigation.selector.insideShadow",
            )}
          </span>
        </div>
      )}

      {recommended && <RecommendedCandidate candidate={recommended} />}

      {others.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("investigation.selector.others")}
          </h4>
          <ul className="space-y-1.5">
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
