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

const LINE =
  "4.x code, apty-assist bbb4cbc (player 4.30.0); from code, not runtime-verified";

describe("content-not-visible for a 4.x tenant (K14, checked against apty-assist in K21 F4)", () => {
  it("finds a published, visible flow, and leaves its segments to the browser", () => {
    const result = check("Create a lead");
    expect(result.aptyVersion).toBe("4.x");
    expect(result.verifiedOn).toBe(LINE);
    expect(result.subject.name).toBe("Create a lead");
    expect(causes(result)).toEqual([]);
    expect(result.gates.map((g) => g.reason)).toContain("found");
    expect(result.gates.find((g) => g.ruleId === "C4X-04")).toMatchObject({
      status: "unknown",
      reason: "flowSegments4x",
    });
    expect(result.verdict.status).toBe("candidates");
    expect(result.notChecked).toContain("membership");
    expect(result.files.map((f) => f.name)).toContain("feature-flag.json");
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

  it("F4: with the publishing flag off, the flows come from the Assist server, not flow.json", () => {
    const result = check(
      "Create a lead",
      files4x((f) => {
        delete f["flow.json"];
        f["feature-flag.json"] = {
          publishingSystem: { key: "PublishingSystem", status: false },
        };
      }),
    );
    expect(result.verdict).toMatchObject({
      status: "out_of_scope",
      nextCheck: "manual4x",
    });
    expect(result.gates[0]?.reason).toBe("flowsFromServer4x");
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

  it("F4: names the locales a flow is listed under, as the widget lists it by the user's locale", () => {
    const result = check("Book a meeting");
    expect(
      result.gates.find((g) => g.reason === "flowLocales4x")?.params,
    ).toMatchObject({ locales: "1, 3" });
  });

  it("C4X-03: the flow is hidden from the widget, by any truthy hideInWidget", () => {
    expect(causes(check("Close a deal"))).toEqual(["C4X-03"]);
    const truthy = check(
      "Create a lead",
      files4x((f) => {
        (f["flow.json"] as Rec[])[0] = {
          ...((f["flow.json"] as Rec[])[0] as Rec),
          hideInWidget: 1,
        };
      }),
    );
    expect(causes(truthy)).toEqual(["C4X-03"]);
  });

  it("F4: segments carry conditions, not an on/off switch, so an old isActive false is no cause", () => {
    const old = check(
      "Log a call",
      files4x((f) => {
        for (const s of f["segments.json"] as Rec[]) s.isActive = false;
      }),
    );
    expect(causes(old)).toEqual([]);
    expect(old.gates.find((g) => g.ruleId === "C4X-04")).toMatchObject({
      status: "unknown",
      reason: "flowSegments4x",
      params: { segments: "Call centre" },
    });
  });

  it("C4X-04: a flow no segment lists reaches only users of no segment, and every user when there is no segment", () => {
    const listedByNone = check("Book a meeting");
    expect(listedByNone.gates.find((g) => g.ruleId === "C4X-04")?.reason).toBe(
      "flowInNoSegment4x",
    );
    const noSegments = check(
      "Book a meeting",
      files4x((f) => {
        f["segments.json"] = [];
      }),
    );
    expect(noSegments.gates.find((g) => g.ruleId === "C4X-04")).toMatchObject({
      status: "pass",
      reason: "noSegments",
    });
  });

  it("F4: a rule the flow names but rules.json lacks never runs, so the flow stays visible", () => {
    const result = check("Book a meeting");
    expect(causes(result)).toEqual([]);
    expect(result.gates.find((g) => g.ruleId === "C4X-05")).toMatchObject({
      status: "pass",
      reason: "ruleNotInRules4x",
      params: { rule: "78" },
    });
  });

  it("C4X-05: a rule rules.json holds decides in the browser", () => {
    expect(
      check("Log a call").gates.find((g) => g.ruleId === "C4X-05"),
    ).toMatchObject({
      status: "unknown",
      reason: "ruleDecides4x",
      params: { rule: "FIXTURE sales role" },
    });
  });

  it("C4X-06: the steps file is a bare array; an empty one plays nothing, an object fails to load, an unloaded one stays open", () => {
    const empty = check(
      "Create a lead",
      files4x((f) => {
        f["flow-18515.json"] = [];
      }),
    );
    expect(causes(empty)).toEqual(["C4X-06"]);
    const object = check(
      "Create a lead",
      files4x((f) => {
        f["flow-18515.json"] = { id: 18515, steps: [{ id: 1 }] };
      }),
    );
    expect(causes(object)).toEqual(["C4X-06"]);
    expect(object.verdict.causes[0]?.params.variant).toBe("notList");
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
