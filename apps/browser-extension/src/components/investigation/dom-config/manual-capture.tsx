import type { DomConfigRunLabel } from "@apty/browser-runtime/apty/dom-config/index";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { cn } from "@apty/ui/lib/utils";
import { CameraIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toneTextClass } from "../tone-classes";
import type { DomConfigState } from "./dom-config-store";
import { RUN_LABEL } from "./progress-view";

export const PAGE_NAME_MAX = 80;

const RUN_LABELS: DomConfigRunLabel[] = ["initial", "after-reload", "repeat"];

const INPUT =
  "w-full min-w-0 rounded-md border bg-background px-1.5 py-1 text-xs text-foreground";

/**
 * Adds one run of the tab as the SE left it: a modal, a form, a record.
 * The page name is typed by the SE and never read from the page; the only
 * prefill is the name of a page the Warnings tab asks for another run of.
 */
export function ManualCapture({
  state,
  disabledReason,
  onCapture,
  onRequestHandled,
}: {
  state: Pick<DomConfigState, "capturing" | "manualResult" | "captureRequest">;
  /** Why the current tab cannot be captured; null when it can. */
  disabledReason: string | null;
  onCapture: (input: {
    pageName: string;
    runLabel: DomConfigRunLabel;
    probe: boolean;
  }) => void;
  onRequestHandled: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [pageName, setPageName] = useState("");
  const [runLabel, setRunLabel] = useState<DomConfigRunLabel>("initial");
  const [probe, setProbe] = useState(false);
  const request = state.captureRequest;

  useEffect(() => {
    if (!request) return;
    setPageName(request.pageName);
    setRunLabel("repeat");
    nameRef.current?.focus();
    onRequestHandled();
  }, [request, onRequestHandled]);

  const named = pageName.trim().length > 0;
  const result = state.manualResult;

  return (
    <div className="space-y-2 text-xs">
      <p className="text-foreground">{t("domConfig.manual.hint")}</p>
      <label className="block text-foreground" htmlFor={`${id}-name`}>
        {t("domConfig.manual.pageName")}
      </label>
      <input
        ref={nameRef}
        id={`${id}-name`}
        type="text"
        required
        maxLength={PAGE_NAME_MAX}
        autoComplete="off"
        value={pageName}
        onChange={(e) => setPageName(e.target.value)}
        aria-describedby={`${id}-name-hint`}
        className={INPUT}
      />
      <p id={`${id}-name-hint`} className="text-muted-foreground">
        {t("domConfig.manual.pageNameHint", { max: PAGE_NAME_MAX })}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-foreground">
          <span>{t("domConfig.manual.runLabel")}</span>
          <select
            value={runLabel}
            onChange={(e) => setRunLabel(e.target.value as DomConfigRunLabel)}
            className="rounded-md border bg-background px-1.5 py-1 text-xs text-foreground"
          >
            {RUN_LABELS.map((label) => (
              <option key={label} value={label}>
                {t(RUN_LABEL[label])}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-foreground">
          <input
            type="checkbox"
            checked={probe}
            onChange={(e) => setProbe(e.target.checked)}
          />
          <span>{t("domConfig.manual.probe")}</span>
        </label>
      </div>
      {disabledReason && (
        <p className="text-foreground" role="note">
          {disabledReason}
        </p>
      )}
      <Button
        size="sm"
        variant="outline"
        className="gap-1"
        disabled={Boolean(disabledReason) || !named || state.capturing}
        onClick={() =>
          onCapture({ pageName: pageName.trim(), runLabel, probe })
        }
        aria-label={t("domConfig.manual.captureAria")}
      >
        {state.capturing ? (
          <LoaderCircleIcon
            className="size-3 motion-safe:animate-spin"
            aria-hidden="true"
          />
        ) : (
          <CameraIcon className="size-3" aria-hidden="true" />
        )}
        {t("domConfig.manual.capture")}
      </Button>
      <div role="status" aria-live="polite" className="space-y-1">
        {state.capturing && (
          <p className="text-foreground">{t("domConfig.manual.capturing")}</p>
        )}
        {result?.ok && (
          <p className="text-foreground">
            {t("domConfig.manual.captured", {
              run: result.runCount,
              page: result.pageLabel,
            })}
          </p>
        )}
        {result?.ok && result.duplicates.length > 0 && (
          <p className="flex items-start gap-1.5 rounded-md border border-warning-border bg-warning-muted p-1.5 text-foreground">
            <TriangleAlertIcon
              className={cn("mt-0.5 size-3 shrink-0", toneTextClass("warning"))}
              aria-hidden="true"
            />
            {t("domConfig.manual.duplicate", {
              pages: result.duplicates.join(", "),
            })}
          </p>
        )}
        {result && !result.ok && (
          <p className="rounded-md border border-destructive/30 p-1.5 text-foreground">
            {t("domConfig.manual.failed", { error: result.error })}
          </p>
        )}
      </div>
    </div>
  );
}
