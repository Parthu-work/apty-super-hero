/**
 * Diagnosis card (product spec section 15) — renders the investigation's
 * `diagnosis`/`confidence` exactly as the agent recorded them via
 * `update_investigation`. Never upgrades a "likely" diagnosis to look
 * confirmed, and never fabricates a diagnosis when none has been recorded.
 */
import { Badge } from "@aipexstudio/aipex-react/components/ui/badge";
import { Button } from "@aipexstudio/aipex-react/components/ui/button";
import type {
  DiagnosisConfidence,
  InvestigationSession,
} from "@aipexstudio/browser-runtime";
import { ShieldCheckIcon } from "lucide-react";

const CONFIDENCE_META: Record<
  DiagnosisConfidence,
  { label: string; className: string }
> = {
  confirmed: {
    label: "CONFIRMED",
    className: "border-transparent bg-green-600 text-white dark:bg-green-700",
  },
  likely: {
    label: "LIKELY",
    className: "border-transparent bg-amber-500 text-white dark:bg-amber-600",
  },
  possible: {
    label: "POSSIBLE",
    className: "border-amber-400 text-amber-700 dark:text-amber-400",
  },
  unknown: {
    label: "UNKNOWN",
    className: "border-muted-foreground/40 text-muted-foreground",
  },
};

export function DiagnosisCard({
  investigation,
  onVerify,
}: {
  investigation: InvestigationSession | undefined;
  onVerify: () => void;
}) {
  if (!investigation?.diagnosis) {
    return (
      <p className="px-2 py-4 text-center text-sm text-muted-foreground">
        No diagnosis yet. The agent records one here once it reaches a
        conclusion backed by evidence.
      </p>
    );
  }

  const confidence = investigation.confidence ?? "unknown";
  const meta = CONFIDENCE_META[confidence];
  const attempts = investigation.verificationAttempts;
  const lastAttempt = attempts[attempts.length - 1];

  return (
    <div className="space-y-3 p-1">
      <div className="flex items-center gap-2">
        <Badge className={meta.className}>{meta.label}</Badge>
        {investigation.suspectedComponents.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {investigation.suspectedComponents.join(", ")}
          </span>
        )}
      </div>

      <p className="text-sm">{investigation.diagnosis}</p>

      {investigation.hypotheses.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Hypotheses considered
          </h4>
          <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
            {investigation.hypotheses.map((hypothesis) => (
              <li key={hypothesis}>{hypothesis}</li>
            ))}
          </ul>
        </div>
      )}

      {lastAttempt && (
        <div className="flex items-center gap-1.5 text-xs">
          <ShieldCheckIcon className="size-3.5 text-muted-foreground" />
          <span
            className={
              lastAttempt.outcome === "confirmed"
                ? "text-green-600 dark:text-green-400"
                : lastAttempt.outcome === "not_confirmed"
                  ? "text-red-600 dark:text-red-400"
                  : "text-muted-foreground"
            }
          >
            {lastAttempt.outcome === "confirmed" && "Diagnosis confirmed"}
            {lastAttempt.outcome === "not_confirmed" &&
              "Diagnosis not confirmed by last check"}
            {lastAttempt.outcome === "inconclusive" &&
              "Last verification was inconclusive"}
          </span>
        </div>
      )}

      <Button size="sm" variant="outline" onClick={onVerify} className="w-full">
        Verify diagnosis
      </Button>
    </div>
  );
}
