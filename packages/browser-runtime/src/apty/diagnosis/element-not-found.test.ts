import type { StoredElementTest } from "@apty/dom-snapshot";
import { describe, expect, it, vi } from "vitest";
import type { ElementProbe, FrameProbe } from "../element-probe.js";
import { capture, evidenceFrom } from "./diagnosis-test-utils.js";
import { diagnoseElementNotFound, stepFileFor } from "./element-not-found.js";
import tourSteps from "./fixtures/content-5x/workflow-0c000000-0000-7000-8000-000000000002.json";
import type { Rec } from "./pack-kit.js";

const TOUR_FILE = "workflow-0c000000-0000-7000-8000-000000000002.json";

function test(matchCount: number, overrides: Partial<StoredElementTest> = {}) {
  return {
    invalid: false,
    matchCount,
    renderedCount: matchCount,
    brokenHostIndex: null,
    shadowMatches: 0,
    chosen: matchCount ? { rendered: true, inViewport: true } : null,
    ...overrides,
  };
}

const top = (t: StoredElementTest): FrameProbe => ({
  depth: 0,
  sameOriginAsTop: true,
  answered: true,
  test: t,
});
const child = (t: StoredElementTest | undefined, depth = 1): FrameProbe =>
  t
    ? { depth, sameOriginAsTop: true, answered: true, test: t }
    : { depth, sameOriginAsTop: false, answered: false };

/** A probe that answers per selector; anything else matches nothing in the top document. */
function probe(bySelector: Record<string, FrameProbe[]> = {}) {
  return vi.fn(
    async ({ selector }: { selector: string }): Promise<ElementProbe> => ({
      ok: true,
      frames: bySelector[selector] ?? [top(test(0))],
    }),
  );
}

function files(edit?: (files: Record<string, Rec[]>) => void) {
  const all = capture() as Record<string, Rec[]>;
  edit?.(all);
  return evidenceFrom(all);
}

const tooltip = (all: Record<string, Rec[]>) => all["tooltip.json"]?.[0] as Rec;

describe("diagnoseElementNotFound", () => {
  it("runs the picker's selector and finds nothing wrong when it matches one rendered element in view", async () => {
    const run = probe({ 'select[name="lead_source"]': [top(test(1))] });

    const result = await diagnoseElementNotFound(
      files(),
      { kind: "tooltip", query: "Lead source help" },
      run,
    );

    expect(run).toHaveBeenCalledWith({
      language: "css",
      selector: 'select[name="lead_source"]',
      shadowRoots: [],
    });
    expect(result.verdict.status).toBe("no_cause_in_data");
    expect(result.verdict.nextCheck).toBe("checkTiming");
    expect(result.gates.find((g) => g.id === "lookup")?.reason).toBe(
      "oneMatch",
    );
    expect(result.notChecked).toEqual([
      "element-timing",
      "closed-shadow-roots",
    ]);
  });

  it("names a selector that matches several elements, with the tooltip and launcher card, and never shows the selector", async () => {
    const result = await diagnoseElementNotFound(
      files(),
      { kind: "launcher", query: "Start: Create a lead" },
      probe({ "button.new-lead": [top(test(3, { renderedCount: 1 }))] }),
    );

    expect(result.verdict.status).toBe("cause_found");
    expect(result.verdict.causes[0]).toMatchObject({
      ruleId: "SEL-08",
      cardPageId: "1496907796",
      params: { count: 3, rendered: 1 },
    });
    expect(JSON.stringify(result)).not.toContain("new-lead");
  });

  it("runs an XPath as XPath and checks a validation's disabled elements too", async () => {
    const run = probe({
      "//input[@type='email']": [top(test(1))],
      'button[type="submit"]': [
        top(test(1, { chosen: { rendered: false, inViewport: false } })),
      ],
    });

    const result = await diagnoseElementNotFound(
      files(),
      { kind: "validation", query: "Email format" },
      run,
    );

    expect(run.mock.calls.map(([t]) => t.language)).toEqual(["xpath", "css"]);
    expect(result.verdict.causes).toEqual([
      expect.objectContaining({
        ruleId: "SEL-09",
        params: { part: "disabled", n: 1 },
      }),
    ]);
  });

  it("names an empty field of the active type and the filled one it ignores, without running anything", async () => {
    const run = probe();
    const evidence = files((all) => {
      Object.assign(tooltip(all).element as Rec, {
        identificationType: "CSS",
        cssSelector: "",
      });
    });

    const result = await diagnoseElementNotFound(
      evidence,
      { kind: "tooltip", query: "Lead source help" },
      run,
    );

    expect(run).not.toHaveBeenCalled();
    expect(result.verdict.causes[0]?.ruleId).toBe("SEL-02");
    expect(result.verdict.causes[0]?.summary).toContain(
      "the filled pickedSelector, xPath are ignored",
    );
  });

  it("does not run a custom script or a missing element, and says what to do instead", async () => {
    const run = probe();
    const script = await diagnoseElementNotFound(
      files((all) => {
        (tooltip(all).element as Rec).identificationType = "CUSTOM_SCRIPT";
      }),
      { kind: "tooltip", query: "Lead source help" },
      run,
    );
    const missing = await diagnoseElementNotFound(
      files((all) => {
        tooltip(all).element = null;
      }),
      { kind: "tooltip", query: "Lead source help" },
      run,
    );

    expect(run).not.toHaveBeenCalled();
    expect(script.verdict).toMatchObject({
      status: "candidates",
      nextCheck: "runInConsole",
    });
    expect(missing.gates.at(-1)?.reason).toBe("noElement");
    expect(missing.verdict.nextCheck).toBe("sendSupport");
  });

  it("does not call a jQuery-only selector broken: it is left open like code the check does not run (N5)", async () => {
    const run = probe();

    const result = await diagnoseElementNotFound(
      files((all) => {
        (tooltip(all).element as Rec).pickedSelector =
          'button:contains("Save"):visible';
      }),
      { kind: "tooltip", query: "Lead source help" },
      run,
    );

    expect(run).not.toHaveBeenCalled();
    expect(result.gates.find((g) => g.id === "element")).toMatchObject({
      status: "unknown",
      reason: "jquerySyntax",
    });
    expect(result.verdict.causes).toEqual([]);
    expect(result.verdict.nextCheck).toBe("runInConsole");
  });

  it("finds a hand-written selector that only matches inside a frame, and a frame path at the wrong depth", async () => {
    const selector = 'select[name="lead_source"]';
    const handWritten = await diagnoseElementNotFound(
      files(),
      { kind: "tooltip", query: "Lead source help" },
      probe({ [selector]: [top(test(0)), child(test(1))] }),
    );
    const wrongDepth = await diagnoseElementNotFound(
      files((all) => {
        (tooltip(all).element as Rec).iframesPath = ["iframe#main"];
      }),
      { kind: "tooltip", query: "Lead source help" },
      probe({ [selector]: [top(test(0)), child(test(0)), child(test(1), 2)] }),
    );

    expect(handWritten.verdict.causes[0]).toMatchObject({
      ruleId: "SEL-05",
      cardPageId: "1496612922",
    });
    expect(wrongDepth.verdict.causes[0]).toMatchObject({
      ruleId: "SEL-12",
      params: { depth: 1, found: 2 },
    });
  });

  it("counts only the frame its frame path leads to, not every frame at that depth (N3)", async () => {
    const selector = 'select[name="lead_source"]';
    const probed = probe({
      [selector]: [
        top(test(0)),
        child(test(1, { onFramePath: false })),
        child(test(0, { onFramePath: true })),
      ],
    });
    const result = await diagnoseElementNotFound(
      files((all) => {
        (tooltip(all).element as Rec).iframesPath = ["iframe#main"];
      }),
      { kind: "tooltip", query: "Lead source help" },
      probed,
    );

    expect(probed.mock.calls[0]?.[0]).toMatchObject({
      framePath: ["iframe#main"],
    });
    expect(result.verdict.causes[0]).toMatchObject({
      ruleId: "SEL-12",
      params: { variant: "otherFrame", count: 1 },
    });
    expect(result.gates.find((g) => g.id === "lookup")?.reason).toBe(
      "framePathOther",
    );
  });

  it("finds an element behind a shadow root the lookup does not enter, and a host selector that finds no open root", async () => {
    const selector = 'select[name="lead_source"]';
    const unrouted = await diagnoseElementNotFound(
      files(),
      { kind: "tooltip", query: "Lead source help" },
      probe({ [selector]: [top(test(0, { shadowMatches: 2 }))] }),
    );
    const broken = await diagnoseElementNotFound(
      files((all) => {
        (tooltip(all).element as Rec).shadowRootSelectors = ["x-form"];
      }),
      { kind: "tooltip", query: "Lead source help" },
      probe({ [selector]: [top(test(0, { brokenHostIndex: 0 }))] }),
    );

    expect(unrouted.verdict.causes[0]).toMatchObject({
      ruleId: "SEL-06",
      cardPageId: "1496973357",
      params: { count: 2 },
    });
    expect(broken.gates.find((g) => g.id === "lookup")).toMatchObject({
      reason: "brokenShadowHost",
      params: { index: 1, total: 1 },
    });
  });

  it("leaves it open when nothing matched but a frame did not answer", async () => {
    const result = await diagnoseElementNotFound(
      files(),
      { kind: "tooltip", query: "Lead source help" },
      probe({ 'select[name="lead_source"]': [top(test(0)), child(undefined)] }),
    );

    expect(result.verdict.status).toBe("candidates");
    expect(result.gates.find((g) => g.id === "lookup")).toMatchObject({
      status: "unknown",
      reason: "framesSilent",
      params: { silent: 1 },
    });
  });

  it("puts a generated-looking value first when nothing matches, and only flags it when the selector still works", async () => {
    const withId = (all: Record<string, Rec[]>) => {
      Object.assign(tooltip(all).element as Rec, {
        pickedSelector: "#lead-source-4711",
      });
    };
    const broken = await diagnoseElementNotFound(
      files(withId),
      { kind: "tooltip", query: "Lead source help" },
      probe(),
    );
    const working = await diagnoseElementNotFound(
      files(withId),
      { kind: "tooltip", query: "Lead source help" },
      probe({ "#lead-source-4711": [top(test(1))] }),
    );

    expect(broken.verdict.causes.map((c) => c.ruleId)).toEqual([
      "SEL-11",
      "SEL-07",
    ]);
    expect(broken.verdict.causes[0]?.cardPageId).toBe("1496875045");
    expect(working.verdict).toMatchObject({
      status: "candidates",
      nextCheck: "reloadAndRetest",
    });
  });

  it("names a selector that does not parse, and an element outside the visible page", async () => {
    const selector = 'select[name="lead_source"]';
    const invalid = await diagnoseElementNotFound(
      files(),
      { kind: "tooltip", query: "Lead source help" },
      probe({ [selector]: [top(test(0, { invalid: true }))] }),
    );
    const below = await diagnoseElementNotFound(
      files(),
      { kind: "tooltip", query: "Lead source help" },
      probe({
        [selector]: [
          top(test(1, { chosen: { rendered: true, inViewport: false } })),
        ],
      }),
    );

    expect(invalid.verdict.causes[0]?.ruleId).toBe("SEL-04");
    expect(below.verdict.causes[0]).toMatchObject({
      ruleId: "SEL-10",
      cardPageId: "1496253303",
    });
  });

  it("says why it could not run when no web page is open in the tab", async () => {
    const result = await diagnoseElementNotFound(
      files(),
      { kind: "tooltip", query: "Lead source help" },
      async () => ({ ok: false, reason: "no-page" }),
    );

    expect(result.verdict).toMatchObject({
      status: "candidates",
      nextCheck: "openItemPage",
    });
  });

  describe("workflows", () => {
    const withSteps = () => {
      const evidence = files();
      evidence.observedNames.push(TOUR_FILE);
      evidence.files[TOUR_FILE] = {
        name: TOUR_FILE,
        status: "ok",
        httpStatus: 200,
        json: tourSteps,
      };
      return evidence;
    };

    it("finds the steps' file by the workflow's id, and asks to play the workflow when it is not loaded", async () => {
      expect(stepFileFor(withSteps(), "Take a tour")).toBe(TOUR_FILE);

      const result = await diagnoseElementNotFound(
        files(),
        { kind: "workflow", query: "Take a tour" },
        probe(),
      );

      expect(result.verdict).toMatchObject({
        status: "candidates",
        nextCheck: "playWorkflow",
      });
    });

    it("reports steps that match nothing here as information unless the step is named", async () => {
      const run = probe({ "#tour-start": [top(test(1))] });

      const all = await diagnoseElementNotFound(
        withSteps(),
        { kind: "workflow", query: "Take a tour" },
        run,
      );
      const named = await diagnoseElementNotFound(
        withSteps(),
        { kind: "workflow", query: "Take a tour", step: 2 },
        run,
      );

      expect(all.verdict).toMatchObject({
        status: "candidates",
        nextCheck: "nameStep",
      });
      expect(
        all.gates
          .filter((g) => g.reason === "noMatchHere")
          .map((g) => g.params.n),
      ).toEqual([2, 3]);
      expect(named.verdict.causes[0]).toMatchObject({
        ruleId: "SEL-07",
        cardPageId: "1496351578",
        params: { part: "step", n: 2 },
      });
    });

    it("names a step the file does not have", async () => {
      const result = await diagnoseElementNotFound(
        withSteps(),
        { kind: "workflow", query: "Take a tour", step: 9 },
        probe(),
      );

      expect(result.gates.at(-1)).toMatchObject({
        reason: "stepNotFound",
        params: { count: 3, step: 9 },
      });
    });
  });

  it("stops before any lookup for a kind with no element, an unpublished item or several matches", async () => {
    const run = probe();
    const announcement = await diagnoseElementNotFound(
      files(),
      { kind: "announcement", query: "x" },
      run,
    );
    const missing = await diagnoseElementNotFound(
      files(),
      { kind: "tooltip", query: "No such tooltip" },
      run,
    );
    const several = await diagnoseElementNotFound(
      files(),
      { kind: "workflow", query: "lead" },
      run,
    );

    expect(run).not.toHaveBeenCalled();
    expect(announcement.verdict.status).toBe("out_of_scope");
    expect(missing.gates.at(-1)?.reason).toBe("notPublished");
    expect(several.subject.matched).toHaveLength(2);
  });

  it("names a Client it cannot reach", async () => {
    const result = await diagnoseElementNotFound(
      {
        connection: { ok: false, failure: "not_configured", message: "No ID" },
        observedNames: [],
        files: {},
      },
      { kind: "tooltip", query: "Lead source help" },
      probe(),
    );

    expect(result.verdict).toMatchObject({
      status: "no_data",
      nextCheck: "fixConnection",
    });
  });
});
