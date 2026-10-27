import { findEvidenceById } from "@apty/browser-runtime/apty/evidence-store";
import { currentRedactionMode } from "@apty/browser-runtime/runtime/redaction-mode";
import { Button } from "@apty/ui/components/ui/button";
import { CopyButton } from "@apty/ui/components/ui/copy-button";
import { useTranslation } from "@apty/ui/i18n/context";
import { downloadText } from "@apty/ui/lib/download";
import { withExportHeader } from "@apty/ui/lib/export-header";
import { DownloadIcon, FileJsonIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { JsonTree } from "./json-tree";

interface InspectOutput {
  resourceQuery?: string;
  response?: { evidenceId?: string; fullLength?: number; truncated?: boolean };
}

function parseOutput(output: unknown): InspectOutput | null {
  if (typeof output === "string") {
    try {
      return JSON.parse(output) as InspectOutput;
    } catch {
      return null;
    }
  }
  return typeof output === "object" && output !== null
    ? (output as InspectOutput)
    : null;
}

/** Evidence id of a completed inspect_extension_network result, if it recorded a body. */
export function evidenceIdOf(output: unknown): string | undefined {
  return parseOutput(output)?.response?.evidenceId;
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * The full (redacted) response body behind a tool result, for the user.
 * The model only ever saw a bounded preview of it.
 */
export function ResponseBodyViewer({ evidenceId }: { evidenceId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const body = useMemo(() => {
    const data = findEvidenceById(evidenceId)?.data as
      | { body?: unknown; resourceName?: string }
      | undefined;
    return typeof data?.body === "string"
      ? { text: data.body, name: data.resourceName ?? "response" }
      : null;
  }, [evidenceId]);

  if (!body) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {t("investigation.response.unavailable")}
      </p>
    );
  }

  const parsed = parseJson(body.text);
  const isJson = parsed.ok;
  const mode = currentRedactionMode();
  // A JSON export stays valid JSON, so its mode goes in the file name; a text
  // export carries the usual header line.
  const filename = isJson
    ? `${body.name}.redaction-${mode}.json`
    : `${body.name}.txt`;
  const exported = isJson ? body.text : withExportHeader(body.text, mode);

  return (
    <div className="mt-2 rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <FileJsonIcon aria-hidden="true" />
          {t(
            open
              ? "investigation.response.hide"
              : "investigation.response.view",
          )}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t("investigation.response.size", {
            count: body.text.length.toLocaleString(),
            mode: t(`redactionModes.${mode}`),
          })}
        </span>
        <div className="ml-auto flex gap-1">
          <CopyButton
            text={exported}
            label={t("investigation.response.copy")}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("investigation.response.download")}
            onClick={() =>
              downloadText(
                filename,
                exported,
                isJson ? "application/json" : "text/plain",
              )
            }
          >
            <DownloadIcon aria-hidden="true" />
          </Button>
        </div>
      </div>
      {open && (
        <section
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take focus to scroll by keyboard.
          tabIndex={0}
          aria-label={t("investigation.response.body")}
          className="max-h-96 overflow-auto border-t border-border p-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
        >
          {parsed.ok ? (
            <JsonTree value={parsed.value} />
          ) : (
            <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-4">
              {body.text}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
