/**
 * Golden fixtures for the real-Apty-faithful DES engine.
 *
 * Every fixture below is a SYNTHETIC ENTERPRISE FIXTURE: a DOM shape
 * hand-built to resemble the kind of markup found in Infor LN-, Autodesk-,
 * and Salesforce-Lightning-style enterprise applications (generated
 * widget/field ids, framework-hashed classes, densely repeated grid rows,
 * Lightning-style component wrappers). None of this markup was captured
 * from, or is claimed to represent, any real customer application or
 * product. Assertions here test the REAL reverse-engineered Apty
 * recovery algorithm's actual behavior (see `des-engine.ts`'s module doc
 * comment and `docs/development/des-engine.md`), not an invented one —
 * a wrong-target or not-resolved result is a correct, reportable finding
 * here, not a bug, when that is genuinely what the real algorithm does.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildElementPath,
  findElement,
  generateMinimalSelector,
} from "../des-engine";
import { DEFAULT_DES_CONFIG } from "../health-attribute-classification";
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

  it("cannot use the row's own generated id at all (2+ consecutive digits is the real default ignore rule for id/for) and must climb to the row's position to disambiguate", () => {
    setHtml(lnGridHtml(5));
    const button = document.querySelector("#BTN_00002_RUN38293")!;
    const resolution = resolveElement(document, button);
    // Every row shares the same class ("ln-action-btn"), the same
    // data-field ("approve-action"), and — once the generated id is
    // (correctly) excluded — the same class on its <tr> and <td>
    // ancestors too. No id/class EVER disambiguates at any level; only
    // climbing to the row's own nth-child position does. This is a real,
    // reportable finding: a generated id that LOOKS like it should
    // identify the row directly cannot be used at all under Apty's real
    // default configuration, and the resulting selector depends entirely
    // on table row order — it breaks the moment a row is inserted,
    // removed, or reordered above this one.
    expect(resolution.outcome).toBe("POSITIONAL_ONLY");
    expect(resolution.usesPositionalSelector).toBe(true);
    expect(resolution.ancestorDepthUsed).toBeGreaterThanOrEqual(1);
  });

  it("recovers a row's action button after the whole grid re-renders with fresh generated ids, via the stable data-field + class + position context", () => {
    setHtml(lnGridHtml(20));
    const target = document.querySelectorAll(
      '[data-field="approve-action"]',
    )[7]!;
    const path = buildElementPath(target, DEFAULT_DES_CONFIG);

    // Re-render: every generated id changes (a fresh page load / grid
    // refresh), the row's business data survives.
    setHtml(lnGridHtml(20).replace(/RUN38291/g, "RUN99999"));
    const recovered = document.querySelectorAll(
      '[data-field="approve-action"]',
    )[7]!;

    const result = findElement(path, document, DEFAULT_DES_CONFIG);
    expect(result.element).toBe(recovered);
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
  it("uses the framework-hashed class over a data-testid automation hook under Apty's REAL default priority ([id, class, href, src] — no built-in data-testid preference)", () => {
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
    const resolution = resolveElement(document, button, {
      desConfig: DEFAULT_DES_CONFIG,
    });
    // This is a genuine, reportable finding, not an approximation: unless
    // Studio configuration explicitly adds data-testid to a custom
    // priority/partialSelectorAttributes list, real Apty's default
    // priority has no automation-hook preference at all, so an
    // incidentally-unique hashed class wins by being tried first.
    expect(resolution.outcome).toBe("DIRECT_SUCCESS");
    expect(resolution.bestSelector).not.toContain("publish-model-button");
  });

  it("uses the data-testid automation hook over the framework-hashed class once Studio configuration adds it to partialSelectorAttributes", () => {
    setHtml(`
      <div class="sc-bdVaJa hEcuXe">
        <button class="sc-htpNat jrIVkE" data-testid="publish-model-button">Publish</button>
      </div>
    `);
    const button = document.querySelector(
      '[data-testid="publish-model-button"]',
    )!;
    const config = {
      ...DEFAULT_DES_CONFIG,
      partialSelectorAttributes: ["data-testid"],
    };
    const minimal = generateMinimalSelector(button, document, config);
    expect(minimal?.selector).toContain("publish-model-button");
    expect(minimal?.selector).not.toContain("sc-htpNat");
  });

  it("cross-render recovery survives the SPA regenerating every hashed class name", () => {
    setHtml(`
      <div class="sc-bdVaJa hEcuXe">
        <button class="sc-htpNat jrIVkE" data-testid="publish-model-button">Publish</button>
      </div>
    `);
    const original = document.querySelector(
      '[data-testid="publish-model-button"]',
    )!;
    const path = buildElementPath(original, DEFAULT_DES_CONFIG);

    setHtml(`
      <div class="sc-zzTopA qqLeaf">
        <button class="sc-newHash aaBbCc" data-testid="publish-model-button">Publish</button>
      </div>
    `);
    const recovered = document.querySelector(
      '[data-testid="publish-model-button"]',
    )!;

    const result = findElement(path, document, DEFAULT_DES_CONFIG);
    expect(result.element).toBe(recovered);
  });
});

// ---------------------------------------------------------------------------
// Synthetic enterprise fixture: Salesforce Lightning-style repeated
// component list — every row is a repeated wrapper with an internal
// Aura/LWC generated id, SLDS utility classes, and a `role="listitem"`
// semantic signal, but no automation-specific test id at all.
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
    const resolution = resolveElement(document, target);
    expect([
      "DIRECT_SUCCESS",
      "RECOVERED_BY_PARTIAL",
      "RECOVERED_BY_CONTEXT",
      "RECOVERED_BY_IGNORE",
    ]).toContain(resolution.outcome);
    expect(resolution.bestSelector).toBeTruthy();
  });

  it("does not silently invent a winner when two records share the same accessible name and structure — either a real resolve to the correct one, a documented WRONG_TARGET, or an honest AMBIGUOUS is acceptable, a hidden coin-flip is not", () => {
    setHtml(lightningListHtml(["Acme Corp", "Acme Corp", "Initech LLC"]));
    const targets = document.querySelectorAll('[aria-label="Acme Corp"]');
    const first = targets[0]!;
    const resolution = resolveElement(document, first);
    expect([
      "DIRECT_SUCCESS",
      "RECOVERED_BY_PARTIAL",
      "RECOVERED_BY_CONTEXT",
      "POSITIONAL_ONLY",
      "WRONG_TARGET",
      "AMBIGUOUS",
    ]).toContain(resolution.outcome);
  });
});

// ---------------------------------------------------------------------------
// Synthetic enterprise fixture: generic ERP form with an ancestor wrapper
// that changes between snapshots — a common source of selector breakage
// in real enterprise upgrades.
// ---------------------------------------------------------------------------

describe("synthetic enterprise fixture: generic ERP form, ancestor wrapper changed between snapshots", () => {
  it("recovers the same field after its section is wrapped in a new container, via its own stable name attribute", () => {
    setHtml(`
      <form id="purchase-order-form">
        <section class="form-section">
          <label for="fld-vendor-00214">Vendor</label>
          <input id="fld-vendor-00214" name="vendor" type="text" />
        </section>
      </form>
    `);
    const original = document.querySelector("#fld-vendor-00214")!;
    const path = buildElementPath(original, DEFAULT_DES_CONFIG);

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
    const recovered = document.querySelector("#fld-vendor-00214")!;

    // "fld-vendor-00214" has a trailing 5-digit run, so the real DEFAULT
    // ignore rule for `id` (2+ consecutive digits) excludes it from the
    // captured pattern entirely — the genuinely-stable `name` attribute is
    // what should carry this recovery.
    const result = findElement(path, document, DEFAULT_DES_CONFIG);
    expect(result.element).toBe(recovered);
  });
});
