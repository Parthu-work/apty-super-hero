import {
  listClientNetworkCalls,
  type NetworkCall,
  type NetworkCallBody,
  type NetworkCallList,
  readClientNetworkCallBody,
} from "@apty/browser-runtime/apty/client-network-calls";
import { currentRedactionMode } from "@apty/browser-runtime/runtime/redaction-mode";
import { Alert, AlertDescription } from "@apty/ui/components/ui/alert";
import { Badge } from "@apty/ui/components/ui/badge";
import { Button } from "@apty/ui/components/ui/button";
import { Input } from "@apty/ui/components/ui/input";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { downloadText } from "@apty/ui/lib/download";
import { withExportHeader } from "@apty/ui/lib/export-header";
import { CopyIcon, DownloadIcon, Loader2, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { JsonTree } from "../../components/investigation/json-tree";

export type StatusClass = "all" | "failed" | "4xx" | "5xx";

const STATUS_CLASSES: Record<StatusClass, TranslationKey> = {
  all: "networkCalls.filterAll",
  failed: "networkCalls.filterFailed",
  "4xx": "networkCalls.filter4xx",
  "5xx": "networkCalls.filter5xx",
};

function inClass(call: NetworkCall, statusClass: StatusClass): boolean {
  switch (statusClass) {
    case "all":
      return true;
    case "failed":
      return call.failed === true;
    case "4xx":
      return (
        call.status !== undefined && call.status >= 400 && call.status < 500
      );
    case "5xx":
      return call.status !== undefined && call.status >= 500;
  }
}

/** Calls matching the text (in name, URL or method, any case) and the status class. */
export function filterNetworkCalls(
  calls: readonly NetworkCall[],
  text: string,
  statusClass: StatusClass,
): NetworkCall[] {
  const needle = text.trim().toLowerCase();
  return calls.filter(
    (call) =>
      inClass(call, statusClass) &&
      (!needle ||
        [call.resourceName, call.url, call.method].some((field) =>
          field.toLowerCase().includes(needle),
        )),
  );
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

type ListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; result: NetworkCallList };

type BodyState =
  | { requestId: string; status: "loading" }
  | { requestId: string; status: "loaded"; result: NetworkCallBody };

/** Why a call has no body to show, or `null` when there is one. */
function bodyMessage(
  result: NetworkCallBody,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  if (result.status === "not_connected") return result.message;
  if (result.status === "not_observed")
    return t("networkCalls.body.notObserved");
  switch (result.status) {
    case "failed":
      return result.call.errorText
        ? t("networkCalls.body.failedWithError", {
            error: result.call.errorText,
          })
        : t("networkCalls.body.failed");
    case "pending":
      return t("networkCalls.body.pending");
    case "body_denied":
      return t("networkCalls.body.denied", { entry: result.deniedBy });
    case "body_unavailable":
      return t("networkCalls.body.unavailable");
  }
  if (!result.body) {
    return t("networkCalls.body.httpErrorNoBody", {
      status: String(result.call.status ?? ""),
    });
  }
  return result.body.isBinary ? t("networkCalls.body.binary") : null;
}

function BodyView({ result }: { result: NetworkCallBody }) {
  const { t } = useTranslation();
  const message = bodyMessage(result, t);
  if (
    message !== null ||
    !("call" in result) ||
    !("body" in result) ||
    !result.body
  ) {
    return (
      <div className="space-y-1 text-sm">
        <p>{message}</p>
        {result.status === "not_connected" && result.fix && (
          <p className="font-medium">{result.fix}</p>
        )}
      </div>
    );
  }
  const { text } = result.body;
  const parsed = parseJson(text);
  const mode = currentRedactionMode();
  const name = result.call.resourceName || "response";
  const filename = parsed.ok
    ? `${name}.redaction-${mode}.json`
    : `${name}.redaction-${mode}.txt`;
  const exported = parsed.ok ? text : withExportHeader(text, mode);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {t("networkCalls.body.size", {
            count: text.length.toLocaleString(),
            mode: t(`redactionModes.${mode}`),
          })}
        </span>
        <div className="ml-auto flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => navigator.clipboard?.writeText(exported)}
          >
            <CopyIcon className="h-4 w-4" />
            {t("networkCalls.body.copy")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              downloadText(
                filename,
                exported,
                parsed.ok ? "application/json" : "text/plain",
              )
            }
          >
            <DownloadIcon className="h-4 w-4" />
            {t("networkCalls.body.download")}
          </Button>
        </div>
      </div>
      <div className="max-h-96 overflow-auto rounded border p-2">
        {parsed.ok ? (
          <JsonTree value={parsed.value} />
        ) : (
          <pre className="whitespace-pre-wrap break-all text-xs">{text}</pre>
        )}
      </div>
    </div>
  );
}

function statusLabel(
  call: NetworkCall,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (call.failed) return t("networkCalls.failed");
  return call.status === undefined
    ? t("networkCalls.pending")
    : String(call.status);
}

/** The Apty Client's own network calls, loaded and read only when the user asks; no model is involved. */
export function ClientNetworkCallsPanel({
  extensionId,
}: {
  extensionId: string | undefined;
}) {
  const { t } = useTranslation();
  const [list, setList] = useState<ListState>({ status: "idle" });
  const [text, setText] = useState("");
  const [statusClass, setStatusClass] = useState<StatusClass>("all");
  const [body, setBody] = useState<BodyState | null>(null);
  // Only the latest request's answer is shown: an older one that arrives
  // late is dropped instead of replacing a newer one.
  const listRequest = useRef(0);
  const bodyRequest = useRef(0);

  const load = async () => {
    const request = ++listRequest.current;
    bodyRequest.current++;
    setList({ status: "loading" });
    setBody(null);
    const result = await listClientNetworkCalls(extensionId);
    if (request !== listRequest.current) return;
    setList({ status: "loaded", result });
  };

  const viewBody = async (requestId: string) => {
    const request = ++bodyRequest.current;
    setBody({ requestId, status: "loading" });
    const result = await readClientNetworkCallBody(extensionId, requestId);
    if (request !== bodyRequest.current) return;
    setBody({ requestId, status: "loaded", result });
  };

  const downloadList = (calls: NetworkCall[], total: number) => {
    const mode = currentRedactionMode();
    downloadText(
      `apty-client-network-calls.redaction-${mode}.json`,
      JSON.stringify(
        {
          source: "Apty Client",
          redactionMode: mode,
          exportedAt: new Date().toISOString(),
          filter: { text: text.trim(), status: statusClass },
          shown: calls.length,
          total,
          summary: `shown ${calls.length} of ${total}`,
          calls,
        },
        null,
        2,
      ),
      "application/json",
    );
  };

  const result = list.status === "loaded" ? list.result : null;
  const shown = result?.ok
    ? filterNetworkCalls(result.calls, text, statusClass)
    : [];

  return (
    <section
      aria-labelledby="client-network-calls-title"
      className="space-y-3 rounded-md border p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="client-network-calls-title" className="text-sm font-medium">
          {t("networkCalls.title")}
        </h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={list.status === "loading"}
          onClick={load}
        >
          {list.status === "loading" && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          {t(result ? "networkCalls.reload" : "networkCalls.load")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("networkCalls.description")}
      </p>

      {result && !result.ok && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">{t("networkCalls.loadFailed")}</p>
            <p>{result.message}</p>
            {result.fix && <p className="mt-1 font-medium">{result.fix}</p>}
          </AlertDescription>
        </Alert>
      )}

      {result?.ok && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground" role="status">
            {t("networkCalls.count", {
              shown: String(shown.length),
              total: String(result.calls.length),
            })}
            {result.mayBeBounded && ` ${t("networkCalls.mayBeBounded")}`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              aria-label={t("networkCalls.filterText")}
              placeholder={t("networkCalls.filterText")}
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="h-8 max-w-xs"
            />
            <fieldset className="flex gap-1">
              <legend className="sr-only">
                {t("networkCalls.filterStatus")}
              </legend>
              {(Object.keys(STATUS_CLASSES) as StatusClass[]).map((key) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={statusClass === key ? "secondary" : "ghost"}
                  aria-pressed={statusClass === key}
                  onClick={() => setStatusClass(key)}
                >
                  {t(STATUS_CLASSES[key])}
                </Button>
              ))}
            </fieldset>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={result.calls.length === 0}
              onClick={() => downloadList(shown, result.calls.length)}
            >
              <DownloadIcon className="h-4 w-4" />
              {t("networkCalls.downloadList")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("networkCalls.redactedNote", {
              mode: t(`redactionModes.${currentRedactionMode()}`),
            })}
          </p>
          {result.calls.length === 0 ? (
            <p className="text-sm">{t("networkCalls.empty")}</p>
          ) : (
            <div className="max-h-96 overflow-auto rounded border">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">{t("networkCalls.title")}</caption>
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th scope="col" className="px-2 py-1">
                      {t("networkCalls.columns.time")}
                    </th>
                    <th scope="col" className="px-2 py-1">
                      {t("networkCalls.columns.method")}
                    </th>
                    <th scope="col" className="px-2 py-1">
                      {t("networkCalls.columns.status")}
                    </th>
                    <th scope="col" className="px-2 py-1">
                      {t("networkCalls.columns.resource")}
                    </th>
                    <th scope="col" className="px-2 py-1">
                      {t("networkCalls.columns.url")}
                    </th>
                    <th scope="col" className="px-2 py-1">
                      <span className="sr-only">
                        {t("networkCalls.columns.actions")}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((call) => (
                    <tr key={call.requestId} className="border-t align-top">
                      <td className="whitespace-nowrap px-2 py-1">
                        {new Date(call.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="px-2 py-1 font-mono">{call.method}</td>
                      <td className="px-2 py-1">
                        {call.failed ? (
                          <Badge variant="destructive">
                            {statusLabel(call, t)}
                          </Badge>
                        ) : (
                          statusLabel(call, t)
                        )}
                        {call.failed && call.errorText && (
                          <div className="mt-0.5 text-muted-foreground">
                            {call.errorText}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1 font-mono">
                        {call.resourceName}
                      </td>
                      <td
                        className="max-w-xs truncate px-2 py-1 font-mono"
                        title={call.url}
                      >
                        {call.url}
                      </td>
                      <td className="px-2 py-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={t("networkCalls.viewBodyOf", {
                            name: call.resourceName || call.url,
                          })}
                          onClick={() => viewBody(call.requestId)}
                        >
                          {t("networkCalls.viewBody")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {body && (
        <div
          className="space-y-2 rounded border p-2"
          aria-live="polite"
          aria-busy={body.status === "loading"}
        >
          {body.status === "loading" ? (
            <p className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("networkCalls.body.loading")}
            </p>
          ) : (
            <BodyView result={body.result} />
          )}
        </div>
      )}
    </section>
  );
}
