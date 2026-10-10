/**
 * Settings → Apty Integration → Preflight (`#preflight`): run every check a
 * demo depends on, each with its exact fix and a copy button; export the
 * results as redacted JSON; reset demo data. See docs/demo/DEMO.md.
 */
import { redactTextStrict } from "@apty/browser-runtime/runtime/redaction-mode";
import { Button } from "@apty/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apty/ui/components/ui/card";
import { cn } from "@apty/ui/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import {
  type CheckStatus,
  type PreflightCheck,
  type PreflightDeps,
  preflightJson,
  runPreflight,
} from "../../services/preflight";
import { browserPreflightDeps } from "../../services/preflight-browser";
import { purgeStoredData } from "../../services/stored-data";

const STATUS: Record<
  CheckStatus,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  pass: { label: "Pass", icon: CheckCircle2, className: "text-success" },
  warn: {
    label: "Warning",
    icon: AlertTriangle,
    className: "text-amber-700 dark:text-amber-400",
  },
  fail: {
    label: "Fail",
    icon: XCircle,
    className: "text-destructive dark:text-red-400",
  },
};

function download(json: string) {
  const url = URL.createObjectURL(
    new Blob([json], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `apty-preflight-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function CheckRow({ check }: { check: PreflightCheck }) {
  const [copied, setCopied] = useState(false);
  const status = STATUS[check.status];
  const Icon = status.icon;
  return (
    <li
      className="rounded-md border p-3"
      data-check={check.id}
      data-status={check.status}
    >
      <div className="flex items-start gap-2">
        <Icon
          aria-hidden="true"
          className={cn("mt-0.5 h-4 w-4 shrink-0", status.className)}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">
            {check.label}:{" "}
            <span className={status.className}>{status.label}</span>
          </p>
          <p className="break-words text-sm text-muted-foreground">
            {check.detail}
          </p>
          {check.fix && check.id !== "agent-id" && (
            <p className="text-sm">
              <span className="font-medium">Fix: </span>
              {check.fix}
            </p>
          )}
        </div>
        {check.fix && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={
              check.id === "agent-id"
                ? "Copy this extension's ID"
                : `Copy the fix for ${check.label}`
            }
            onClick={() => {
              void navigator.clipboard
                .writeText(check.fix ?? "")
                .then(() => setCopied(true));
            }}
          >
            <ClipboardCheck aria-hidden="true" className="h-4 w-4" />
            {copied ? "Copied" : "Copy"}
          </Button>
        )}
      </div>
    </li>
  );
}

export function PreflightPanel({
  deps = browserPreflightDeps,
  purge = purgeStoredData,
}: {
  deps?: PreflightDeps;
  purge?: () => Promise<void>;
}) {
  const [checks, setChecks] = useState<PreflightCheck[] | null>(null);
  const [running, setRunning] = useState(false);
  const [reset, setReset] = useState<"idle" | "confirming" | "done" | "failed">(
    "idle",
  );

  const run = async () => {
    setRunning(true);
    try {
      setChecks(await runPreflight(deps));
    } finally {
      setRunning(false);
    }
  };

  const failures = checks?.filter((c) => c.status === "fail").length ?? 0;
  const warnings = checks?.filter((c) => c.status === "warn").length ?? 0;

  return (
    <Card id="preflight" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Preflight</CardTitle>
        <CardDescription>
          Checks everything a demo needs: the AI provider and tool calling, the
          Apty Client, the open page and its frames, console capture, clipboard,
          storage and data handling. Each problem comes with its fix. Runs only
          when you click.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void run()} disabled={running}>
            {running && (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            )}
            {running ? "Checking…" : "Run all checks"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!checks}
            onClick={() =>
              checks && download(preflightJson(checks, redactTextStrict))
            }
          >
            Export results (redacted JSON)
          </Button>
          {reset === "confirming" ? (
            <>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  purge()
                    .then(() => setReset("done"))
                    .catch(() => setReset("failed"));
                }}
              >
                Delete conversations and screenshots
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setReset("idle")}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => setReset("confirming")}
            >
              Reset demo data
            </Button>
          )}
        </div>
        {reset === "done" && (
          <p role="status" className="text-sm text-muted-foreground">
            Demo data reset: stored conversations and screenshots deleted.
          </p>
        )}
        {reset === "failed" && (
          <p role="alert" className="text-sm text-destructive">
            Could not delete the stored data. Try again from General → Stored
            conversations.
          </p>
        )}
        {checks && (
          <>
            <p role="status" className="text-sm font-medium">
              {failures === 0 && warnings === 0
                ? "All checks passed."
                : `${failures} failing, ${warnings} with warnings.`}
            </p>
            <ul aria-label="Preflight results" className="space-y-2">
              {checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
