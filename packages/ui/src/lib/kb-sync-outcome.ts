/**
 * A KB pack check's outcome (KB-RAG K26, D2) in words, for Options, Preflight
 * and the chat's KB decision line. Import refusals reuse the manual import's
 * messages, so a fetched pack and an imported one are refused in the same
 * words.
 */
import type { KbSyncOutcome } from "@apty/agent-core";
import type { I18nContextValue, TranslationKey } from "../i18n/types";

type Translate = I18nContextValue["t"];

const KEYS: Record<Exclude<KbSyncOutcome, `http_${number}`>, TranslationKey> = {
  updated: "settings.knowledgeBase.sync.outcome.updated",
  unchanged: "settings.knowledgeBase.sync.outcome.unchanged",
  not_modified: "settings.knowledgeBase.sync.outcome.notModified",
  older: "settings.knowledgeBase.sync.outcome.older",
  network: "settings.knowledgeBase.sync.outcome.network",
  timeout: "settings.knowledgeBase.sync.outcome.timeout",
  too_large: "settings.knowledgeBase.sync.outcome.tooLarge",
  wrong_type: "settings.knowledgeBase.sync.outcome.wrongType",
  version_mismatch: "settings.knowledgeBase.sync.outcome.versionMismatch",
  not_json: "settings.knowledgeBase.errors.notJson",
  wrong_kind: "settings.knowledgeBase.errors.wrongKind",
  wrong_schema_version: "settings.knowledgeBase.errors.wrongSchemaVersion",
  invalid: "settings.knowledgeBase.errors.invalid",
  checksum_mismatch: "settings.knowledgeBase.errors.checksumMismatch",
  unsigned: "settings.knowledgeBase.errors.notTrusted",
  untrusted_key: "settings.knowledgeBase.errors.notTrusted",
  revoked_key: "settings.knowledgeBase.errors.revokedKey",
  bad_signature: "settings.knowledgeBase.errors.badSignature",
  expired: "settings.knowledgeBase.errors.expired",
  not_yet_valid: "settings.knowledgeBase.errors.notYetValid",
};

/** One sentence for an outcome code; an unknown code is shown as itself. */
export function kbSyncOutcomeMessage(outcome: string, t: Translate): string {
  const http = /^http_(\d{3})$/.exec(outcome);
  if (http) {
    const status = Number(http[1]);
    if (status === 401 || status === 403) {
      return t("settings.knowledgeBase.sync.outcome.httpAuth", { status });
    }
    if (status === 404)
      return t("settings.knowledgeBase.sync.outcome.httpNotFound");
    return t("settings.knowledgeBase.sync.outcome.http", { status });
  }
  const key = KEYS[outcome as keyof typeof KEYS];
  return key ? t(key, { date: "" }) : outcome;
}
