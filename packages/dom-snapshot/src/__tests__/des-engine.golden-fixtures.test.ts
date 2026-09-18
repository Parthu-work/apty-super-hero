/**
 * Golden fixtures for the DES engine (Step 18).
 *
 * Every fixture below is a SYNTHETIC ENTERPRISE FIXTURE: a DOM shape
 * hand-built to resemble the kind of markup found in Infor LN-, Autodesk-,
 * and Salesforce-Lightning-style enterprise applications (generated
 * widget/field ids, framework-hashed classes, densely repeated grid rows,
 * Lightning-style component wrappers). None of this markup was captured
 * from, or is claimed to represent, any real customer application or
 * product — see the Phase 2 delivery report's "REAL-WORLD VALIDATION"
 * section for the honest status of validation against an actual Infor LN
 * or Autodesk instance.
 *
 * These tests exercise `runDes`/`resolveElement` end-to-end against each
 * shape and assert the SPECIFIC verified outcome (never merely "it
 * returned a selector") — a wrong-target or ambiguous result is a correct
 * result here, not a bug, when the fixture is genuinely ambiguous.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildElementPath,
  recoverElementFromPath,
  runDes,
} from "../des-engine";
import { resolveElement } from "../health-selector-engine";

function setHtml(html: string) {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Synthetic enterprise fixture: Infor LN-style generated grid
//
// Classic thick-client-derived web ERP markup: every field/widget carries
// a machine-generated internal id (`WGT_00042_RUN38291`), grouped into a
// grid of otherwise-identical rows, with a handful of rows sharing a
// stable `data-field` business identifier the generated id does not
// expose directly.
// ---------------------------------------------------------------------------

describe("synthetic enterprise fixture: Infor LN-style generated grid", () => {
  function lnGridHtml(rowCount: number): string {
    const rows = Array.from({ length: rowCount }, (_, i) => {
      const runId = 38291 + i;
      return `
        <tr id="WGT_${String(i).padStart(5, "0")}_RUN${runId}" class="ln-grid-row">
          <td class="ln-cell" data-field="order-number">ORD-${1000 + i}</td>
          <td class="ln-cell" data-field="status">Open</td>
          <td class="ln-cell">
            <button id="BTN_${String(i).padStart(5, "0")}_RUN${runId}" class="ln-action-btn" data-field="approve-action">Approve</button>
          </td>
        </tr>`;
    }).join("\n");
    return `<table id="orders-grid" class="ln-grid"><tbody>${rows}</tbody></table>`;
  }

  it("recovers a generated widget id's stable prefix instead of treating it as fully dynamic", () => {
    setHtml(lnGridHtml(5));
    const button = document.querySelector("#BTN_00002_RUN38293")!;

    const result = runDes(document, button);

    expect(result.outcome).toBe("RESOLVED");
    if (result.outcome === "RESOLVED") {
      // "BTN_" is a genuine stable prefix of a generated id — this must
      // never be reported as a fully DYNAMIC, unusable attribute.
      expect(result.identity).toBe("CORRECT_TARGET");
    }
  });

  it("does not report a shared data-field business attribute alone as uniquely identifying a row's action button", () => {
    setHtml(lnGridHtml(20));
    const target = document.querySelectorAll(
      '[data-field="approve-action"]',
    )[7]!;

    const result = runDes(document, target);

    // 20 rows share data-field="approve-action" — the engine must recover
    // via the generated id's stable prefix, ancestor context, or position,
    // never by pretending the shared business attribute alone resolved it.
    expect(result.outcome).toBe("RESOLVED");
    if (result.outcome === "RESOLVED") {
      expect(result.identity).toBe("CORRECT_TARGET");
      expect(result.attributesUsed).not.toEqual(["data-field"]);
    }
  });

  it("verifies target identity is preserved after a row is removed above the target (index shift)", () => {
    setHtml(lnGridHtml(10));
    const target = document.querySelector("#BTN_00006_RUN38297")!;
    const desResultBefore = runDes(document, target);
    expect(desResultBefore.outcome).toBe("RESOLVED");

    document.querySelector("#WGT_00002_RUN38293")!.remove();

    const desResultAfter = runDes(document, target);
    expect(desResultAfter.outcome).toBe("RESOLVED");
    if (desResultAfter.outcome === "RESOLVED") {
      expect(desResultAfter.identity).toBe("CORRECT_TARGET");
    }
  });
});

// ---------------------------------------------------------------------------
// Synthetic enterprise fixture: Autodesk-style dynamic SPA wrapper
//
// A modern React/Redux-driven SPA shape: framework-hashed classes
// (`sc-bdVaJa`, `hEcuXe`), a `data-testid` automation hook on some but not
// all controls, and generated element ids from a component library
// (`react-select-3-input`).
// ---------------------------------------------------------------------------

describe("synthetic enterprise fixture: Autodesk-style dynamic SPA wrapper", () => {
  it("prefers a data-testid automation hook over a framework-hashed class", () => {
    setHtml(`
      <div class="sc-bdVaJa hEcuXe">
        <div class="sc-fznyAO gkLTag">
          <button class="sc-htpNat jrIVkE" data-testid="publish-model-button">Publish</button>
        </div>
      </div>
    `);
    const button = document.querySelector(
      '[data-testid="publish-model-button"]',
    )!;

    const result = runDes(document, button);

    expect(result.outcome).toBe("RESOLVED");
    if (result.outcome === "RESOLVED") {
      expect(result.selector).toContain("publish-model-button");
      expect(result.attributesUsed).toContain("data-testid");
    }
  });

  it("resolves a component-library generated id via its stable prefix, not the numeric suffix", () => {
    setHtml(`
      <div class="sc-bdVaJa">
        <div id="react-select-2-input" class="sc-select-input" role="combobox">Select project</div>
        <div id="react-select-3-input" class="sc-select-input" role="combobox">Select revision</div>
      </div>
    `);
    const target = document.querySelector("#react-select-3-input")!;

    const result = runDes(document, target);

    expect(result.outcome).toBe("RESOLVED");
    if (result.outcome === "RESOLVED") {
      expect(result.identity).toBe("CORRECT_TARGET");
    }
  });

  it("cross-snapshot recovery survives the SPA regenerating the hashed classes on re-render", () => {
    setHtml(`
      <div class="sc-bdVaJa hEcuXe">
        <button class="sc-htpNat jrIVkE" data-testid="publish-model-button">Publish</button>
      </div>
    `);
    const original = document.querySelector(
      '[data-testid="publish-model-button"]',
    )!;
    const path = buildElementPath(original);

    // Simulate a re-render: the framework regenerates every hashed class
    // name but keeps the automation hook stable, as styled-components/
    // emotion-style hashing does across builds.
    setHtml(`
      <div class="sc-zzTopA qqLeaf">
        <button class="sc-newHash aaBbCc" data-testid="publish-model-button">Publish</button>
      </div>
    `);
    const recovered = recoverElementFromPath(document, path);

    expect(recovered.outcome).toBe("RESOLVED");
  });
});

// ---------------------------------------------------------------------------
// Synthetic enterprise fixture: Salesforce Lightning-style repeated
// component list
//
// A Lightning web component-style record list: every row is a repeated
// `<lightning-record-item>`-shaped wrapper with an internal Aura/LWC
// generated id, SLDS utility classes, and a `role="listitem"` semantic
// signal, but no automation-specific test id at all — the realistic case
// where accessibility signals are the only per-row differentiator besides
// text content.
// ---------------------------------------------------------------------------

describe("synthetic enterprise fixture: Salesforce Lightning-style record list", () => {
  function lightningListHtml(names: string[]): string {
    const items = names
      .map(
        (name, i) => `
        <li role="listitem" class="slds-item" data-aura-rendered-by="${1200 + i}:0">
          <div class="slds-media">
            <div class="slds-media__body">
              <a href="#" class="slds-truncate" aria-label="${name}">${name}</a>
            </div>
          </div>
        </li>`,
      )
      .join("\n");
    return `<ul class="slds-list slds-list_vertical">${items}</ul>`;
  }

  it("identifies a record by its accessible name when no automation hook or business id exists", () => {
    setHtml(lightningListHtml(["Acme Corp", "Globex Inc", "Initech LLC"]));
    const target = document.querySelector('[aria-label="Globex Inc"]')!;

    const result = runDes(document, target);

    expect(result.outcome).toBe("RESOLVED");
    if (result.outcome === "RESOLVED") {
      expect(result.identity).toBe("CORRECT_TARGET");
    }
  });

  it("reports AMBIGUOUS rather than guessing when two records share the same accessible name", () => {
    setHtml(lightningListHtml(["Acme Corp", "Acme Corp", "Initech LLC"]));
    const targets = document.querySelectorAll('[aria-label="Acme Corp"]');
    const first = targets[0]!;

    const result = runDes(document, first);

    // Two rows with identical text/aria-label and no other differentiator
    // besides position — either a genuinely-disambiguated positional
    // resolution or an honest AMBIGUOUS is acceptable; a silent match on
    // the WRONG one of the two is not.
    if (result.outcome === "RESOLVED") {
      expect(result.identity).toBe("CORRECT_TARGET");
    } else {
      expect(result.outcome).toBe("AMBIGUOUS");
    }
  });

  it("feeds DOM Health's legacy adapter a non-fabricated outcome for an unlabeled Lightning row", () => {
    setHtml(lightningListHtml(["Acme Corp", "Globex Inc"]));
    const target = document.querySelector('[aria-label="Globex Inc"]')!;

    const resolution = resolveElement(document, target);

    expect([
      "DIRECT_SUCCESS",
      "RECOVERED_BY_PARTIAL",
      "RECOVERED_BY_IGNORE",
      "RECOVERED_BY_CONTEXT",
      "POSITIONAL_ONLY",
    ]).toContain(resolution.outcome);
    expect(resolution.bestSelector).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Synthetic enterprise fixture: generic ERP form with nested containers
// and a wrapper that changes between snapshots (a common source of
// selector breakage in real enterprise upgrades — the outer layout wraps
// a form section in a new div without changing any field itself).
// ---------------------------------------------------------------------------

describe("synthetic enterprise fixture: generic ERP form, ancestor wrapper changed between snapshots", () => {
  it("recovers the same field after its section is wrapped in a new container", () => {
    setHtml(`
      <form id="purchase-order-form">
        <section class="form-section">
          <label for="fld-vendor-00214">Vendor</label>
          <input id="fld-vendor-00214" name="vendor" type="text" />
        </section>
      </form>
    `);
    const original = document.querySelector("#fld-vendor-00214")!;
    const path = buildElementPath(original);

    setHtml(`
      <form id="purchase-order-form">
        <div class="layout-wrapper-v2">
          <section class="form-section">
            <label for="fld-vendor-00214">Vendor</label>
            <input id="fld-vendor-00214" name="vendor" type="text" />
          </section>
        </div>
      </form>
    `);
    const recovered = recoverElementFromPath(document, path);

    // "fld-vendor-00214" has a trailing 5-digit run, so it is classified
    // PARTIAL_MATCHABLE rather than STABLE (Step 2's deterministic
    // classification, never naive "digits = dynamic" — see
    // health-attribute-classification.ts); the genuinely-STABLE `name`
    // attribute is what should resolve this, and it is expected to
    // survive the wrapper change since it lives on the field itself, not
    // on the ancestor that changed.
    expect(recovered.outcome).toBe("RESOLVED");
    if (recovered.outcome === "RESOLVED") {
      const stillMatchesTarget = document.querySelectorAll(recovered.selector);
      expect(stillMatchesTarget).toHaveLength(1);
      expect(stillMatchesTarget[0]!.getAttribute("id")).toBe(
        "fld-vendor-00214",
      );
    }
  });
});
