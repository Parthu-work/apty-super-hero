import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import zh from "../i18n/locales/zh.json";
import { translatorFor } from "./test-translator";
import { decisionDetails, kbOutcomeLine } from "./turn-decision";

const t = translatorFor(en) as never;

describe("the KB decision line with pack delivery (KB-RAG K26 D4)", () => {
  it("adds why the last update failed to an expired, policy-delivered pack", () => {
    expect(
      kbOutcomeLine(
        {
          kind: "pack_unusable",
          reason: "expired",
          version: "5.x",
          date: "2027-01-12T00:00:00.000Z",
          delivery: { version: "5.x", outcome: "http_403" },
        },
        t,
      ),
    ).toBe(
      "The 5.x pack expired on 2027-01-12. The last update of the 5.x pack from your organization failed (HTTP 403: sign in to the pack host).",
    );
  });

  it("adds it to no pack, and says nothing more without a failed delivery", () => {
    expect(
      kbOutcomeLine(
        {
          kind: "no_pack",
          version: "5.x",
          delivery: { version: "5.x", outcome: "timeout" },
        },
        t,
      ),
    ).toBe(
      "No 5.x pack is loaded. The last update of the 5.x pack from your organization failed (The pack host did not answer within 60 seconds).",
    );
    expect(kbOutcomeLine({ kind: "no_pack", version: "5.x" }, t)).toBe(
      "No 5.x pack is loaded.",
    );
    expect(
      kbOutcomeLine(
        {
          kind: "no_pack",
          version: "4.x",
          delivery: { version: "4.x", outcome: "network" },
        },
        translatorFor(zh) as never,
      ),
    ).toContain("无法连接知识包主机");
  });

  it("keeps the outcome code in Why this answer", () => {
    const lines = decisionDetails(
      {
        route: "model",
        version: "5.x",
        versionSource: "files",
        packs: [],
        kb: {
          kind: "no_pack",
          version: "5.x",
          delivery: { version: "5.x", outcome: "http_403" },
        },
      },
      t,
    );
    expect(lines.at(-1)).toBe(
      "KB: no pack for 5.x, last update failed (http_403)",
    );
  });
});
