import { isOwnExtensionPage } from "@apty/browser-runtime/runtime/trusted-sender";
import {
  APPROVAL_CLOSED_MESSAGE,
  APPROVAL_DECISION_MESSAGE,
  APPROVAL_REQUEST_MESSAGE,
  type ApprovalDecision,
  type ApprovalRequest,
  resolveApproval,
  subscribeApprovalRequests,
} from "@apty/browser-runtime/tools/approval";
import { Button } from "@apty/ui/components/ui/button";
import { Notice } from "@apty/ui/components/ui/notice";
import { useTranslation } from "@apty/ui/i18n/context";
import { ShieldAlertIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

function mergeById(
  local: ApprovalRequest[],
  remote: ApprovalRequest[],
): ApprovalRequest[] {
  const seen = new Set(local.map((r) => r.approvalId));
  return [...local, ...remote.filter((r) => !seen.has(r.approvalId))];
}

/**
 * Pending risky-action approvals from this page (agent tools) and from the
 * service worker (MCP bridge tools). The relay listener only accepts
 * messages from this extension's own pages, never from content scripts.
 */
function usePendingApprovals() {
  const [local, setLocal] = useState<ApprovalRequest[]>([]);
  const [remote, setRemote] = useState<ApprovalRequest[]>([]);

  useEffect(() => subscribeApprovalRequests(setLocal), []);

  useEffect(() => {
    const listener = (
      message: {
        type?: string;
        request?: ApprovalRequest;
        approvalId?: string;
      },
      sender: chrome.runtime.MessageSender,
      sendResponse: (shown: boolean) => void,
    ) => {
      if (!isOwnExtensionPage(sender)) return false;
      if (message?.type === APPROVAL_REQUEST_MESSAGE && message.request) {
        const request = message.request;
        setRemote((current) =>
          current.some((r) => r.approvalId === request.approvalId)
            ? current
            : [...current, request],
        );
        sendResponse(true);
        return false;
      }
      if (message?.type === APPROVAL_CLOSED_MESSAGE) {
        setRemote((current) =>
          current.filter((r) => r.approvalId !== message.approvalId),
        );
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const decide = useCallback(
    (request: ApprovalRequest, decision: ApprovalDecision) => {
      if (resolveApproval(request.approvalId, decision)) return;
      setRemote((current) =>
        current.filter((r) => r.approvalId !== request.approvalId),
      );
      chrome.runtime
        .sendMessage({
          type: APPROVAL_DECISION_MESSAGE,
          approvalId: request.approvalId,
          ...decision,
        })
        .catch(() => {});
    },
    [],
  );

  return { requests: mergeById(local, remote), decide };
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [active]);
  return now;
}

function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ApprovalPrompt() {
  const { t } = useTranslation();
  const { requests, decide } = usePendingApprovals();
  const now = useNow(requests.length > 0);
  if (requests.length === 0) return null;

  return (
    <div className="mb-3 flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
      {requests.map((request) => (
        <Notice
          key={request.approvalId}
          tone="warning"
          icon={ShieldAlertIcon}
          role="alertdialog"
          aria-labelledby={`approval-title-${request.approvalId}`}
          className="shrink-0"
          title={
            <span id={`approval-title-${request.approvalId}`}>
              {t("approval.title", { tool: request.toolName })}
            </span>
          }
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => decide(request, { approved: true })}
              >
                {t("approval.allowOnce")}
              </Button>
              {request.origin && request.rememberable !== false && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    decide(request, { approved: true, remember: true })
                  }
                >
                  {t("approval.allowOnSite")}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={() => decide(request, { approved: false })}
              >
                {t("approval.deny")}
              </Button>
            </div>
          }
        >
          <p className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
            <span className="min-w-0 break-all">
              {request.origin ?? t("approval.noOrigin")}
              {request.conversationId
                ? ""
                : ` · ${t("approval.fromMcpClient")}`}
            </span>
            <span
              role="timer"
              aria-label={t("approval.timeLeft")}
              className="font-mono"
            >
              {t("approval.expiresIn", {
                time: formatRemaining(request.expiresAt - now),
              })}
            </span>
          </p>
          <pre
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the summary scrolls inside, so the keyboard must reach it
            tabIndex={0}
            className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-card px-2 py-1.5 font-mono text-small text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {request.summary}
          </pre>
        </Notice>
      ))}
    </div>
  );
}
