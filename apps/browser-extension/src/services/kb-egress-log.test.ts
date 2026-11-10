import { kbSourceTag, type OrgPolicyState } from "@apty/agent-core";
import { describe, expect, it } from "vitest";
import {
  createKbEgressLog,
  type KbEgressRecord,
  type KbEgressRecords,
  type KbEgressSent,
} from "./kb-egress-log";

/** A word only the synthetic chunk holds, and the SE's question. */
const UNIQUE = "Zorblaxian";
const QUESTION = "why does the banner never glow";

function memory(initial: KbEgressRecord[] = []): KbEgressRecords {
  let list = [...initial];
  return {
    read: async () => [...list],
    write: async (next) => {
      list = [...next];
    },
  };
}

const SENT: KbEgressSent = {
  purpose: "chat",
  destination: {
    provider: "azure",
    origin: "https://tenant.openai.azure.com",
    model: "gpt-5",
  },
  cards: kbSourceTag([
    { pageId: "101", layer: 1 },
    { pageId: "202", layer: 3 },
  ]).cards,
  packs: [
    {
      aptyVersion: "5.x",
      sha256: "a".repeat(64),
      site: "synthetic.atlassian.example",
      // Fields the record must not copy, even when the info has them.
      space: UNIQUE,
      label: QUESTION,
    } as never,
  ],
};

const NOW = new Date("2026-11-10T12:00:00.000Z");
const NONE: OrgPolicyState = { kind: "none" };

describe("the KB send record (D-SEC6)", () => {
  it("records ids, layers, packs and the destination, never text or the question", async () => {
    const log = createKbEgressLog({
      records: memory(),
      now: () => NOW,
      policy: async () => NONE,
    });
    await log.append(SENT);
    await log.append({ ...SENT, purpose: "summary" });
    const records = await log.list();
    expect(records).toEqual([
      {
        at: "2026-11-10T12:00:00.000Z",
        request: "chat",
        provider: "azure",
        origin: "https://tenant.openai.azure.com",
        model: "gpt-5",
        cards: [
          { pageId: "101", layer: 1 },
          { pageId: "202", layer: 3 },
        ],
        packs: [{ aptyVersion: "5.x", sha256: "a".repeat(64) }],
      },
      expect.objectContaining({ request: "summary" }),
    ]);
    const exported = await log.exportJson();
    expect(exported).not.toContain(UNIQUE);
    expect(exported).not.toContain(QUESTION);
    expect(JSON.parse(exported).records).toHaveLength(2);
  });

  it("deletes records older than the policy's retention on each write and on prune", async () => {
    const old = (days: number): KbEgressRecord => ({
      at: new Date(NOW.getTime() - days * 86_400_000).toISOString(),
      request: "chat",
      provider: "azure",
      cards: [],
      packs: [],
    });
    const records = memory([old(40), old(10), old(2)]);
    const log = createKbEgressLog({
      records,
      now: () => NOW,
      policy: async () => ({
        kind: "active",
        policy: { auditRetentionDays: 7 },
      }),
    });
    await log.prune();
    expect(await log.list()).toEqual([old(2)]);
    await log.append(SENT);
    expect(await log.list()).toHaveLength(2);
    expect(await log.countSince(1)).toBe(1);

    const defaults = createKbEgressLog({
      records: memory([old(40), old(10)]),
      now: () => NOW,
      policy: async () => NONE,
    });
    await defaults.prune();
    expect(await defaults.list()).toEqual([old(10)]);
  });

  it("can be cleared with no policy, and not under one", async () => {
    const free = createKbEgressLog({
      records: memory(),
      now: () => NOW,
      policy: async () => NONE,
    });
    await free.append(SENT);
    expect(await free.clearAllowed()).toBe(true);
    await free.clear();
    expect(await free.list()).toEqual([]);

    const kept = createKbEgressLog({
      records: memory(),
      now: () => NOW,
      policy: async () => ({
        kind: "active",
        policy: { kbToModel: "approved" },
      }),
    });
    await kept.append(SENT);
    expect(await kept.clearAllowed()).toBe(false);
    await expect(kept.clear()).rejects.toThrow(/kept by your organization/);
    expect(await kept.list()).toHaveLength(1);
  });
});
