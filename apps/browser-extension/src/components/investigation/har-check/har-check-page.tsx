/**
 * The HAR file check: when a customer's Apty Client cannot be connected,
 * the SE picks the HAR file the customer recorded and runs the same
 * visibility and widget checks on it. The file is read in this panel only,
 * kept in memory while the page is open and never stored or sent; its Apty
 * files go through the deny list and redaction before any check. "Ask
 * about this result" hands the check's transcript, not the file, to a new
 * chat.
 */
import {
  type HarCheck,
  type HarRead,
  type HarSummary,
  MAX_HAR_BYTES,
  readHar,
  runHarCheck,
  summarizeHar,
} from "@apty/browser-runtime/apty/diagnosis/har-check";
import { transcriptOf } from "@apty/browser-runtime/apty/diagnosis/responder";
import {
  type ContentKind,
  type DiagnosisResult,
  KINDS,
} from "@apty/browser-runtime/apty/diagnosis/types";
import { Button } from "@apty/ui/components/ui/button";
import { Input } from "@apty/ui/components/ui/input";
import { Notice } from "@apty/ui/components/ui/notice";
import { useTranslation } from "@apty/ui/i18n/context";
import type { UIToolPart } from "@apty/ui/types";
import { FileUpIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { chatHandoff } from "../../../state/chat-handoff";
import { ToolPageShell } from "../../shell/tool-page-shell";
import { CheckResultCard } from "../check-result-card";

type Target = ContentKind | "widget" | "dapty";

const TARGETS: Target[] = [
  ...(Object.keys(KINDS) as ContentKind[]),
  "widget",
  "dapty",
];

interface LoadedHar {
  fileName: string;
  har: unknown;
  summary: HarSummary;
}

type ReadError =
  | Extract<HarRead, { ok: false }>["reason"]
  | "unreadable"
  | "check-failed";

function checkFor(target: Target, name: string): HarCheck {
  if (target === "widget") return { packId: "widget-not-visible" };
  if (target === "dapty") return { packId: "dapty-conversation" };
  const query = name.trim();
  return {
    packId: "content-not-visible",
    kind: target,
    ...(query ? { query } : {}),
  };
}

function asToolPart(result: DiagnosisResult): UIToolPart {
  return {
    type: "tool",
    toolName: "run_diagnosis",
    toolCallId: "har-check",
    input: {},
    output: result,
    state: "completed",
  };
}

function Summary({ loaded }: { loaded: LoadedHar }) {
  const { t } = useTranslation();
  const { summary } = loaded;
  return (
    <div className="space-y-2" role="status">
      <p className="text-sm text-foreground">
        {t("harCheck.summary", {
          file: loaded.fileName,
          calls: summary.calls,
          files: summary.contentFiles.length,
        })}
      </p>
      {summary.contentFiles.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {summary.contentFiles.map((name) => (
            <li
              key={name}
              className="rounded border border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
            >
              {name}
            </li>
          ))}
        </ul>
      )}
      {summary.version === "none" &&
        (summary.callsWithoutFile > 0 ? (
          <Notice tone="warning" title={t("harCheck.noFileInCalls")}>
            {t("harCheck.noFileInCallsHelp", {
              count: summary.callsWithoutFile,
            })}
          </Notice>
        ) : (
          <Notice tone="warning" title={t("harCheck.noAptyFiles")}>
            {t("harCheck.noAptyFilesHelp")}
          </Notice>
        ))}
      {summary.environments > 1 && (
        <Notice tone="info">
          {t("harCheck.environments", { count: summary.environments })}
        </Notice>
      )}
      {summary.version === "4.x" && (
        <Notice tone="info">{t("harCheck.version4x")}</Notice>
      )}
      {summary.daptyCalls + summary.daptyStoredChats > 0 && (
        <p className="text-sm text-foreground">
          {t("harCheck.daptyFound", {
            calls: summary.daptyCalls,
            stored: summary.daptyStoredChats,
          })}
        </p>
      )}
    </div>
  );
}

export function HarCheckPage() {
  const { t } = useTranslation();
  const id = useId();
  const [loaded, setLoaded] = useState<LoadedHar | null>(null);
  const [error, setError] = useState<ReadError | null>(null);
  const [target, setTarget] = useState<Target>("workflow");
  const [name, setName] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  // A check answers only while its file is still the one picked.
  const run = useRef(0);

  const forgetRunningCheck = () => {
    run.current += 1;
    setRunning(false);
    setResult(null);
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    forgetRunningCheck();
    if (file.size > MAX_HAR_BYTES) {
      setLoaded(null);
      setError("too-large");
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setLoaded(null);
      setError("unreadable");
      return;
    }
    const read = readHar(text);
    if (!read.ok) {
      setLoaded(null);
      setError(read.reason);
      return;
    }
    setError(null);
    setLoaded({
      fileName: file.name,
      har: read.har,
      summary: summarizeHar(read.har),
    });
  };

  const check = async () => {
    if (!loaded) return;
    const token = ++run.current;
    setRunning(true);
    setError(null);
    try {
      const checked = await runHarCheck(loaded.har, checkFor(target, name));
      if (token === run.current) setResult(checked);
    } catch {
      if (token === run.current) setError("check-failed");
    } finally {
      if (token === run.current) setRunning(false);
    }
  };

  const ask = () => {
    if (!result) return;
    chatHandoff.request({
      text: t("harCheck.askDraft"),
      contexts: [
        {
          id: `har-check-${Date.now()}`,
          type: "custom",
          label: t("harCheck.askChip"),
          value: `Checked from a HAR file, not the live Apty Client.\n${transcriptOf(result, "har")}`,
        },
      ],
    });
  };

  const clear = () => {
    forgetRunningCheck();
    setLoaded(null);
    setError(null);
  };

  return (
    <ToolPageShell
      title={t("shell.harCheck")}
      hint={t("harCheck.privacy")}
      footer={
        <div className="space-y-2">
          <Button
            size="lg"
            className="w-full"
            disabled={!loaded || running}
            onClick={() => void check()}
          >
            {running ? t("harCheck.checking") : t("harCheck.check")}
          </Button>
          {result && (
            <Button variant="secondary" className="w-full" onClick={ask}>
              {t("harCheck.ask")}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("harCheck.intro")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 py-2 text-sm text-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
            <FileUpIcon className="size-4" aria-hidden="true" />
            {t(loaded ? "harCheck.chooseAnother" : "harCheck.choose")}
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
          {loaded && (
            <Button variant="ghost" size="sm" onClick={clear}>
              {t("harCheck.clear")}
            </Button>
          )}
        </div>
        {error && <Notice tone="error">{t(`harCheck.error.${error}`)}</Notice>}
        {loaded && <Summary loaded={loaded} />}
        {loaded && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label
                htmlFor={`${id}-target`}
                className="block text-sm font-medium text-foreground"
              >
                {t("harCheck.target")}
              </label>
              <select
                id={`${id}-target`}
                value={target}
                onChange={(event) => setTarget(event.target.value as Target)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {TARGETS.map((value) => (
                  <option key={value} value={value}>
                    {t(`harCheck.targets.${value}`)}
                  </option>
                ))}
              </select>
            </div>
            {target === "dapty" ? (
              loaded.summary.daptyCalls + loaded.summary.daptyStoredChats ===
                0 && <Notice tone="info">{t("harCheck.noDapty")}</Notice>
            ) : target !== "widget" ? (
              <div className="space-y-1.5">
                <label
                  htmlFor={`${id}-name`}
                  className="block text-sm font-medium text-foreground"
                >
                  {t("harCheck.name")}
                </label>
                <Input
                  id={`${id}-name`}
                  value={name}
                  aria-describedby={`${id}-name-help`}
                  onChange={(event) => setName(event.target.value)}
                />
                <p
                  id={`${id}-name-help`}
                  className="text-small text-muted-foreground"
                >
                  {t("harCheck.nameHelp")}
                </p>
              </div>
            ) : (
              !loaded.summary.hasPage && (
                <Notice tone="info">{t("harCheck.noPage")}</Notice>
              )
            )}
          </div>
        )}
        <div aria-live="polite">
          {result && <CheckResultCard tool={asToolPart(result)} />}
        </div>
      </div>
    </ToolPageShell>
  );
}
