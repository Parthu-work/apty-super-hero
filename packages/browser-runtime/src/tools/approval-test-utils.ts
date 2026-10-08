import {
  type ApprovalDecision,
  type ApprovalRequest,
  resolveApproval,
  subscribeApprovalRequests,
} from "./approval";

/**
 * Stands in for the approval dialog in tests: answers every request that
 * appears, the way a click in the UI would. Returns the requests seen and a
 * function that stops listening.
 */
export function answerApprovals(
  decide: ApprovalDecision | ((request: ApprovalRequest) => ApprovalDecision),
): { requests: ApprovalRequest[]; stop: () => void } {
  const requests: ApprovalRequest[] = [];
  const answered = new Set<string>();
  const stop = subscribeApprovalRequests((pending) => {
    for (const request of pending) {
      if (answered.has(request.approvalId)) continue;
      answered.add(request.approvalId);
      requests.push(request);
      const decision = typeof decide === "function" ? decide(request) : decide;
      queueMicrotask(() => resolveApproval(request.approvalId, decision));
    }
  });
  return { requests, stop };
}
