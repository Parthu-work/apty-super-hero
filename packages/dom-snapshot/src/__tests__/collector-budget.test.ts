import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetDomHealthRegistryForTests,
  collectDomHealthSnapshot,
  DEFAULT_COLLECTOR_BUDGET,
} from "../health-collector";
import { INFOR } from "./fixtures/erp/values";

/**
 * A page of the Infor LN portal's shape at its measured size: 251 open
 * shadow roots nested up to 3 deep, a slot in each, and a control slotted
 * into every one (the LN export: 251 roots, nesting depth 3, 358 slots).
 */
function lnShapedPage(): void {
  document.body.innerHTML = "";
  let made = 0;
  const mount = (parent: Element | ShadowRoot, depth: number) => {
    const host = document.createElement("ids-panel");
    host.innerHTML = `<button class="ids-button" aria-label="Action ${made}">Action</button>`;
    parent.append(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<div part="container"><slot></slot></div>';
    made++;
    if (
      depth < INFOR.measured.maxShadowNesting &&
      made < INFOR.measured.openShadowRoots
    ) {
      mount(root.firstElementChild!, depth + 1);
    }
  };
  while (made < INFOR.measured.openShadowRoots) mount(document.body, 1);
}

beforeEach(() => {
  __resetDomHealthRegistryForTests();
  document.body.innerHTML = "";
});

describe("collector budget (brief section 4.11)", () => {
  it("audits a 251-shadow-root page inside the time budget, yielding to the page as it goes", async () => {
    lnShapedPage();

    const snapshot = await collectDomHealthSnapshot(document);

    expect(snapshot.shadowDom.roots).toBe(251);
    expect(snapshot.performance.partialReasons).toEqual([]);
    expect(snapshot.performance.timings.totalMs).toBeLessThan(
      DEFAULT_COLLECTOR_BUDGET.timeBudgetMs,
    );
    expect(snapshot.performance.yields).toBeGreaterThan(0);
    // The clock is read between steps (one element, one root), so a slice
    // can only overrun the configured length by the step that crossed it.
    expect(snapshot.performance.longestSliceMs).toBeLessThanOrEqual(
      DEFAULT_COLLECTOR_BUDGET.sliceMs + snapshot.performance.longestStepMs + 1,
    );
  });

  it("stops at the time budget and labels the result partial instead of returning nothing", async () => {
    lnShapedPage();

    const snapshot = await collectDomHealthSnapshot(document, {
      timeBudgetMs: 0,
    });

    expect(snapshot.performance.partialReasons).toEqual([
      "Time budget of 0 ms reached; the rest of this frame was not analyzed.",
    ]);
    expect(snapshot.analysisCoverage).toMatchObject({
      candidatesAnalyzed: 0,
      capped: true,
      capReason:
        "Time budget of 0 ms reached; the rest of this frame was not analyzed.",
    });
  });

  it("reports when an element or shadow-root ceiling cut the frame short", async () => {
    lnShapedPage();

    const snapshot = await collectDomHealthSnapshot(document, {
      maxTotalElements: 40,
      maxShadowRoots: 5,
    });

    expect(snapshot.counts.totalElements).toBeLessThanOrEqual(40);
    expect(snapshot.shadowDom.roots).toBeLessThanOrEqual(5);
    expect(snapshot.performance.partialReasons).toEqual(
      expect.arrayContaining([
        "Shadow-root ceiling of 5 reached; roots after it were not entered.",
      ]),
    );
    expect(snapshot.analysisCoverage.capReason).toContain("ceiling");
  });
});
