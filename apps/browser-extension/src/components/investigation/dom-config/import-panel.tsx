import {
  DOM_CONFIG_CONSOLE_SCRIPT,
  DOM_CONFIG_LIMITS,
  type DomConfigImportedRun,
  type DomConfigRunLabel,
} from "@apty/browser-runtime/apty/dom-config/index";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { FileUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { DomConfigState, ImportResult } from "./dom-config-store";
import { PAGE_NAME_MAX } from "./manual-capture";
import { RUN_LABEL } from "./progress-view";
import { CopyButton } from "./report-parts";

const RUN_LABELS: DomConfigRunLabel[] = ["initial", "after-reload", "repeat"];

const INPUT =
  "w-full min-w-0 rounded-md border bg-background px-1.5 py-1 text-xs text-foreground";

interface DraftRun {
  key: number;
  label: DomConfigRunLabel;
  text: string;
  fileName: string | null;
}

function labelAt(index: number): DomConfigRunLabel {
  return RUN_LABELS[Math.min(index, 2)]!;
}

function ImportOutcome({ result }: { result: ImportResult }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      {result.added > 0 && (
        <p className="text-foreground">
          {t("domConfig.import.imported", {
            count: result.added,
            page: result.pageLabel,
          })}
        </p>
      )}
      {result.dropped > 0 && (
        <p className="text-foreground">
          {t("domConfig.import.dropped", {
            count: result.dropped,
            max: DOM_CONFIG_LIMITS.maxRunsPerPage,
          })}
        </p>
      )}
      {result.errors.map(({ run, error }) => (
        <div
          key={run}
          className="space-y-0.5 rounded-md border border-destructive/30 p-1.5 text-foreground"
        >
          <p>
            {t("domConfig.import.runError", {
              run: run + 1,
              message: error.message,
            })}
          </p>
          {error.missing.length > 0 && (
            <p>
              {t("domConfig.import.missing", {
                list: error.missing.join(", "),
              })}
            </p>
          )}
          <p>{error.instructions}</p>
        </div>
      ))}
    </div>
  );
}

/** Profiles from the console script, pasted or loaded from files, as the runs of one page. */
export function ImportPanel({
  state,
  disabled,
  onImport,
}: {
  state: Pick<DomConfigState, "importResult">;
  disabled: boolean;
  onImport: (input: {
    pageName: string;
    runs: DomConfigImportedRun[];
  }) => ImportResult | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  const nextKey = useRef(1);
  const newRun = (
    index: number,
    text = "",
    fileName: string | null = null,
  ) => ({
    key: nextKey.current++,
    label: labelAt(index),
    text,
    fileName,
  });
  const [open, setOpen] = useState(false);
  const [pageName, setPageName] = useState("");
  const [runs, setRuns] = useState<DraftRun[]>(() => [
    { key: 0, label: "initial", text: "", fileName: null },
  ]);
  const update = (key: number, patch: Partial<DraftRun>) =>
    setRuns((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const loaded = await Promise.all(
      [...files].map(async (file) => ({
        text: await file.text(),
        name: file.name,
      })),
    );
    setRuns((all) => {
      const kept = all.filter((r) => r.text.trim() !== "");
      return [
        ...kept,
        ...loaded.map((file, i) =>
          newRun(kept.length + i, file.text, file.name),
        ),
      ];
    });
  };

  const filled = runs.filter((r) => r.text.trim() !== "");
  const ready = pageName.trim() !== "" && filled.length > 0 && !disabled;

  const submit = () => {
    const result = onImport({
      pageName: pageName.trim(),
      runs: filled.map((r) => ({ text: r.text, label: r.label })),
    });
    if (!result) return;
    const failed = new Set(result.errors.map((e) => e.run));
    const left = filled.filter((_, i) => failed.has(i));
    setRuns(left.length ? left : [newRun(0)]);
    if (left.length === 0) setPageName("");
  };

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="rounded-md border px-2 py-1.5"
    >
      <summary className="cursor-pointer text-xs font-medium text-foreground">
        {t("domConfig.import.title")}
      </summary>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-foreground">{t("domConfig.import.hint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton
              text={DOM_CONFIG_CONSOLE_SCRIPT}
              what={t("domConfig.import.script")}
              label={t("domConfig.import.copyScript")}
              ariaLabel={t("domConfig.import.copyScriptAria")}
            />
          </div>
          <p className="text-muted-foreground">
            {t("domConfig.import.scriptLimits")}
          </p>

          <label className="block text-foreground" htmlFor={`${id}-name`}>
            {t("domConfig.manual.pageName")}
          </label>
          <input
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
            {t("domConfig.import.pageNameHint", {
              max: DOM_CONFIG_LIMITS.maxRunsPerPage,
            })}
          </p>

          <ol className="space-y-2">
            {runs.map((run, i) => (
              <li key={run.key}>
                <fieldset className="space-y-1 rounded-md border p-1.5">
                  <legend className="px-1 font-medium text-foreground">
                    {t("domConfig.import.run", { index: i + 1 })}
                  </legend>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-foreground">
                      <span>{t("domConfig.import.runKind")}</span>
                      <select
                        value={run.label}
                        onChange={(e) =>
                          update(run.key, {
                            label: e.target.value as DomConfigRunLabel,
                          })
                        }
                        className="rounded-md border bg-background px-1.5 py-1 text-xs text-foreground"
                      >
                        {RUN_LABELS.map((label) => (
                          <option key={label} value={label}>
                            {t(RUN_LABEL[label])}
                          </option>
                        ))}
                      </select>
                    </label>
                    {runs.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 gap-1 px-1.5 text-xs"
                        aria-label={t("domConfig.import.removeAria", {
                          index: i + 1,
                        })}
                        onClick={() =>
                          setRuns((all) => all.filter((r) => r.key !== run.key))
                        }
                      >
                        <Trash2Icon className="size-3" aria-hidden="true" />
                        {t("domConfig.import.remove")}
                      </Button>
                    )}
                  </div>
                  <label
                    className="block text-foreground"
                    htmlFor={`${id}-run-${run.key}`}
                  >
                    {run.fileName
                      ? t("domConfig.import.fromFile", { file: run.fileName })
                      : t("domConfig.import.paste")}
                  </label>
                  <textarea
                    id={`${id}-run-${run.key}`}
                    rows={3}
                    spellCheck={false}
                    value={run.text}
                    onChange={(e) =>
                      update(run.key, { text: e.target.value, fileName: null })
                    }
                    className={`${INPUT} font-mono`}
                  />
                </fieldset>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => setRuns((all) => [...all, newRun(all.length)])}
            >
              <PlusIcon className="size-3" aria-hidden="true" />
              {t("domConfig.import.addRun")}
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs text-foreground focus-within:ring-2 focus-within:ring-ring">
              <FileUpIcon className="size-3" aria-hidden="true" />
              {t("domConfig.import.chooseFiles")}
              <input
                type="file"
                multiple
                accept=".json,.txt,application/json,text/plain"
                className="sr-only"
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!ready}
            onClick={submit}
          >
            {t("domConfig.import.submit")}
          </Button>
          <div role="status" aria-live="polite">
            {state.importResult && (
              <ImportOutcome result={state.importResult} />
            )}
          </div>
        </div>
      )}
    </details>
  );
}
