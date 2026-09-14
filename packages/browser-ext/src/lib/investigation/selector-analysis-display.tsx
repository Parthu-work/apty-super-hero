/**
 * Dedicated selector-debugging visual (product spec sections 19/20) —
 * replaces the generic tool-call card only for `analyze_element_selectors`,
 * whose output (recommended selector, ranked candidates, iframe/Shadow DOM
 * boundary) deserves better presentation than a raw JSON dump. Falls back
 * to the default tool display for every other tool, in-flight states, and
 * errors, so nothing here can hide a real failure.
 */
import { Badge } from "@aipexstudio/aipex-react/components/ui/badge";
import { Button } from "@aipexstudio/aipex-react/components/ui/button";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import type { ToolDisplaySlotProps } from "@aipexstudio/aipex-react/types";
import { CopyIcon, LayersIcon } from "lucide-react";
import { useState } from "react";

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
  { icon: string; className: string }
> = {
  recommended: { icon: "✓", className: "text-green-600 dark:text-green-400" },
  risky: { icon: "⚠", className: "text-amber-600 dark:text-amber-400" },
  broken: { icon: "✕", className: "text-red-600 dark:text-red-400" },
};

function CandidateRow({ candidate }: { candidate: RankedSelectorCandidate }) {
  const meta = VERDICT_META[candidate.verdict];
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(candidate.selector);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied — the selector is still visible to copy manually.
    }
  };

  return (
    <li className="rounded-md border p-2">
      <div className="flex items-start gap-2">
        <span
          className={cn("font-semibold", meta.className)}
          aria-hidden="true"
        >
          {meta.icon}
        </span>
        <div className="min-w-0 flex-1">
          <code className="block break-all text-xs">{candidate.selector}</code>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {candidate.verdictReason}
          </p>
          {candidate.live && (
            <p className="text-xs text-muted-foreground">
              Matches {candidate.live.matchCount} element
              {candidate.live.matchCount === 1 ? "" : "s"} on the page
            </p>
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-6 shrink-0"
          onClick={() => void handleCopy()}
          aria-label={`Copy selector ${candidate.selector}`}
        >
          <CopyIcon className="size-3.5" />
        </Button>
      </div>
      {copied && (
        <p className="mt-1 text-xs text-green-600 dark:text-green-400">
          Copied
        </p>
      )}
    </li>
  );
}

export function SelectorAnalysisDisplay({ tool }: ToolDisplaySlotProps) {
  const output = isSelectorAnalysisOutput(tool.output)
    ? tool.output
    : undefined;

  if (!output || !output.available) {
    return (
      <div className="rounded-md border p-3 text-sm">
        <p className="font-medium">Unable to analyze this element.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {output?.message ??
            tool.errorText ??
            "Selector analysis unavailable."}
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
          Selector analysis
        </span>
        {output.tagName && <Badge variant="outline">{output.tagName}</Badge>}
      </div>

      {(output.inIframe || output.inShadowDom) && (
        <div className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <LayersIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            This element is inside{" "}
            {output.inIframe && output.inShadowDom
              ? "an iframe and a Shadow DOM subtree"
              : output.inIframe
                ? "an iframe"
                : "a Shadow DOM subtree"}{" "}
            — a selector for it may not be usable from the top-level document.
          </span>
        </div>
      )}

      {recommended && (
        <div>
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recommended
          </h4>
          <CandidateRow candidate={recommended} />
        </div>
      )}

      {others.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Other candidates
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
          No usable selector candidates were found for this element.
        </p>
      )}
    </div>
  );
}
