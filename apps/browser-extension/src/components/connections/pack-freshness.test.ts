import type { KbPackState, KbSyncRecord } from "@apty/agent-core";
import { describe, expect, it } from "vitest";
import {
  deliveredPacks,
  packHeaderItems,
  packStatusTone,
} from "./pack-freshness";

function pack(
  aptyVersion: KbPackState["aptyVersion"],
  {
    sha256 = `${aptyVersion}-sha`,
    usable = true,
    reason,
    daysLeft,
  }: {
    sha256?: string;
    usable?: boolean;
    reason?: KbPackState["usability"]["reason"];
    daysLeft?: number;
  } = {},
): KbPackState {
  return {
    aptyVersion,
    sha256,
    builtAt: "2026-11-01T00:00:00.000Z",
    usability: {
      usable,
      ...(reason ? { reason } : {}),
      trust: { status: "trusted" },
      validity: {
        state: daysLeft === undefined ? "current" : "current",
        date: null,
        ...(daysLeft === undefined ? {} : { daysLeft }),
      },
    },
  } as KbPackState;
}

function record(
  version: KbSyncRecord["version"],
  sha256: string,
  outcome: KbSyncRecord["outcome"] = "updated",
): KbSyncRecord {
  return {
    version,
    host: "packs.example",
    lastCheckAt: "2026-11-18T00:00:00.000Z",
    lastSuccessAt: "2026-11-18T00:00:00.000Z",
    outcome,
    sha256,
    failures: 0,
  };
}

describe("the packs line in the panel header (KB-RAG K27, E9)", () => {
  it("lists each version in order: ok, days left, or why it is not used", () => {
    expect(
      packHeaderItems([
        pack("5.x", { daysLeft: 59 }),
        pack("common", { usable: false, reason: "untrusted" }),
        pack("4.x"),
      ]),
    ).toEqual([
      { version: "4.x", state: "ok" },
      { version: "5.x", state: "expires", days: 59 },
      { version: "common", state: "notUsed", reason: "untrusted" },
    ]);
  });

  it("says expired for an expired pack, and lists nothing with no pack", () => {
    expect(
      packHeaderItems([pack("4.x", { usable: false, reason: "expired" })]),
    ).toEqual([{ version: "4.x", state: "expired" }]);
    expect(packHeaderItems([])).toEqual([]);
  });
});

describe("the header's pack icon (KB-RAG K29, L1)", () => {
  it("is amber under 14 days, red when a pack cannot be used, plain otherwise", () => {
    expect(packStatusTone([])).toBe("none");
    expect(
      packStatusTone([
        { version: "4.x", state: "ok" },
        { version: "5.x", state: "expires", days: 14 },
      ]),
    ).toBe("ok");
    expect(
      packStatusTone([
        { version: "4.x", state: "expires", days: 56 },
        { version: "5.x", state: "expires", days: 13 },
      ]),
    ).toBe("warning");
    expect(
      packStatusTone([
        { version: "4.x", state: "expires", days: 3 },
        { version: "5.x", state: "expired" },
      ]),
    ).toBe("danger");
    expect(
      packStatusTone([
        { version: "4.x", state: "notUsed", reason: "untrusted" },
      ]),
    ).toBe("danger");
  });
});

describe("the delivered-pack banner (KB-RAG K27, E9)", () => {
  it("announces a version whose stored pack delivery brought and the SE has not seen", () => {
    expect(
      deliveredPacks(
        [pack("4.x", { sha256: "new" }), pack("5.x", { sha256: "same" })],
        { "4.x": record("4.x", "new"), "5.x": record("5.x", "same") },
        { "5.x": "same" },
      ),
    ).toEqual([
      { version: "4.x", sha256: "new", builtAt: "2026-11-01T00:00:00.000Z" },
    ]);
  });

  it("keeps announcing after later checks find nothing newer, until it is seen", () => {
    const states = [pack("4.x", { sha256: "new" })];
    const records = { "4.x": record("4.x", "new", "not_modified") };
    expect(deliveredPacks(states, records, {})).toHaveLength(1);
    expect(deliveredPacks(states, records, { "4.x": "new" })).toEqual([]);
  });

  it("never announces a pack imported by hand, a failed check, or a pack not in use", () => {
    expect(deliveredPacks([pack("4.x", { sha256: "hand" })], {}, {})).toEqual(
      [],
    );
    const { lastSuccessAt: _never, ...failed } = record(
      "4.x",
      "old",
      "network",
    );
    expect(
      deliveredPacks([pack("4.x", { sha256: "old" })], { "4.x": failed }, {}),
    ).toEqual([]);
    expect(
      deliveredPacks(
        [pack("4.x", { sha256: "new", usable: false, reason: "expired" })],
        { "4.x": record("4.x", "new") },
        {},
      ),
    ).toEqual([]);
  });
});
