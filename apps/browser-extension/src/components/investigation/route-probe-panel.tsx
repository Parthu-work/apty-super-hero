/**
 * Developer-only route probe (Settings → Troubleshooting → Developer
 * tools). Records, after each of the developer's own clicks, what could
 * identify the screen in every frame, and says which of those signals
 * changed: the evidence for onboarding an application whose URL does not
 * identify its screens (section 8 of the DOM Health brief).
 *
 * The probe never clicks. What it shows is already redacted by
 * `@apty/browser-runtime`; the saved report keeps only hashes of page
 * text (`toShareableRouteProbeReport`).
 */
import {
  type ProbeText,
  type RouteProbeFrameRecord,
  type RouteProbeReport,
  type RouteProbeSession,
  type RouteProbeStep,
  startRouteProbe,
  toShareableRouteProbeReport,
} from "@apty/browser-runtime";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import type { I18nContextValue, TranslationKey } from "@apty/ui/i18n/types";
import { useEffect, useRef, useState } from "react";

const HINT_LABEL: Record<RouteProbeReport["analysis"]["hint"], TranslationKey> =
  {
    "url-first": "routeProbe.hint.urlFirst",
    "click-first": "routeProbe.hint.clickFirst",
    undetermined: "routeProbe.hint.undetermined",
  };

function show(value: ProbeText | null | undefined): string {
  return value?.text || "—";
}

function frameLabel(
  t: I18nContextValue["t"],
  frame: RouteProbeFrameRecord,
): string {
  if (frame.frameId === 0) return t("routeProbe.frameTop");
  const owner = frame.owner;
  return (
    owner?.ospId ??
    owner?.id ??
    owner?.title?.text ??
    owner?.name?.text ??
    t("routeProbe.frameNumber", { id: frame.frameId })
  );
}

function StepView({ step }: { step: RouteProbeStep }) {
  const { t } = useTranslation();
  return (
    <li className="rounded border p-2">
      <p className="font-medium text-foreground">
        {step.trigger === "start"
          ? t("routeProbe.stepStart")
          : t("routeProbe.stepClick", {
              index: step.index,
              label: show(step.clickLabel),
            })}
      </p>
      {step.error && <p className="text-destructive">{step.error}</p>}
      <table className="mt-1 w-full table-fixed text-[10px]">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="w-16">{t("routeProbe.colFrame")}</th>
            <th>{t("routeProbe.colUrl")}</th>
            <th>{t("routeProbe.colTitle")}</th>
            <th>{t("routeProbe.colHeading")}</th>
            <th>{t("routeProbe.colActiveNav")}</th>
            <th className="w-12">{t("routeProbe.colPushState")}</th>
            <th className="w-16">{t("routeProbe.colVirtualized")}</th>
            <th>{t("routeProbe.colFirstRequest")}</th>
          </tr>
        </thead>
        <tbody>
          {step.frames.map((frame) => (
            <tr key={frame.frameId} className="align-top">
              <td className="truncate" title={`frameId ${frame.frameId}`}>
                {frameLabel(t, frame)}
              </td>
              <td className="truncate" title={frame.url}>
                {frame.status === "failed"
                  ? t("routeProbe.notRead", {
                      error: frame.error ?? t("routeProbe.noAnswer"),
                    })
                  : frame.url}
              </td>
              <td className="truncate">{show(frame.title)}</td>
              <td className="truncate">{show(frame.heading)}</td>
              <td className="truncate">{show(frame.activeNav)}</td>
              <td>{frame.pushStateCount ?? "—"}</td>
              <td title={t("routeProbe.virtualizedHint")}>
                {describeVirtualized(frame.virtualized)}
              </td>
              <td className="truncate">
                {frame.firstRequest
                  ? `${frame.firstRequest.initiatorType} ${frame.firstRequest.path}`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </li>
  );
}

/**
 * "2 (40/1000)": lists, rendered rows / declared rows ("?" when unknown); "—" when none or not read.
 * @internal
 */
export function describeVirtualized(
  virtualized: RouteProbeFrameRecord["virtualized"] | undefined,
): string {
  if (!virtualized || virtualized.containers === 0) return "—";
  return `${virtualized.containers} (${virtualized.observedItems}/${virtualized.declaredTotal ?? "?"})`;
}

function saveReport(report: RouteProbeReport) {
  const blob = new Blob(
    [JSON.stringify(toShareableRouteProbeReport(report), null, 2)],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `route-probe-${report.startedAt}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function RouteProbePanel({
  tabId,
  onReport,
}: {
  tabId: number;
  /** The finished report, for the DOM Health card's validation bundle. */
  onReport?: (report: RouteProbeReport) => void;
}) {
  const { t } = useTranslation();
  const [steps, setSteps] = useState<RouteProbeStep[]>([]);
  const [report, setReport] = useState<RouteProbeReport | null>(null);
  const [state, setState] = useState<"idle" | "starting" | "running">("idle");
  const sessionRef = useRef<RouteProbeSession | null>(null);

  useEffect(
    () => () => {
      void sessionRef.current?.stop();
    },
    [],
  );

  const start = async () => {
    setSteps([]);
    setReport(null);
    setState("starting");
    sessionRef.current = await startRouteProbe(tabId, (step) =>
      setSteps((current) => [...current, step]),
    );
    setState("running");
  };

  const stop = async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (!session) return;
    const finished = await session.stop();
    setReport(finished);
    onReport?.(finished);
    setState("idle");
  };

  return (
    <section
      aria-label={t("routeProbe.title")}
      className="border-t px-3 py-2 text-[11px] text-muted-foreground"
    >
      <div className="flex items-center justify-between gap-2">
        <p>
          <span className="font-medium text-foreground">
            {t("routeProbe.title")}
          </span>{" "}
          {t("routeProbe.intro")}
        </p>
        {state === "idle" ? (
          <Button size="sm" variant="outline" onClick={() => void start()}>
            {t("routeProbe.start")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={state === "starting"}
            onClick={() => void stop()}
          >
            {t("routeProbe.stop")}
          </Button>
        )}
      </div>

      {report && (
        <div className="mt-2 rounded border bg-muted/40 p-2">
          <p className="font-medium text-foreground">
            {t("routeProbe.hintWithClicks", {
              hint: t(HINT_LABEL[report.analysis.hint]),
              count: report.analysis.clicks,
            })}
          </p>
          <ul className="list-disc pl-4">
            {report.analysis.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="mt-1">
            {t("routeProbe.changedOnClicks", {
              signals: report.analysis.signals
                .map((s) => `${s.signal} ${s.changedOnClicks}`)
                .join(" · "),
            })}
          </p>
          <Button
            size="sm"
            variant="link"
            className="h-auto p-0 text-[11px]"
            onClick={() => saveReport(report)}
          >
            {t("routeProbe.saveReport")}
          </Button>
        </div>
      )}

      {steps.length > 0 && (
        <ol className="mt-2 space-y-1.5">
          {steps.map((step) => (
            <StepView key={step.index} step={step} />
          ))}
        </ol>
      )}
    </section>
  );
}
