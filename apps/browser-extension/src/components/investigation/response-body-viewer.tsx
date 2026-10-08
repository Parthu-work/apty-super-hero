import { findEvidenceById } from "@apty/browser-runtime/apty/evidence-store";
import { Button } from "@apty/ui/components/ui/button";
import { downloadText } from "@apty/ui/lib/download";
import { CopyIcon, DownloadIcon, FileJsonIcon } from "lucide-react";
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
      <p className="mt-1 text-xs text-muted-foreground">
        The full response is no longer available in this session.
      </p>
    );
  }

  const parsed = parseJson(body.text);
  const isJson = parsed.ok;
  const filename = isJson ? `${body.name}.json` : `${body.name}.txt`;

  return (
    <div className="mt-2 rounded-md border">
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <FileJsonIcon className="h-4 w-4" />
          {open ? "Hide full response" : "View full response"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {body.text.length.toLocaleString()} characters
        </span>
        <div className="ml-auto flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Copy full response"
            onClick={() => navigator.clipboard?.writeText(body.text)}
          >
            <CopyIcon className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Download full response"
            onClick={() =>
              downloadText(
                filename,
                body.text,
                isJson ? "application/json" : "text/plain",
              )
            }
          >
            <DownloadIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {open && (
        <div className="max-h-96 overflow-auto border-t p-2">
          {parsed.ok ? (
            <JsonTree value={parsed.value} />
          ) : (
            <pre className="whitespace-pre-wrap break-all text-xs">
              {body.text}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
