/**
 * A lookup answered from the Apty Client's content files (KB-RAG K27, E4):
 * one line that answers, a small table, the choices to pick from when two
 * names match (K28, F2), what to do when the files are not there yet (K28,
 * F3), and where the files came from. No model was asked.
 */
import {
  captureAndReload,
  relookupFromCapture,
} from "@apty/browser-runtime/apty/diagnosis/capture-check";
import type {
  LookupChoice,
  LookupColumn,
  LookupQuestion,
  LookupResult,
  LookupWord,
} from "@apty/browser-runtime/apty/diagnosis/lookup";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import type { ToolDisplaySlotProps } from "@apty/ui/types";
import { useState } from "react";

/** A lookup_content result, as the responder writes it. */
export function isLookupResult(output: unknown): output is LookupResult {
  const result = output as Partial<LookupResult> | null;
  return (
    typeof result === "object" &&
    result !== null &&
    result.kind === "lookup" &&
    Array.isArray(result.rows) &&
    typeof result.message?.key === "string"
  );
}

const WORDS = new Set<string>([
  "@yes",
  "@no",
  "@unknown",
  "@none",
  "@notRead",
  "@name",
  "@id",
  "@hidden",
  "@segments",
]);

type Translate = ReturnType<typeof useTranslation>["t"];

function choiceLabel(choice: LookupChoice, t: Translate): string {
  const parts = [
    choice.id,
    ...(choice.active === undefined
      ? []
      : [t(choice.active ? "lookup.choice.active" : "lookup.choice.inactive")]),
    ...(choice.hidden ? [t("lookup.choice.hidden")] : []),
    ...(choice.workflows === undefined
      ? []
      : [
          t(
            choice.workflows === 1
              ? "lookup.choice.workflowsOne"
              : "lookup.choice.workflows",
            { count: choice.workflows },
          ),
        ]),
  ];
  return parts.length > 1 || choice.id !== choice.name
    ? `${choice.name} (${parts.join(", ")})`
    : choice.name;
}

function Choices({ ask }: { ask: NonNullable<LookupResult["ask"]> }) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<string | undefined>();
  const question = t(`lookup.ask.${ask.what}`);
  const picked = ask.options.find((option) => option.id === chosen);
  return (
    <div className="space-y-2" data-testid="lookup-ask">
      <p className="text-sm text-foreground">{question}</p>
      <div role="group" aria-label={question} className="flex flex-col gap-1">
        {ask.options.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="sm"
            variant={chosen === option.id ? "secondary" : "outline"}
            aria-pressed={chosen === option.id}
            className="h-auto justify-start whitespace-normal py-1.5 text-left"
            onClick={() => setChosen(option.id)}
          >
            {ask.what === "version" ? option.name : choiceLabel(option, t)}
          </Button>
        ))}
      </div>
      {picked && (
        <div
          className="space-y-2 rounded-md border border-border p-2.5"
          data-testid="lookup-chosen"
        >
          <LookupBody result={picked.answer} />
        </div>
      )}
    </div>
  );
}

type EvidenceStep =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "none" }
  | { kind: "failed" }
  | { kind: "reloaded" }
  | { kind: "answered"; result: LookupResult };

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function EvidenceActions({ asked }: { asked: LookupQuestion }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<EvidenceStep>({ kind: "idle" });
  const busy = step.kind === "busy";

  const get = async () => {
    setStep({ kind: "busy" });
    try {
      const tabId = await activeTabId();
      if (tabId === undefined) throw new Error("no tab");
      const captured = await captureAndReload(tabId);
      if (!captured.ok) throw new Error(captured.error);
      if (captured.calls === 0) {
        setStep({ kind: "none" });
        return;
      }
      const result = await relookupFromCapture(asked, tabId);
      if (!result) throw new Error("no capture");
      setStep({ kind: "answered", result });
    } catch {
      setStep({ kind: "failed" });
    }
  };

  const reload = async () => {
    const tabId = await activeTabId().catch(() => undefined);
    if (tabId === undefined) {
      setStep({ kind: "failed" });
      return;
    }
    await chrome.tabs.reload(tabId).catch(() => undefined);
    setStep({ kind: "reloaded" });
  };

  return (
    <div className="space-y-2" data-testid="lookup-evidence">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => void get()}>
          {t("checkPack.getEvidence.get")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void reload()}
        >
          {t("lookup.evidence.reload")}
        </Button>
      </div>
      <div aria-live="polite" className="space-y-2">
        {busy && (
          <p className="text-sm text-muted-foreground">
            {t("checkPack.getEvidence.progress")}
          </p>
        )}
        {(step.kind === "none" ||
          step.kind === "failed" ||
          step.kind === "reloaded") && (
          <p className="text-sm text-muted-foreground">
            {t(`lookup.evidence.${step.kind}`)}
          </p>
        )}
        {step.kind === "answered" && (
          <div className="space-y-2 rounded-md border border-border p-2.5">
            <LookupBody result={step.result} />
          </div>
        )}
      </div>
    </div>
  );
}

function LookupBody({ result }: { result: LookupResult }) {
  const { t } = useTranslation();
  const cell = (value: string) =>
    WORDS.has(value)
      ? t(
          `lookup.word.${value.slice(1) as LookupWord extends `@${infer W}` ? W : never}`,
        )
      : value;
  return (
    <>
      <p className="text-sm text-foreground" data-testid="lookup-answer">
        {t(`lookup.message.${result.message.key}`, result.message.values)}
      </p>
      {result.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                {result.columns.map((column: LookupColumn) => (
                  <th
                    key={column}
                    scope="col"
                    className="py-1 pr-3 font-medium"
                  >
                    {t(`lookup.column.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.join("|")} className="border-t border-border">
                  {row.map((value, i) => (
                    <td
                      key={`${result.columns[i]}-${value}`}
                      className="py-1.5 pr-3"
                    >
                      {cell(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.ask && <Choices ask={result.ask} />}
      {result.offerEvidence && result.asked && (
        <EvidenceActions asked={result.asked} />
      )}
      <p className="text-xs text-muted-foreground">
        {result.files.length > 0
          ? t(`lookup.source.${result.source}`, {
              version: result.aptyVersion,
              files: result.files.join(", "),
            })
          : t("lookup.source.none")}
      </p>
    </>
  );
}

export function LookupCard({ tool }: ToolDisplaySlotProps) {
  const { t } = useTranslation();
  const result = tool.output;
  if (!isLookupResult(result)) return null;
  const title = t("lookup.title");
  return (
    <section
      aria-label={title}
      className="space-y-2 rounded-lg border border-border bg-card p-3"
      data-testid="lookup-card"
    >
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <LookupBody result={result} />
    </section>
  );
}
