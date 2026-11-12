import {
  type AgentInputItem,
  type AppSettings,
  kbSourceTag,
  type OrgPolicyState,
} from "@apty/agent-core";
import { describe, expect, it, vi } from "vitest";
import type { KbPackState } from "../kb/kb-trust.js";
import type { EffectiveSettingsDeps } from "./effective-settings";
import { createKbEgressFilter, decideKbEgress } from "./kb-egress";

/** A word only the synthetic card holds: it must never reach a withheld request. */
const UNIQUE = "Zorblaxian";

const kbJson = JSON.stringify({
  status: "ok",
  ...kbSourceTag([{ pageId: "101", layer: 1 }]),
  results: [
    { cite: "kb://101#L1", text: `Turn on the FIXTURE ${UNIQUE} setting.` },
  ],
});

/** A KB matches answer (local) and a search_kb call the model made. */
const ITEMS: AgentInputItem[] = [
  { type: "message", role: "user", content: "banner never glows" },
  {
    type: "function_call_result",
    callId: "local-1",
    name: "search_kb",
    status: "completed",
    output: { type: "text", text: kbJson },
  } as AgentInputItem,
  {
    type: "function_call_result",
    callId: "call_2",
    name: "search_kb",
    status: "completed",
    output: kbJson,
  } as AgentInputItem,
];

const SETTINGS: AppSettings = {
  aiProvider: "custom",
  aiHost: "https://ai.example.com/v1",
  aiModel: "gpt-chat",
  summaryModel: "gpt-summary",
};
/** Packs in use: one signed by a non-demo key, one by the demo key on a .invalid site (D-SEC10). */
const signed = (site: string, demo: boolean) =>
  ({
    site,
    usability: {
      usable: true,
      validity: { state: "current", date: null },
      trust: {
        status: "trusted",
        keyId: "0123456789abcdef",
        name: "FIXTURE",
        demo,
      },
    },
  }) as unknown as KbPackState;
const REAL = signed("synthetic.atlassian.example", false);
const DEMO = signed("demo.atlassian.invalid", true);

function deps(
  policy: OrgPolicyState,
  packs: KbPackState[],
): EffectiveSettingsDeps {
  return {
    storedSettings: async () => SETTINGS,
    writeSettings: async () => {},
    policy: async () => policy,
    packs: async () => packs,
  };
}

async function send(
  policy: OrgPolicyState,
  packs: KbPackState[],
  purpose: "chat" | "summary" = "chat",
) {
  const onSent = vi.fn();
  const filter = createKbEgressFilter({
    decide: (p) => decideKbEgress(p, deps(policy, packs)),
    onSent,
  });
  const out = await filter(ITEMS, { purpose, tools: [] });
  return { body: JSON.stringify(out), onSent };
}

const APPROVED: OrgPolicyState = {
  kind: "active",
  policy: { kbToModel: "approved", allowedOrigins: ["https://ai.example.com"] },
};

describe("the KB egress filter (D-SEC1)", () => {
  it("withholds card text with no policy and a non-demo pack, naming the cards", async () => {
    const { body, onSent } = await send({ kind: "none" }, [REAL]);
    expect(body).not.toContain(UNIQUE);
    expect(body).toContain(
      "KB card text withheld by organization policy. Cards shown to the user: 101.",
    );
    expect(onSent).not.toHaveBeenCalled();
  });

  it("sends card text when every pack is a demo pack", async () => {
    const { body, onSent } = await send({ kind: "none" }, [DEMO]);
    expect(body).toContain(UNIQUE);
    expect(onSent).toHaveBeenCalledOnce();
  });

  it("sends card text to a destination an approving policy allows, and reports what went", async () => {
    const { body, onSent } = await send(APPROVED, [REAL]);
    expect(body).toContain(UNIQUE);
    expect(onSent).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "chat",
        cards: [
          { pageId: "101", layer: 1 },
          { pageId: "101", layer: 1 },
        ],
        destination: {
          provider: "custom",
          origin: "https://ai.example.com",
          model: "gpt-chat",
        },
      }),
    );
  });

  it("withholds under an approving policy when the destination is off its lists", async () => {
    const policy: OrgPolicyState = {
      kind: "active",
      policy: { kbToModel: "approved", allowedModels: ["gpt-chat"] },
    };
    expect((await send(policy, [REAL])).body).toContain(UNIQUE);
    // The summary request goes to its own model, which the list leaves out.
    expect((await send(policy, [REAL], "summary")).body).not.toContain(UNIQUE);
  });

  it("withholds under an invalid policy, and when the check fails (fail closed)", async () => {
    expect(
      (await send({ kind: "invalid", reason: "x" }, [DEMO, REAL])).body,
    ).not.toContain(UNIQUE);
    const filter = createKbEgressFilter({
      decide: async () => {
        throw new Error("storage gone");
      },
    });
    expect(JSON.stringify(await filter(ITEMS, { tools: [] }))).not.toContain(
      UNIQUE,
    );
    const failing = createKbEgressFilter({
      decide: (p) => decideKbEgress(p, deps(APPROVED, [REAL])),
      onSent: () => {
        throw new Error("record not written");
      },
    });
    expect(JSON.stringify(await failing(ITEMS, { tools: [] }))).not.toContain(
      UNIQUE,
    );
  });

  it("runs over the summary request's source, and leaves untagged items alone", async () => {
    const filter = createKbEgressFilter({ decide: vi.fn() });
    expect(filter.onSummarySource).toBe(true);
    const plain: AgentInputItem[] = [
      { type: "message", role: "user", content: `say ${UNIQUE}` },
    ];
    expect(await filter(plain, { tools: [] })).toBe(plain);
  });
});
