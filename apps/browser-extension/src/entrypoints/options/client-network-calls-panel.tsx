import {
  listClientNetworkCalls,
  type NetworkCall,
  type NetworkCallBody,
  type NetworkCallList,
  readClientResourceBody,
} from "@apty/browser-runtime/apty/client-network-calls";
import {
  groupByResource,
  isFailedCall,
  type ResourceGroup,
} from "@apty/browser-runtime/apty/network-resource-groups";
import { currentRedactionMode } from "@apty/browser-runtime/runtime/redaction-mode";
import { Alert, AlertDescription } from "@apty/ui/components/ui/alert";
import { Badge } from "@apty/ui/components/ui/badge";
import { Button } from "@apty/ui/components/ui/button";
import { Input } from "@apty/ui/components/ui/input";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { downloadText } from "@apty/ui/lib/download";
import { withExportHeader } from "@apty/ui/lib/export-header";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CopyIcon,
  DownloadIcon,
  Loader2,
  XCircle,
} from "lucide-react";
import { Fragment, useRef, useState } from "react";
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

/**
 * Resources matching the text (in any of their calls' name, URL or method)
 * and the status class: a resource matches a class when its latest call
 * does, or any of its failed calls does.
 */
export function filterResourceGroups(
  groups: readonly ResourceGroup<NetworkCall>[],
  text: string,
  statusClass: StatusClass,
): ResourceGroup<NetworkCall>[] {
  const needle = text.trim().toLowerCase();
  return groups.filter(
    (group) =>
      (inClass(group.latest, statusClass) ||
        group.calls.some(
          (call) => isFailedCall(call) && inClass(call, statusClass),
        )) &&
      (!needle ||
        group.calls.some((call) =>
          [call.resourceName, call.url, call.method].some((field) =>
            field.toLowerCase().includes(needle),
          ),
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
  | { key: string; status: "loading" }
  | { key: string; status: "loaded"; result: NetworkCallBody };

const REASON_MESSAGES = {
  "too-large": "networkCalls.body.reason.tooLarge",
  evicted: "networkCalls.body.reason.evicted",
  unreadable: "networkCalls.body.reason.unreadable",
  none: "networkCalls.body.reason.none",
} as const satisfies Record<string, TranslationKey>;

/** Why a call has no body to show, or `null` when there is one. */
function bodyMessage(
  result: NetworkCallBody,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  if (result.status === "not_connected") return result.message;
  if (result.status === "not_observed")
    return t("networkCalls.body.notObserved");
  if ("tooLargeToRedact" in result && result.tooLargeToRedact) {
    return t("networkCalls.body.tooLargeToRedact", {
      count: (result.fullLength ?? 0).toLocaleString(),
    });
  }
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
      return result.reason
        ? t(REASON_MESSAGES[result.reason])
        : t("networkCalls.body.unavailable");
  }
  if (!result.body) {
    const base = t("networkCalls.body.httpErrorNoBody", {
      status: String(result.call.status ?? ""),
    });
    return result.reason
      ? `${base} ${t(REASON_MESSAGES[result.reason])}`
      : base;
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
      {result.newerCallsWithoutBody ? (
        <p className="text-xs text-muted-foreground">
          {t("networkCalls.body.fromOlderCall", {
            time: new Date(result.call.timestamp).toLocaleTimeString(),
            count: String(result.newerCallsWithoutBody),
          })}
        </p>
      ) : null}
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

function GroupStatus({
  group,
  t,
}: {
  group: ResourceGroup<NetworkCall>;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const { latest } = group;
  return (
    <>
      {latest.failed ? (
        <Badge variant="destructive">{statusLabel(latest, t)}</Badge>
      ) : (
        statusLabel(latest, t)
      )}
      {latest.failed && latest.errorText && (
        <div className="mt-0.5 text-muted-foreground">{latest.errorText}</div>
      )}
      {group.failedCount > 0 && (
        <div className="mt-0.5 flex items-center gap-1 text-destructive dark:text-red-400">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          {t("networkCalls.someFailed", {
            failed: String(group.failedCount),
            count: String(group.count),
          })}
        </div>
      )}
    </>
  );
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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
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

  const viewBody = async (key: string) => {
    const request = ++bodyRequest.current;
    setBody({ key, status: "loading" });
    const result = await readClientResourceBody(extensionId, key);
    if (request !== bodyRequest.current) return;
    setBody({ key, status: "loaded", result });
  };

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const downloadList = (
    shownGroups: ResourceGroup<NetworkCall>[],
    allGroups: number,
    total: number,
  ) => {
    const mode = currentRedactionMode();
    const calls = shownGroups.flatMap((group) => [...group.calls].reverse());
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
          uniqueRequests: { shown: shownGroups.length, total: allGroups },
          summary: `shown ${calls.length} of ${total} calls, in ${shownGroups.length} of ${allGroups} unique requests`,
          groups: shownGroups.map((group) => ({
            key: group.key,
            method: group.method,
            url: group.url,
            resourceName: group.resourceName,
            calls: group.count,
            failedCalls: group.failedCount,
            latestStatus: group.latest.status,
            latestFailed: group.latest.failed === true ? true : undefined,
            latestTimestamp: group.latest.timestamp,
          })),
          calls,
        },
        null,
        2,
      ),
      "application/json",
    );
  };

  const result = list.status === "loaded" ? list.result : null;
  const allGroups = result?.ok ? groupByResource(result.calls) : [];
  const shown = filterResourceGroups(allGroups, text, statusClass);
  const bodyGroup = body && allGroups.find((g) => g.key === body.key);

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
            {shown.length === allGroups.length
              ? t("networkCalls.count", {
                  groups: String(allGroups.length),
                  calls: String(result.calls.length),
                })
              : t("networkCalls.countFiltered", {
                  shown: String(shown.length),
                  groups: String(allGroups.length),
                  calls: String(result.calls.length),
                })}
            {result.mayBeBounded && ` ${t("networkCalls.mayBeBounded")}`}
            {result.saveFailures
              ? ` ${t("networkCalls.saveFailures", { count: String(result.saveFailures) })}`
              : ""}
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
              onClick={() =>
                downloadList(shown, allGroups.length, result.calls.length)
              }
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
                      {t("networkCalls.columns.calls")}
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
                  {shown.map((group) => {
                    const open = expanded.has(group.key);
                    const name = group.resourceName || group.url;
                    return (
                      <Fragment key={group.key}>
                        <tr className="border-t align-top">
                          <td className="whitespace-nowrap px-2 py-1">
                            {new Date(
                              group.latest.timestamp,
                            ).toLocaleTimeString()}
                          </td>
                          <td className="px-2 py-1 font-mono">
                            {group.method}
                          </td>
                          <td className="px-2 py-1">
                            <GroupStatus group={group} t={t} />
                          </td>
                          <td className="px-2 py-1 font-mono">
                            {group.resourceName}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1">
                            {t("networkCalls.timesCalled", {
                              count: String(group.count),
                            })}
                          </td>
                          <td
                            className="max-w-xs truncate px-2 py-1 font-mono"
                            title={group.url}
                          >
                            {group.url}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-expanded={open}
                              aria-label={t(
                                open
                                  ? "networkCalls.hideCallsOf"
                                  : "networkCalls.showCallsOf",
                                { name },
                              )}
                              onClick={() => toggle(group.key)}
                            >
                              {open ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-label={t("networkCalls.viewBodyOf", {
                                name,
                              })}
                              onClick={() => viewBody(group.key)}
                            >
                              {t("networkCalls.viewBody")}
                            </Button>
                          </td>
                        </tr>
                        {open &&
                          group.calls.map((call) => (
                            <tr
                              key={call.requestId}
                              className="bg-muted/40 align-top"
                              data-testid="group-call"
                            >
                              <td className="whitespace-nowrap py-1 pl-6 pr-2">
                                {new Date(call.timestamp).toLocaleTimeString()}
                              </td>
                              <td className="px-2 py-1 font-mono">
                                {call.method}
                              </td>
                              <td className="px-2 py-1">
                                {isFailedCall(call) ? (
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
                              <td className="px-2 py-1 text-muted-foreground">
                                {call.hasBody ? t("networkCalls.bodyKept") : ""}
                              </td>
                              <td />
                              <td
                                className="max-w-xs truncate px-2 py-1 font-mono"
                                title={call.url}
                              >
                                {call.url}
                              </td>
                              <td />
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
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
          {bodyGroup && (
            <p className="font-mono text-xs">{bodyGroup.resourceName}</p>
          )}
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
