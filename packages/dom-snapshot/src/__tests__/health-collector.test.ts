import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetDomHealthRegistryForTests,
  collectDomHealthSnapshot,
} from "../health-collector";

function setHtml(html: string) {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = "";
  __resetDomHealthRegistryForTests();
});

describe("collectDomHealthSnapshot — element counts", () => {
  it("counts elements and classifies interactive elements", () => {
    setHtml(`
      <div>
        <button id="submit">Submit</button>
        <input type="text" />
        <select><option>1</option></select>
        <textarea></textarea>
        <a href="/next">Next</a>
        <a>Not a link (no href)</a>
        <form></form>
        <div contenteditable="true"></div>
        <span role="button">Custom button</span>
      </div>
    `);

    const snapshot = collectDomHealthSnapshot(document);

    expect(snapshot.counts.buttons).toBe(1);
    expect(snapshot.counts.inputs).toBe(1);
    expect(snapshot.counts.selects).toBe(1);
    expect(snapshot.counts.textareas).toBe(1);
    expect(snapshot.counts.links).toBe(1);
    expect(snapshot.counts.forms).toBe(1);
    expect(snapshot.counts.contentEditable).toBe(1);
    // button, input, select, textarea, a[href], contenteditable div, role=button span
    expect(snapshot.counts.interactiveElements).toBe(7);
    expect(snapshot.elementUniverse.interactiveElements).toBe(7);
  });

  it("never collects input values, only attribute signals", () => {
    setHtml(
      `<input id="password-field" type="password" value="super-secret" data-testid="pw" />`,
    );

    const snapshot = collectDomHealthSnapshot(document);
    const el = snapshot.elementReports.find(
      (e) => e.attributes.id === "password-field",
    );

    expect(el).toBeDefined();
    expect(el?.attributes.dataAttributes.testid).toBe("pw");
    expect(JSON.stringify(el)).not.toContain("super-secret");
  });

  it("bounds the analyzed-element sample without under-counting totals", () => {
    const buttons = Array.from(
      { length: 10 },
      (_, i) => `<button id="btn-${i}">${i}</button>`,
    ).join("");
    setHtml(buttons);

    const snapshot = collectDomHealthSnapshot(document, {
      maxInteractiveElements: 3,
    });

    expect(snapshot.counts.interactiveElements).toBe(10);
    expect(snapshot.elementReports).toHaveLength(3);
  });
});

describe("collectDomHealthSnapshot — selector resolution", () => {
  it("resolves a uniquely-identified element directly", () => {
    setHtml(`<button id="save-button">Save</button>`);
    const snapshot = collectDomHealthSnapshot(document);

    expect(snapshot.selectorAnalysis.directSuccess).toBe(1);
    const report = snapshot.elementReports[0]!;
    expect(report.outcome).toBe("DIRECT_SUCCESS");
    expect(report.bestSelector).toBe("#save-button");
  });

  it("does NOT count a shared, non-unique id/class as a successful selector", () => {
    const rows = Array.from(
      { length: 20 },
      () => `<button id="row" class="item">Row</button>`,
    ).join("");
    setHtml(rows);

    const snapshot = collectDomHealthSnapshot(document);

    expect(snapshot.selectorAnalysis.directSuccess).toBe(0);
    // Every element is structurally identical with no unique attribute of
    // its own, so recovery must fall back to a positional path, not be
    // silently counted as a direct/ignore/partial success.
    expect(snapshot.selectorAnalysis.positionalOnly).toBeGreaterThan(0);
  });

  it("recovers via a stable partial-attribute prefix when the id is dynamic", () => {
    setHtml(`<button id="app-wrapper-4f9a21">Save</button>`);
    const snapshot = collectDomHealthSnapshot(document);

    const report = snapshot.elementReports[0]!;
    expect(report.outcome).toBe("RECOVERED_BY_PARTIAL");
    expect(report.bestSelector).toContain("app-wrapper");
  });

  it("recovers via ancestor context when the element itself has no stable attribute", () => {
    setHtml(`
      <div id="toolbar">
        <button>A</button>
        <button>B</button>
      </div>
    `);
    const snapshot = collectDomHealthSnapshot(document);

    for (const report of snapshot.elementReports) {
      expect(["RECOVERED_BY_CONTEXT", "POSITIONAL_ONLY"]).toContain(
        report.outcome,
      );
    }
  });
});

describe("collectDomHealthSnapshot — cross-snapshot stability", () => {
  it("marks a selector STABLE when re-verified against the same live element", () => {
    setHtml(`<button id="stable-btn">Go</button>`);
    collectDomHealthSnapshot(document, { freshAudit: true });
    const second = collectDomHealthSnapshot(document, { freshAudit: false });

    expect(second.elementReports[0]!.stability).toBe("STABLE");
    expect(second.stability.stable).toBe(1);
  });

  it("marks a selector UNSTABLE when the same element's id changes between snapshots", () => {
    // Both values individually "look" stable to the single-observation
    // heuristic (no digit/hash suffix) — only comparing the same live
    // element across snapshots reveals the id actually changed.
    setHtml(`<button id="btn-alpha">Go</button>`);
    collectDomHealthSnapshot(document, { freshAudit: true });

    document.querySelector("button")!.id = "btn-beta";
    const second = collectDomHealthSnapshot(document, { freshAudit: false });

    expect(second.elementReports[0]!.stability).toBe("UNSTABLE");
    expect(second.dynamicAttributes.idsChangedAcrossSnapshots).toBe(1);
  });

  it("reports UNKNOWN stability on the first snapshot of a fresh audit", () => {
    setHtml(`<button id="btn">Go</button>`);
    const snapshot = collectDomHealthSnapshot(document, { freshAudit: true });

    expect(snapshot.elementReports[0]!.stability).toBe("UNKNOWN");
    expect(snapshot.dynamicAttributes.hasMultiSnapshotEvidence).toBe(false);
  });
});

describe("collectDomHealthSnapshot — iframes", () => {
  it("traverses an accessible same-origin iframe", () => {
    setHtml(`<iframe id="frame"></iframe>`);
    const iframe = document.getElementById("frame") as HTMLIFrameElement;
    iframe.contentDocument!.body.innerHTML = `<button>Inside frame</button>`;

    const snapshot = collectDomHealthSnapshot(document);

    expect(snapshot.iframes.total).toBe(1);
    expect(snapshot.iframes.accessible).toBe(1);
    expect(snapshot.iframes.crossOrigin).toBe(0);
    expect(snapshot.counts.buttons).toBe(1);
  });

  it("reports a cross-origin iframe as an accessibility boundary, not a defect", () => {
    setHtml(`<iframe id="frame"></iframe>`);
    const iframe = document.getElementById("frame") as HTMLIFrameElement;
    Object.defineProperty(iframe, "contentDocument", {
      get() {
        throw new Error(
          "Blocked a frame with origin from accessing a cross-origin frame",
        );
      },
    });

    expect(() => collectDomHealthSnapshot(document)).not.toThrow();
    const snapshot = collectDomHealthSnapshot(document);

    expect(snapshot.iframes.total).toBe(1);
    expect(snapshot.iframes.accessible).toBe(0);
    expect(snapshot.iframes.crossOrigin).toBe(1);
    expect(snapshot.elementUniverse.inaccessibleElements).toBeGreaterThan(0);
  });
});

describe("collectDomHealthSnapshot — Shadow DOM", () => {
  it("traverses an open shadow root", () => {
    setHtml(`<div id="host"></div>`);
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<button>Shadow button</button><span>text</span>`;

    const snapshot = collectDomHealthSnapshot(document);

    expect(snapshot.shadowDom.roots).toBe(1);
    expect(snapshot.shadowDom.elements).toBe(2);
    expect(snapshot.counts.buttons).toBe(1);
  });

  it("does not (and cannot) traverse a closed shadow root", () => {
    setHtml(`<div id="host"></div>`);
    const host = document.getElementById("host")!;
    host.attachShadow({ mode: "closed" });

    const snapshot = collectDomHealthSnapshot(document);

    expect(snapshot.shadowDom.roots).toBe(0);
  });
});

describe("collectDomHealthSnapshot — z-index", () => {
  it("records the maximum z-index among positioned elements", () => {
    setHtml(`
      <div id="a" style="position: absolute; z-index: 10;"></div>
      <div id="b" style="position: fixed; z-index: 5000;"></div>
      <div id="c" style="z-index: 99999;"></div>
    `);

    const snapshot = collectDomHealthSnapshot(document);

    // "c" is not positioned (static), so its z-index does not apply.
    expect(snapshot.zIndex.maxZIndex).toBe(5000);
    expect(snapshot.zIndex.highZIndexElementCount).toBe(1);
  });

  it("bounds the number of style checks performed", () => {
    const divs = Array.from(
      { length: 5 },
      (_, i) =>
        `<div style="position: absolute; z-index: ${(i + 1) * 100};"></div>`,
    ).join("");
    setHtml(divs);

    const snapshot = collectDomHealthSnapshot(document, { maxStyleChecks: 2 });

    // Only the first 2 elements in document order get checked, so the
    // z-index of later (higher-value) elements must not be observed.
    expect(snapshot.zIndex.maxZIndex).toBe(200);
  });
});
