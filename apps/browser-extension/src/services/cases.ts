/**
 * The side panel's case recorder (KB-RAG K25, L1): one per page, over the
 * extension's IndexedDB `apty-cases-db`, keeping cases for the policy's
 * `caseRetentionDays` (90 by default). Nothing here is sent anywhere.
 */
import { caseRetentionDays } from "@apty/agent-core";
import { tabUrlOf } from "@apty/browser-runtime/apty/diagnosis/responder";
import {
  type CaseRecorder,
  createCaseRecorder,
} from "@apty/browser-runtime/case/case-recorder";
import { loadOrgPolicy } from "@apty/browser-runtime/runtime/org-policy";
import {
  type CaseStore,
  createCaseStore,
} from "@apty/browser-runtime/storage/case-store";

let store: CaseStore | undefined;
let recorder: CaseRecorder | undefined;
let activeConversation: string | null = null;

export function caseStore(): CaseStore {
  store ??= createCaseStore({
    retentionDays: async () => caseRetentionDays(await loadOrgPolicy()),
  });
  return store;
}

export function caseRecorder(): CaseRecorder {
  recorder ??= createCaseRecorder({ store: caseStore(), tabUrlOf });
  return recorder;
}

/** The conversation the panel shows, so the model's own checks land in its case. */
export function setActiveConversation(id: string | null): void {
  activeConversation = id;
}

/** Records a check or KB search the model ran in the panel's conversation. */
export function recordModelToolResult(toolName: string, result: unknown) {
  if (!activeConversation) return;
  void caseRecorder()
    .recordToolResult(activeConversation, toolName, result)
    .catch((error) => console.error("[case] not recorded", error));
}
