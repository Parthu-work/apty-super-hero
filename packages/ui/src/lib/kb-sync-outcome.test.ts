import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import zh from "../i18n/locales/zh.json";
import { kbSyncOutcomeMessage } from "./kb-sync-outcome";
import { translatorFor as translator } from "./test-translator";

const CODES = [
  "updated",
  "unchanged",
  "not_modified",
  "older",
  "network",
  "timeout",
  "too_large",
  "wrong_type",
  "version_mismatch",
  "not_json",
  "wrong_kind",
  "wrong_schema_version",
  "invalid",
  "checksum_mismatch",
  "unsigned",
  "untrusted_key",
  "revoked_key",
  "bad_signature",
  "expired",
  "not_yet_valid",
  "http_500",
  "http_403",
  "http_404",
];

describe("kbSyncOutcomeMessage (KB-RAG K26 D2)", () => {
  it.each([
    ["en", en],
    ["zh", zh],
  ])("has a message for every outcome code in %s", (_name, locale) => {
    const t = translator(locale) as never;
    const messages = CODES.map((code) => kbSyncOutcomeMessage(code, t));
    for (const [i, message] of messages.entries()) {
      expect(message, CODES[i]).not.toBe(CODES[i]);
    }
  });

  it("asks to sign in for 401 and 403, and names the status otherwise", () => {
    const t = translator(en) as never;
    expect(kbSyncOutcomeMessage("http_403", t)).toBe(
      "HTTP 403: sign in to the pack host.",
    );
    expect(kbSyncOutcomeMessage("http_502", t)).toBe(
      "HTTP 502 from the pack host.",
    );
    expect(kbSyncOutcomeMessage("mystery", t)).toBe("mystery");
  });
});
