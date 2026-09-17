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
  it("counts elements and classifies interactive elements", async () => {
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

    const snapshot = await collectDomHealthSnapshot(document);

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

  it("never collects input values, only attribute signals", async () => {
    setHtml(
      `<input id="password-field" type="password" value="super-secret" data-testid="pw" />`,
    );

    const snapshot = await collectDomHealthSnapshot(document);
    const el = snapshot.elementReports.find(
      (e) => e.attributes.id === "password-field",
    );

    expect(el).toBeDefined();
    expect(el?.attributes.dataAttributes.testid).toBe("pw");
    expect(JSON.stringify(el)).not.toContain("super-secret");
  });

  it("analyzes the full interactive-element universe by default, without an arbitrary sample cap", async () => {
    const buttons = Array.from(
      { length: 400 },
      (_, i) => `<button id="btn-${i}">${i}</button>`,
    ).join("");
    setHtml(buttons);

    const snapshot = await collectDomHealthSnapshot(document);

    expect(snapshot.counts.interactiveElements).toBe(400);
    expect(snapshot.elementReports).toHaveLength(400);
    expect(snapshot.analysisCoverage.capped).toBe(false);
    expect(snapshot.analysisCoverage.candidatesFound).toBe(400);
    expect(snapshot.analysisCoverage.candidatesAnalyzed).toBe(400);
  });

  it("reports an explicit, honest cap when the runaway-safety ceiling is configured low and hit", async () => {
    const buttons = Array.from(
      { length: 10 },
      (_, i) => `<button id="btn-${i}">${i}</button>`,
    ).join("");
    setHtml(buttons);

    const snapshot = await collectDomHealthSnapshot(document, {
      maxInteractiveElements: 3,
    });

    expect(snapshot.counts.interactiveElements).toBe(10);
    expect(snapshot.elementReports).toHaveLength(3);
    expect(snapshot.analysisCoverage.capped).toBe(true);
    expect(snapshot.analysisCoverage.capReason).toMatch(/ceiling/i);
  });
});

describe("collectDomHealthSnapshot — selector resolution", () => {
  it("resolves a uniquely-identified element directly", async () => {
    setHtml(`<button id="save-button">Save</button>`);
    const snapshot = await collectDomHealthSnapshot(document);

    expect(snapshot.selectorAnalysis.directSuccess).toBe(1);
    const report = snapshot.elementReports[0]!;
    expect(report.outcome).toBe("DIRECT_SUCCESS");
    expect(report.bestSelector).toBe("#save-button");
    expect(report.winningAttribute).toBe("id");
  });

  it("does NOT count a shared, non-unique id/class as a successful selector", async () => {
    const rows = Array.from(
      { length: 20 },
      () => `<button id="row" class="item">Row</button>`,
    ).join("");
    setHtml(rows);

    const snapshot = await collectDomHealthSnapshot(document);

    expect(snapshot.selectorAnalysis.directSuccess).toBe(0);
    // Every element is structurally identical with no unique attribute of
    // its own, so recovery must fall back to a positional path, not be
    // silently counted as a direct/ignore/partial success.
    expect(snapshot.selectorAnalysis.positionalOnly).toBeGreaterThan(0);
  });

  it("recovers via a stable partial-attribute prefix when the id is dynamic", async () => {
    setHtml(`<button id="app-wrapper-4f9a21">Save</button>`);
    const snapshot = await collectDomHealthSnapshot(document);

    const report = snapshot.elementReports[0]!;
    expect(report.outcome).toBe("RECOVERED_BY_PARTIAL");
    expect(report.bestSelector).toContain("app-wrapper");
  });

  it("recovers via ancestor context when the element itself has no stable attribute", async () => {
    setHtml(`
      <div id="toolbar">
        <button>A</button>
        <button>B</button>
      </div>
    `);
    const snapshot = await collectDomHealthSnapshot(document);

    for (const report of snapshot.elementReports) {
      expect(["RECOVERED_BY_CONTEXT", "POSITIONAL_ONLY"]).toContain(
        report.outcome,
      );
    }
  });
});

describe("collectDomHealthSnapshot — cross-snapshot stability (logical fingerprint, not object identity)", () => {
  it("marks a selector STABLE when re-verified against the same live element", async () => {
    setHtml(`<button id="stable-btn">Go</button>`);
    await collectDomHealthSnapshot(document, { freshAudit: true });
    const second = await collectDomHealthSnapshot(document, {
      freshAudit: false,
    });

    expect(second.elementReports[0]!.stability).toBe("STABLE");
    expect(second.stability.stable).toBe(1);
  });

  it("still recognizes the same logical element after the DOM node object is replaced (fingerprint match)", async () => {
    setHtml(`<button id="save-button" name="save">Save</button>`);
    await collectDomHealthSnapshot(document, { freshAudit: true });

    // Simulate a framework rerender that discards and recreates the node —
    // same logical control (same tag/name/stable attrs), different object.
    document.body.innerHTML = `<button id="save-button" name="save">Save</button>`;
    const second = await collectDomHealthSnapshot(document, {
      freshAudit: false,
    });

    expect(second.elementReports[0]!.stability).toBe("STABLE");
    expect(second.stability.nodeReplacedButLogicallyStable).toBe(1);
  });

  it("marks a selector CHANGED when the same logical element's selector breaks between snapshots", async () => {
    // Both values individually "look" stable to the single-observation
    // heuristic (no digit/hash suffix) — only comparing the same logical
    // element across snapshots reveals the id actually changed.
    setHtml(`<button id="btn-alpha" name="go">Go</button>`);
    await collectDomHealthSnapshot(document, { freshAudit: true });

    document.querySelector("button")!.id = "btn-beta";
    const second = await collectDomHealthSnapshot(document, {
      freshAudit: false,
    });

    expect(second.elementReports[0]!.stability).toBe("CHANGED");
    expect(second.dynamicAttributes.idsChangedAcrossSnapshots).toBe(1);
  });

  it("marks a newly-appeared logical element as NEW rather than STABLE/CHANGED", async () => {
    setHtml(`<button id="existing" name="existing">A</button>`);
    await collectDomHealthSnapshot(document, { freshAudit: true });

    document.body.innerHTML += `<button id="added" name="added">B</button>`;
    const second = await collectDomHealthSnapshot(document, {
      freshAudit: false,
    });

    const added = second.elementReports.find(
      (r) => r.attributes.id === "added",
    );
    expect(added?.stability).toBe("NEW");
  });

  it("counts a logical element that disappears entirely as DETACHED", async () => {
    setHtml(`
      <button id="stays" name="stays">A</button>
      <button id="leaves" name="leaves">B</button>
    `);
    await collectDomHealthSnapshot(document, { freshAudit: true });

    setHtml(`<button id="stays" name="stays">A</button>`);
    const second = await collectDomHealthSnapshot(document, {
      freshAudit: false,
    });

    expect(second.stability.detached).toBe(1);
  });

  it("reports UNKNOWN stability on the first snapshot of a fresh audit", async () => {
    setHtml(`<button id="btn">Go</button>`);
    const snapshot = await collectDomHealthSnapshot(document, {
      freshAudit: true,
    });

    expect(snapshot.elementReports[0]!.stability).toBe("UNKNOWN");
    expect(snapshot.dynamicAttributes.hasMultiSnapshotEvidence).toBe(false);
  });
});

describe("collectDomHealthSnapshot — iframes", () => {
  it("traverses an accessible same-origin iframe", async () => {
    setHtml(`<iframe id="frame"></iframe>`);
    const iframe = document.getElementById("frame") as HTMLIFrameElement;
    iframe.contentDocument!.body.innerHTML = `<button>Inside frame</button>`;

    const snapshot = await collectDomHealthSnapshot(document);

    expect(snapshot.iframes.total).toBe(1);
    expect(snapshot.iframes.accessible).toBe(1);
    expect(snapshot.iframes.crossOrigin).toBe(0);
    expect(snapshot.counts.buttons).toBe(1);
  });

  it("reports a cross-origin iframe as an accessibility boundary, not a defect", async () => {
    setHtml(`<iframe id="frame"></iframe>`);
    const iframe = document.getElementById("frame") as HTMLIFrameElement;
    Object.defineProperty(iframe, "contentDocument", {
      get() {
        throw new Error(
          "Blocked a frame with origin from accessing a cross-origin frame",
        );
      },
    });

    const snapshot = await collectDomHealthSnapshot(document);

    expect(snapshot.iframes.total).toBe(1);
    expect(snapshot.iframes.accessible).toBe(0);
    expect(snapshot.iframes.crossOrigin).toBe(1);
    expect(snapshot.elementUniverse.inaccessibleElements).toBeGreaterThan(0);
  });
});

describe("collectDomHealthSnapshot — Shadow DOM", () => {
  it("traverses an open shadow root", async () => {
    setHtml(`<div id="host"></div>`);
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<button>Shadow button</button><span>text</span>`;

    const snapshot = await collectDomHealthSnapshot(document);

    expect(snapshot.shadowDom.roots).toBe(1);
    expect(snapshot.shadowDom.elements).toBe(2);
    expect(snapshot.counts.buttons).toBe(1);
  });

  it("does not (and cannot) traverse a closed shadow root", async () => {
    setHtml(`<div id="host"></div>`);
    const host = document.getElementById("host")!;
    host.attachShadow({ mode: "closed" });

    const snapshot = await collectDomHealthSnapshot(document);

    expect(snapshot.shadowDom.roots).toBe(0);
  });
});

describe("collectDomHealthSnapshot — z-index", () => {
  it("records the maximum z-index among positioned elements", async () => {
    setHtml(`
      <div id="a" style="position: absolute; z-index: 10;"></div>
      <div id="b" style="position: fixed; z-index: 5000;"></div>
      <div id="c" style="z-index: 99999;"></div>
    `);

    const snapshot = await collectDomHealthSnapshot(document);

    // "c" is not positioned (static), so its z-index does not apply.
    expect(snapshot.zIndex.maxZIndex).toBe(5000);
    expect(snapshot.zIndex.highZIndexElementCount).toBe(1);
  });

  it("bounds the number of style checks performed", async () => {
    const divs = Array.from(
      { length: 5 },
      (_, i) =>
        `<div style="position: absolute; z-index: ${(i + 1) * 100};"></div>`,
    ).join("");
    setHtml(divs);

    const snapshot = await collectDomHealthSnapshot(document, {
      maxStyleChecks: 2,
    });

    // Only the first 2 elements in document order get checked, so the
    // z-index of later (higher-value) elements must not be observed.
    expect(snapshot.zIndex.maxZIndex).toBe(200);
  });
});
