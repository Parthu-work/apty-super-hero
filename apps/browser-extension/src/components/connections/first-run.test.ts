import type { KbPackState } from "@apty/agent-core";
import { describe, expect, it } from "vitest";
import { type FirstRunFacts, firstRunNeeded, firstRunRows } from "./first-run";

const pack = (
  version: "4.x" | "5.x",
  usable = true,
  expiresAt: string | null = "2027-01-15T00:00:00.000Z",
) =>
  ({
    aptyVersion: version,
    expiresAt,
    usability: usable
      ? { usable: true, validity: { state: "valid" } }
      : { usable: false, reason: "expired", validity: { state: "expired" } },
  }) as unknown as KbPackState;

const READY: FirstRunFacts = {
  packs: [pack("4.x"), pack("5.x")],
  providerConfigured: true,
  noKeyMode: false,
  client: { kind: "connected", extensionId: "x" },
  policy: { kind: "none" } as FirstRunFacts["policy"],
};

const row = (facts: FirstRunFacts, id: string) =>
  firstRunRows(facts).find((r) => r.id === id);

describe("the first-run checklist rows (KB-RAG K27, R3)", () => {
  it("a KB pack per version: ready with its expiry, not usable, or missing", () => {
    expect(row(READY, "kb-4.x")).toMatchObject({
      state: "ok",
      detail: "packReady",
      values: { expires: "2027-01-15" },
    });
    expect(
      row({ ...READY, packs: [pack("4.x", false), pack("5.x")] }, "kb-4.x"),
    ).toMatchObject({ state: "problem", values: { reason: "expired" } });
    expect(row({ ...READY, packs: [pack("4.x")] }, "kb-5.x")).toMatchObject({
      state: "todo",
      detail: "packMissing",
      section: "knowledge-base",
    });
  });

  it("the AI model: a key, no-key mode chosen, or neither", () => {
    expect(row(READY, "ai")?.state).toBe("ok");
    expect(
      row({ ...READY, providerConfigured: false, noKeyMode: true }, "ai"),
    ).toMatchObject({ state: "ok", detail: "aiNoKey" });
    expect(row({ ...READY, providerConfigured: false }, "ai")).toMatchObject({
      state: "todo",
      section: "ai-provider",
    });
  });

  it("the Apty Client: connected, not answering, or not set up", () => {
    expect(row(READY, "client")?.state).toBe("ok");
    expect(
      row(
        { ...READY, client: { kind: "not-answering", extensionId: "x" } },
        "client",
      )?.state,
    ).toBe("problem");
    expect(
      row({ ...READY, client: { kind: "not-configured" } }, "client"),
    ).toMatchObject({ state: "todo", section: "apty-client" });
  });

  it("the organization policy: none or active is ready, invalid is not", () => {
    expect(row(READY, "policy")?.detail).toBe("policyNone");
    expect(
      row({ ...READY, policy: { kind: "active" } as never }, "policy")?.state,
    ).toBe("ok");
    expect(
      row({ ...READY, policy: { kind: "invalid" } as never }, "policy")?.state,
    ).toBe("problem");
  });

  it("is needed until every row is ready, and waits while anything is read", () => {
    expect(firstRunNeeded(firstRunRows(READY))).toBe(false);
    expect(
      firstRunNeeded(firstRunRows({ ...READY, providerConfigured: false })),
    ).toBe(true);
    expect(
      firstRunNeeded(
        firstRunRows({ ...READY, providerConfigured: false, packs: undefined }),
      ),
    ).toBe(false);
  });
});
