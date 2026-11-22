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

describe("a check's record (KB-RAG K27, F8)", () => {
  const check = {
    route: "check" as const,
    version: "4.x" as const,
    versionSource: "files" as const,
    checkPackId: "content-not-visible",
  };

  it("says the KB was not searched and names the loaded packs", () => {
    const lines = decisionDetails(
      {
        ...check,
        packs: [
          { version: "4.x", sha256: "0123456789ab" },
          { version: "5.x", sha256: "fedcba987654" },
        ],
      },
      t,
    );
    expect(lines).toContain(
      "KB not searched: a check answered (4.x and 5.x loaded)",
    );
    expect(lines.join("\n")).not.toMatch(/Packs searched/);
    expect(decisionDetails({ ...check, packs: [] }, t)).toContain(
      "KB not searched: a check answered (no packs loaded)",
    );
  });
});

describe("the record of Ask the AI anyway (KB-RAG K29, B6)", () => {
  it("shows the KB outcome it follows, not that no pack was searched", () => {
    const lines = decisionDetails(
      {
        route: "model",
        version: "unknown",
        versionSource: "unknown",
        packs: [],
        follows: { kind: "unknown_setting", phrases: ["Widget Activation"] },
      },
      t,
    );
    expect(lines).toContain("KB: no setting named Widget Activation");
    expect(lines.join("\n")).not.toMatch(/Packs searched/);
  });
});
