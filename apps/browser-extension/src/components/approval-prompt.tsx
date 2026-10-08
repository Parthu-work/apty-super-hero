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
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@apty/ui/components/ui/alert";
import { Button } from "@apty/ui/components/ui/button";
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
    ) => {
      if (!isOwnExtensionPage(sender)) return false;
      if (message?.type === APPROVAL_REQUEST_MESSAGE && message.request) {
        const request = message.request;
        setRemote((current) =>
          current.some((r) => r.approvalId === request.approvalId)
            ? current
            : [...current, request],
        );
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

export function ApprovalPrompt() {
  const { requests, decide } = usePendingApprovals();
  if (requests.length === 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-2">
      {requests.map((request) => (
        <Alert key={request.approvalId} variant="warning" role="alertdialog">
          <ShieldAlertIcon aria-hidden="true" />
          <AlertTitle>Allow {request.toolName}?</AlertTitle>
          <AlertDescription>
            <p className="mb-1 text-xs text-muted-foreground">
              {request.origin ?? "No page origin"}
            </p>
            <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border bg-muted/40 px-2 py-1.5 text-xs">
              {request.summary}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => decide(request, { approved: true })}
              >
                Allow once
              </Button>
              {request.origin && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    decide(request, { approved: true, remember: true })
                  }
                >
                  Allow on this site for 15 min
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => decide(request, { approved: false })}
              >
                Deny
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
