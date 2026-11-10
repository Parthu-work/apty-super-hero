import { describe, expect, it } from "vitest";
import { diagnoseContentNotVisible } from "./content-not-visible";
import { diagnoseContentNotVisible4x } from "./content-not-visible-4x";
import { capture, evidenceFrom } from "./diagnosis-test-utils";
import type { Rec } from "./pack-kit";

function files4x(change?: (f: Record<string, unknown>) => void) {
  const files = capture("content-4x");
  change?.(files);
  return evidenceFrom(files);
}
const check = (name: string, evidence = files4x()) =>
  diagnoseContentNotVisible4x(evidence, "workflow", name);
const causes = (result: ReturnType<typeof check>) =>
  result.verdict.causes.map((c) => c.ruleId);

describe("content-not-visible for a 4.x tenant (K14)", () => {
  it("finds a published, visible flow in an active segment, and leaves membership open", () => {
    const result = check("Create a lead");
    expect(result.aptyVersion).toBe("4.x");
    expect(result.verifiedOn).toBe(
      "4.x behaviour as described in FIXES.md K14, not yet checked against apty-assist code; not runtime-verified",
    );
    expect(result.subject.name).toBe("Create a lead");
    expect(causes(result)).toEqual([]);
    expect(result.gates.map((g) => g.reason)).toContain("found");
    expect(result.verdict.status).not.toBe("cause_found");
    expect(result.notChecked).toContain("membership");
  });

  it("C4X-00: flow.json was not seen", () => {
    const result = check(
      "Create a lead",
      files4x((f) => {
        delete f["flow.json"];
      }),
    );
    expect(result.verdict).toMatchObject({
      status: "no_data",
      nextCheck: "reload",
    });
  });

  it("C4X-01: flow.json is empty: no flow is published in this environment", () => {
    const result = check(
      "Create a lead",
      files4x((f) => {
        f["flow.json"] = [];
      }),
    );
    expect(causes(result)).toEqual(["C4X-01"]);
  });

  it("C4X-02: the named flow is not in flow.json", () => {
    const result = check("Approve an invoice");
    expect(causes(result)).toEqual(["C4X-02"]);
    expect(result.gates.find((g) => g.ruleId === "C4X-02")?.reason).toBe(
      "notPublished",
    );
  });

  it("C4X-03: the flow is hidden from the widget", () => {
    expect(causes(check("Close a deal"))).toEqual(["C4X-03"]);
  });

  it("C4X-04: every segment that lists the flow is turned off", () => {
    expect(causes(check("Log a call"))).toEqual(["C4X-04"]);
  });

  it("C4X-05: its segment's rule is missing from rules.json", () => {
    expect(causes(check("Book a meeting"))).toEqual(["C4X-05"]);
  });

  it("C4X-06: the flow's own file has no steps, and an unloaded one stays open", () => {
    const empty = check(
      "Create a lead",
      files4x((f) => {
        f["flow-18515.json"] = { id: 18515, steps: [] };
      }),
    );
    expect(causes(empty)).toEqual(["C4X-06"]);
    const unread = check(
      "Create a lead",
      files4x((f) => {
        delete f["flow-18515.json"];
      }),
    );
    expect(causes(unread)).toEqual([]);
    expect(unread.gates.find((g) => g.ruleId === "C4X-06")?.status).toBe(
      "unknown",
    );
    expect(unread.verdict.nextCheck).toBe("playWorkflow");
  });

  it("reads a flow by its id too", () => {
    expect(check("18516").subject.name).toBe("Close a deal");
  });

  it("keeps the version gate for a kind the 4.x pack does not cover yet", () => {
    const result = diagnoseContentNotVisible4x(files4x(), "tooltip", "x");
    expect(result.verdict).toMatchObject({
      status: "out_of_scope",
      nextCheck: "manual4x",
    });
    expect(result.gates[0]).toMatchObject({
      ruleId: "CNV-V5",
      reason: "version4x",
    });
  });
});

describe("routing by player version", () => {
  it("runs the 4.x pack for 4.x files, and the 5.x one for 5.x files", () => {
    expect(
      diagnoseContentNotVisible(files4x(), "workflow", "Close a deal")
        .aptyVersion,
    ).toBe("4.x");
    const fiveX = diagnoseContentNotVisible(
      evidenceFrom(capture()),
      "workflow",
      "Take a tour",
    );
    expect(fiveX.aptyVersion).toBeUndefined();
    expect((fiveX.gates[0] as Rec | undefined)?.reason).not.toBe("version4x");
  });
});
