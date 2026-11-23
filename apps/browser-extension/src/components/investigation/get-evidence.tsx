/**
 * "Get the evidence" on a check that read no Apty file (KB-RAG K27, E8):
 * one button that takes the route the Client's mode calls for. Injected
 * mode captures the tab while it reloads and runs the check again on the
 * page's Apty calls; Extension mode shows how to save a HAR from the
 * Client's service worker, with a drop zone that runs the same check on it
 * here. The route last used on the site is remembered on the device. The
 * HAR route is the 4.x Client's, so a 5.x site is never offered it (K29, B4).
 */

import { siteKeyOf } from "@apty/agent-core";
import {
  captureAndReload,
  harCheckOfResult,
  recheckFromCapture,
} from "@apty/browser-runtime/apty/diagnosis/capture-check";
import {
  MAX_HAR_BYTES,
  readHar,
  runHarCheck,
  summarizeHar,
} from "@apty/browser-runtime/apty/diagnosis/har-check";
import type { DiagnosisResult } from "@apty/browser-runtime/apty/diagnosis/types";
import {
  clientModeOf,
  type DetectedClientMode,
  type EvidenceRoute,
  evidenceRouteOf,
  evidenceRoutesFor,
  rememberedRoute,
  rememberRoute,
  tabClientModeFacts,
} from "@apty/browser-runtime/apty/evidence-route";
import { listObservedResources } from "@apty/browser-runtime/apty/extension-network-inspector";
import { siteHostOf } from "@apty/browser-runtime/conversation/site-host";
import {
  kbVersionForHost,
  versionFromFileNames,
} from "@apty/browser-runtime/kb/kb-version";
import { ChatContext } from "@apty/ui/components/chatbot";
import { Button } from "@apty/ui/components/ui/button";
import { CopyButton } from "@apty/ui/components/ui/copy-button";
import { useTranslation } from "@apty/ui/i18n/context";
import { cn } from "@apty/ui/lib/utils";
import { FileUpIcon } from "lucide-react";
import {
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

interface ActiveTab {
  id: number;
  url?: string;
  siteKey?: string;
}

type SiteVersion = "4.x" | "5.x" | "unknown";

interface Plan {
  detected?: DetectedClientMode;
  route: EvidenceRoute;
  why: "remembered" | "detected" | "default";
  version: SiteVersion;
}

type Step =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "capturing" }
  | { kind: "none" }
  | { kind: "noneFiveX" }
  | { kind: "failed" }
  | { kind: "captured"; calls: number; result: DiagnosisResult }
  | { kind: "har" };

const HAR_STEPS = [
  "checkPack.harSteps.extensions",
  "checkPack.harSteps.serviceWorker",
  "checkPack.harSteps.network",
  "checkPack.harSteps.reproduce",
  "checkPack.harSteps.save",
  "checkPack.harSteps.drop",
] as const;

async function activeTab(): Promise<ActiveTab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.id !== "number") return undefined;
  const host = siteHostOf(tab.url);
  return {
    id: tab.id,
    ...(tab.url ? { url: tab.url } : {}),
    ...(host ? { siteKey: siteKeyOf(host) } : {}),
  };
}

/** What the check's files say of the tenant's version, else what the site is known to run. */
function versionOf(
  result: DiagnosisResult,
  tab: ActiveTab | undefined,
): SiteVersion {
  if (result.filesFromCdn) return "5.x";
  const fromFiles = versionFromFileNames(
    result.files.filter((f) => f.status !== "not_observed").map((f) => f.name),
  );
  return fromFiles !== "unknown"
    ? fromFiles
    : kbVersionForHost(siteHostOf(tab?.url));
}

async function planFor(
  tab: ActiveTab | undefined,
  conversationId: string | null,
  version: SiteVersion,
): Promise<Plan> {
  const [page, listed, remembered] = await Promise.all([
    tab ? tabClientModeFacts(tab.id) : undefined,
    listObservedResources(conversationId ?? undefined).catch(() => ({
      connected: false,
    })),
    rememberedRoute(tab?.siteKey),
  ]);
  const detected = clientModeOf({
    injectedConfig: page?.injectedConfig ?? false,
    clientScript: page?.clientScript ?? false,
    pageContentCalls: page?.pageContentCalls ?? 0,
    clientAnswered: listed.connected,
  });
  return {
    ...(detected ? { detected } : {}),
    ...evidenceRouteOf(detected, remembered, version),
    version,
  };
}

interface Planned {
  tab: ActiveTab | undefined;
  plan: Plan;
}

async function plan(
  conversationId: string | null,
  result: DiagnosisResult,
): Promise<Planned> {
  const tab = await activeTab().catch(() => undefined);
  const version = versionOf(result, tab);
  const planned = await planFor(tab, conversationId, version).catch(
    (): Plan => ({ route: "capture", why: "default", version }),
  );
  return { tab, plan: planned };
}

/**
 * The tab and route, detected once when the card shows. `ready` answers a
 * click that comes before detection ends; `choose` keeps the user's route
 * for the site.
 */
function useEvidencePlan(result: DiagnosisResult): {
  planned: Planned | undefined;
  ready: () => Promise<Planned>;
  choose: (route: EvidenceRoute) => void;
} {
  const conversationId = useContext(ChatContext)?.sessionId ?? null;
  const [planned, setPlanned] = useState<Planned | undefined>();
  const pending = useRef<Promise<Planned> | null>(null);
  useEffect(() => {
    let live = true;
    const running = plan(conversationId, result);
    pending.current = running;
    void running.then((done) => live && setPlanned(done));
    return () => {
      live = false;
    };
  }, [conversationId, result]);
  const ready = () => pending.current ?? plan(conversationId, result);
  const choose = (route: EvidenceRoute) => {
    void ready().then(({ tab, plan: detected }) => {
      if (!evidenceRoutesFor(detected.version).includes(route)) return;
      const chosen: Planned = {
        tab,
        plan: {
          ...(detected.detected ? { detected: detected.detected } : {}),
          route,
          why: "remembered",
          version: detected.version,
        },
      };
      pending.current = Promise.resolve(chosen);
      setPlanned(chosen);
      void rememberRoute(tab?.siteKey, route);
    });
  };
  return { planned, ready, choose };
}

function ModeLine({ plan }: { plan: Plan }) {
  const { t } = useTranslation();
  const mode = plan.detected?.mode;
  return (
    <p className="text-xs text-muted-foreground">
      {t(
        mode === "extension"
          ? "checkPack.getEvidence.modeExtension"
          : mode === "injected"
            ? "checkPack.getEvidence.modeInjected"
            : "checkPack.getEvidence.modeUnknown",
      )}
      {plan.detected &&
        ` ${t(`checkPack.getEvidence.from.${plan.detected.from}`)}`}
    </p>
  );
}

function Progress({ label }: { label: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <progress
        aria-label={t("checkPack.getEvidence.progress")}
        className="h-1.5 w-full accent-primary"
      />
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function HarSteps({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const label = t("checkPack.harSteps.title");
  return (
    <details
      open={open}
      className="rounded-md border border-border px-2.5 py-1.5"
    >
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        {label}
      </summary>
      <ol
        aria-label={label}
        className="mt-1 list-decimal space-y-1 pl-5 text-sm text-foreground"
      >
        {HAR_STEPS.map((key, index) => (
          <li key={key}>
            {t(key)}
            {index === 0 && (
              <CopyButton
                text="chrome://extensions"
                label={t("checkPack.harSteps.copyExtensions")}
                className="ml-1 align-middle"
              />
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

interface DroppedHar {
  fileName: string;
  har: unknown;
  calls: number;
  files: number;
  hasPage: boolean;
}

type HarState =
  | { kind: "empty" }
  | { kind: "reading" }
  | { kind: "error"; reason: string }
  | { kind: "loaded"; har: DroppedHar }
  | { kind: "checking"; har: DroppedHar }
  | { kind: "done"; har: DroppedHar; result: DiagnosisResult };

/** The page as the user confirms it: its address without the query or fragment. */
function shownPage(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function HarDrop({
  result,
  tabUrl,
  renderCheck,
}: {
  result: DiagnosisResult;
  tabUrl: string | undefined;
  renderCheck: (result: DiagnosisResult, id: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [state, setState] = useState<HarState>({ kind: "empty" });
  const [over, setOver] = useState(false);
  const [useTabPage, setUseTabPage] = useState(false);
  const run = useRef(0);
  const check = harCheckOfResult(result);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    run.current += 1;
    if (file.size > MAX_HAR_BYTES) {
      setState({ kind: "error", reason: "too-large" });
      return;
    }
    setState({ kind: "reading" });
    let text: string;
    try {
      text = await file.text();
    } catch {
      setState({ kind: "error", reason: "unreadable" });
      return;
    }
    const read = readHar(text);
    if (!read.ok) {
      setState({ kind: "error", reason: read.reason });
      return;
    }
    const summary = summarizeHar(read.har);
    setState({
      kind: "loaded",
      har: {
        fileName: file.name,
        har: read.har,
        calls: summary.calls,
        files: summary.contentFiles.length,
        hasPage: summary.hasPage,
      },
    });
  };

  const runCheck = async (har: DroppedHar) => {
    if (!check) return;
    const token = ++run.current;
    setState({ kind: "checking", har });
    try {
      const checked = await runHarCheck(
        har.har,
        check,
        useTabPage && tabUrl ? { pageUrl: tabUrl } : {},
      );
      if (token === run.current) {
        setState({ kind: "done", har, result: checked });
      }
    } catch {
      if (token === run.current) {
        setState({ kind: "error", reason: "check-failed" });
      }
    }
  };

  const har =
    state.kind === "loaded" ||
    state.kind === "checking" ||
    state.kind === "done"
      ? state.har
      : undefined;

  return (
    <div className="space-y-2">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the drop target wraps a labelled file input, which keyboard users reach */}
      <div
        data-testid="evidence-drop"
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          void pick(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          "rounded-md border border-dashed border-input p-3",
          over && "border-primary bg-accent",
        )}
      >
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md text-sm text-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
          <FileUpIcon className="size-4" aria-hidden="true" />
          {t("checkPack.getEvidence.drop")}
          <input
            type="file"
            accept=".har,.json,application/json"
            className="sr-only"
            onChange={(event) => {
              void pick(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
      </div>
      <div aria-live="polite" className="space-y-2">
        {state.kind === "reading" && (
          <Progress label={t("checkPack.getEvidence.reading")} />
        )}
        {state.kind === "error" && (
          <p className="text-xs text-destructive">
            {t(`harCheck.error.${state.reason}` as "harCheck.error.not-har")}
          </p>
        )}
        {har && (
          <p className="text-xs text-muted-foreground">
            {t("harCheck.summary", {
              file: har.fileName,
              calls: har.calls,
              files: har.files,
            })}
          </p>
        )}
        {har && har.files === 0 && (
          <p className="text-xs text-muted-foreground">
            {t("checkPack.getEvidence.noFiles")}
          </p>
        )}
        {state.kind === "checking" && (
          <Progress label={t("checkPack.getEvidence.checking")} />
        )}
        {state.kind === "done" && renderCheck(state.result, `${id}-har`)}
      </div>
      {har && !har.hasPage && tabUrl && (
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={useTabPage}
            onChange={(event) => setUseTabPage(event.target.checked)}
            className="mt-0.5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <span className="break-all">
            {t("harCheck.useTabPage", { page: shownPage(tabUrl) })}
          </span>
        </label>
      )}
      {har && check && state.kind !== "done" && (
        <Button
          variant="secondary"
          size="sm"
          disabled={state.kind === "checking"}
          onClick={() => void runCheck(har)}
        >
          {t("checkPack.getEvidence.check")}
        </Button>
      )}
    </div>
  );
}

export function GetEvidence({
  result,
  renderCheck,
}: {
  result: DiagnosisResult;
  /** The check run again on the evidence, as its own card. */
  renderCheck: (result: DiagnosisResult, id: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const routeId = useId();
  const { planned, ready, choose } = useEvidencePlan(result);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const plan = planned?.plan;
  const harAllowed = evidenceRoutesFor(plan?.version ?? "unknown").includes(
    "har",
  );

  const capture = async (tab: ActiveTab | undefined) => {
    if (!tab) {
      setStep({ kind: "failed" });
      return;
    }
    setStep({ kind: "capturing" });
    try {
      const captured = await captureAndReload(tab.id);
      if (!captured.ok) throw new Error(captured.error);
      if (captured.calls === 0) {
        choose("har");
        setStep({ kind: harAllowed ? "none" : "noneFiveX" });
        return;
      }
      const again = await recheckFromCapture(result, tab.id, tab.url);
      if (!again) throw new Error("no check");
      void rememberRoute(tab.siteKey, "capture");
      setStep({ kind: "captured", calls: captured.calls, result: again });
    } catch {
      setStep({ kind: "failed" });
    }
  };

  const get = async () => {
    setStep({ kind: "starting" });
    const { tab, plan: current } = await ready();
    if (current.route === "har") {
      void rememberRoute(tab?.siteKey, "har");
      setStep({ kind: "har" });
      return;
    }
    await capture(tab);
  };

  const other: EvidenceRoute = plan?.route === "har" ? "capture" : "har";
  const busy = step.kind === "starting" || step.kind === "capturing";
  const showHar =
    harAllowed &&
    (step.kind === "har" || step.kind === "none" || step.kind === "failed");

  return (
    <div
      className="space-y-2 rounded-md border border-border p-2.5"
      data-testid="get-evidence"
      data-route={plan?.route}
    >
      <p className="text-sm text-foreground">{t("checkPack.getFiles")}</p>
      {plan && <ModeLine plan={plan} />}
      {plan && (
        <p id={routeId} className="text-xs text-muted-foreground">
          {t(
            plan.route === "har"
              ? "checkPack.getEvidence.routeHar"
              : "checkPack.getEvidence.routeCapture",
          )}
          {plan.why === "remembered" &&
            ` ${t("checkPack.getEvidence.remembered")}`}
        </p>
      )}
      {plan?.version === "unknown" && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="evidence-version-hint"
        >
          {t("checkPack.getEvidence.versionHint")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy}
          aria-describedby={plan ? routeId : undefined}
          onClick={() => void get()}
        >
          {t("checkPack.getEvidence.get")}
        </Button>
        {plan && !busy && harAllowed && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              choose(other);
              setStep({ kind: "idle" });
            }}
          >
            {t(
              other === "har"
                ? "checkPack.getEvidence.useHar"
                : "checkPack.getEvidence.useCapture",
            )}
          </Button>
        )}
      </div>
      <div aria-live="polite" className="space-y-2">
        {step.kind === "starting" && (
          <Progress label={t("checkPack.getEvidence.progress")} />
        )}
        {step.kind === "capturing" && (
          <Progress label={t("checkPack.capturing")} />
        )}
        {step.kind === "none" && (
          <p className="text-xs text-muted-foreground">
            {t("checkPack.captureNone")}
          </p>
        )}
        {step.kind === "noneFiveX" && (
          <p className="text-xs text-muted-foreground">
            {t("checkPack.captureNoneFiveX")}
          </p>
        )}
        {step.kind === "failed" && (
          <p className="text-xs text-muted-foreground">
            {t("checkPack.captureFailed")}
          </p>
        )}
        {step.kind === "captured" && (
          <>
            <p className="text-xs text-muted-foreground">
              {t("checkPack.captured", { calls: step.calls })}
            </p>
            {renderCheck(step.result, `capture-${result.packId}`)}
          </>
        )}
      </div>
      {harAllowed && <HarSteps open={showHar} />}
      {showHar && (
        <HarDrop
          result={result}
          tabUrl={planned?.tab?.url}
          renderCheck={renderCheck}
        />
      )}
    </div>
  );
}
