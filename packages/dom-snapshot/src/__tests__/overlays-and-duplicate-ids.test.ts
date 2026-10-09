import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDomHealthRegistryForTests,
  collectDomHealthSnapshot,
} from "../health-collector";
import { hitTestElement } from "../health-hit-test";
import { computeFrameStateSignature } from "../health-state-signature";
import {
  DEFAULT_IGNORED_ROOTS,
  findIgnoredRoots,
  ignoredRootPolicy,
  parseIgnoredRootMatcher,
} from "../ignored-roots";
import { loadErpFixture } from "./fixtures/erp/load-fixture";
import { ATHENA, INFOR } from "./fixtures/erp/values";

beforeEach(() => {
  __resetDomHealthRegistryForTests();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ignored roots (D-6)", () => {
  it("excludes athenaOne's Pendo badges from the audit, and counts what it excluded", async () => {
    loadErpFixture("athena-forge-panel");

    const snapshot = await collectDomHealthSnapshot(document);

    expect(snapshot.excludedRoots).toEqual([
      {
        matcher: "id:_pendo-",
        owner: "Pendo",
        evidence: "measured",
        roots: 2,
        elementCount: 4,
      },
    ]);
    const reportedIds = snapshot.elementReports.map((r) => r.attributes.id);
    for (const pendoId of ATHENA.pendoIds) {
      expect(reportedIds).not.toContain(pendoId);
    }
  });

  it("counts an ignored root once, at its outermost match, with its shadow content", () => {
    document.body.innerHTML =
      '<div id="walkme-player"><div class="walkme-menu"><x-step></x-step></div></div><main></main>';
    document.querySelector("x-step")!.attachShadow({ mode: "open" }).innerHTML =
      "<button>Next</button>";

    const { summary } = findIgnoredRoots(document, DEFAULT_IGNORED_ROOTS);

    expect(summary).toEqual([
      expect.objectContaining({
        matcher: "id:walkme-",
        roots: 1,
        elementCount: 4,
      }),
    ]);
  });

  it("adds Settings entries to the defaults and skips entries that are not matchers", async () => {
    document.body.innerHTML =
      '<acme-assist><button>Help</button></acme-assist><button id="save">Save</button>';

    expect(parseIgnoredRootMatcher("tag: acme-assist")).toMatchObject({
      kind: "tag",
      value: "acme-assist",
      evidence: "user",
    });
    expect(ignoredRootPolicy(["not a matcher", "id:"])).toHaveLength(
      DEFAULT_IGNORED_ROOTS.length,
    );
    const snapshot = await collectDomHealthSnapshot(document, {
      ignoredRoots: ["tag:acme-assist"],
    });

    expect(snapshot.elementReports.map((r) => r.attributes.id)).toEqual([
      "save",
    ]);
    expect(snapshot.excludedRoots[0]).toMatchObject({
      matcher: "tag:acme-assist",
      elementCount: 2,
    });
  });

  it("keeps overlay headings and navigation out of the state signature", () => {
    document.body.innerHTML = "<main><h1>Orders</h1></main>";
    const before = computeFrameStateSignature(document);

    document.body.insertAdjacentHTML(
      "afterbegin",
      '<div id="_pendo-guide-container"><h1>What\'s new</h1><nav><a aria-current="page">Tour</a></nav></div>',
    );

    expect(computeFrameStateSignature(document)).toEqual(before);
  });

  it("looks past an overlay covering a control when hit testing", () => {
    document.body.innerHTML =
      '<button id="save">Save</button><button id="_pendo-badge_1">?</button>';
    const [save, badge] = Array.from(document.querySelectorAll("button"));
    vi.spyOn(save!, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 10,
      right: 110,
      bottom: 40,
      width: 100,
      height: 30,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect);
    const doc = document as Document & {
      elementFromPoint: (x: number, y: number) => Element | null;
      elementsFromPoint: (x: number, y: number) => Element[];
    };
    doc.elementFromPoint ??= () => null;
    doc.elementsFromPoint ??= () => [];
    vi.spyOn(doc, "elementFromPoint").mockReturnValue(badge!);
    vi.spyOn(doc, "elementsFromPoint").mockReturnValue([badge!, save!]);

    expect(hitTestElement(save!)?.classification).toBe("fully-occluded");
    expect(hitTestElement(save!, DEFAULT_IGNORED_ROOTS)?.classification).toBe(
      "fully-targetable",
    );
  });
});

describe("duplicate ids, scoped per root (D-8)", () => {
  it("finds the Infor LN portal's duplicated ids: 9 within a root, 15 page-wide", async () => {
    loadErpFixture("infor-portal-workspace");

    const { duplicateIds } = await collectDomHealthSnapshot(document);

    expect(duplicateIds.valuesDuplicatedWithinARoot).toBe(
      INFOR.measured.duplicateIdValuesWithinARoot,
    );
    expect(duplicateIds.valuesDuplicatedPageWide).toBe(
      INFOR.measured.duplicateIdValuesPageWide,
    );
  });

  it("does not select by an id two elements in the same root share", async () => {
    document.body.innerHTML =
      '<button id="save" name="header-save">Save</button><button id="save" name="footer-save">Save</button>';

    const snapshot = await collectDomHealthSnapshot(document);

    expect(snapshot.duplicateIds).toMatchObject({
      valuesDuplicatedWithinARoot: 1,
      elementsWithDuplicatedId: 2,
    });
    for (const report of snapshot.elementReports) {
      expect(report.bestSelector).not.toMatch(/id="save"|#save/);
      expect(report.winningAttribute).not.toBe("id");
      expect(report.outcome).not.toBe("WRONG_TARGET");
    }
  });

  it("keeps using an id that repeats only across roots, since each root's ids are separate", async () => {
    document.body.innerHTML =
      '<button id="save">Save</button><x-panel></x-panel>';
    document
      .querySelector("x-panel")!
      .attachShadow({ mode: "open" }).innerHTML =
      '<button id="save">Save</button>';

    const snapshot = await collectDomHealthSnapshot(document);

    expect(snapshot.duplicateIds).toMatchObject({
      valuesDuplicatedWithinARoot: 0,
      valuesDuplicatedPageWide: 1,
    });
    for (const report of snapshot.elementReports) {
      expect(report.bestSelector).toMatch(/\[id="save"\]$/);
    }
  });
});
