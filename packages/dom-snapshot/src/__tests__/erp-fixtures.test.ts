import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { querySelectorAllDeep, walkComposedTree } from "../composed-tree";
import { loadErpFixture, readErpFixture } from "./fixtures/erp/load-fixture";
import { ATHENA, INFOR } from "./fixtures/erp/values";

/**
 * SHA-256 of each real value removed from the fixtures (username, practice
 * id and name, department, patient-search text, Datadog token, Pendo and
 * Datadog ids, Infor tenant, session and workspace ids, customer hosts), as
 * lowercase alphanumeric tokens. Hashes, so this guard can run without the
 * repository holding the values it guards against.
 */
const REDACTED_VALUE_HASHES = new Set([
  "446bd07a068d7f77343eaa4988f25d39427a9f2daf5c6516bb75014fc4bef328",
  "0900aa7f5e1f86988a33167fcf9f712fc5fcfa85613db5082dca8df119de3800",
  "13ea1198083b374de09553aeb373bde2b88fa48866b728c30a9c262c4ee19078",
  "56fe43f748e258de06b4955e2b8978bbc1c28ff9ba53917387d6dca8fb920018",
  "fe600b821d8accd45d2b1851b7728fd58a7400b9ac9d7332fdc1a9aeb3e202e7",
  "bd8f6a90faa38de3ba0b14f098a1ebb214c99c6a7ffa5f001498e264d0a2ae3a",
  "66dda04e5ba18040e802625bb77e5447735843647765eaaae3bf1b6cdfa561ea",
  "52861547998b4cef142b0d76b883ee3df17a192e93ef363f4508b19d088b2a5e",
  "e0576e9e1aef6b007d6c71b8c34f04d8825811050707f8d3186c983fd16638d7",
  "6f6ec31f9ce157b2665455ff9a6173c21297d02cac21dc12ddb84feb5810b423",
  "a9329dedb2d5fbda1807155da6a5c184a225c20e7a120aebe9f85f37019809b7",
  "27d41e032450b507106d30cd281a239553d70f456114b434697294190c493112",
  "36a23ef31ffbdfb2b64e2a6e943e137d8d5d85efbabc64d3b33087c87d7752b9",
  "665a68f56b35a263882e8986e77bff76dd4d8d919189a521173ee0a1c228fc55",
  "0a22eb3ee3f18548fd2c4eeab5c5c0a03e79dc73889939e8e27848255eebb603",
  "309ab0f29e4427e49c44660f481f19a47a1e0dc103dd564992dfe80661905631",
  "6534efda8dec9bad24980a48204d6bae994af46ebdc3b261e7af446366fdbe8b",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function idCounts(owner: Document | ShadowRoot): Map<string, number> {
  const counts = new Map<string, number>();
  for (const el of Array.from(owner.querySelectorAll("[id]"))) {
    counts.set(el.id, (counts.get(el.id) ?? 0) + 1);
  }
  return counts;
}

describe("ERP fixtures", () => {
  it("reproduce the LN export's duplicate-id layout: 15 values page-wide, 9 within one root", () => {
    loadErpFixture("infor-portal-workspace");

    const pageWide = new Map<string, number>();
    const roots: Array<Document | ShadowRoot> = [document];
    walkComposedTree(document, (el) => {
      if (el.id) pageWide.set(el.id, (pageWide.get(el.id) ?? 0) + 1);
      if (el.shadowRoot) roots.push(el.shadowRoot);
    });
    const withinRoot = new Set<string>();
    for (const root of roots) {
      for (const [id, n] of idCounts(root)) if (n > 1) withinRoot.add(id);
    }

    expect([...pageWide.values()].filter((n) => n > 1)).toHaveLength(
      INFOR.measured.duplicateIdValuesPageWide,
    );
    expect(withinRoot.size).toBe(INFOR.measured.duplicateIdValuesWithinARoot);
  });

  it("keep LN's shell shape: no form controls in the top document, the app in a tenant-bearing iframe", () => {
    loadErpFixture("infor-portal-workspace");

    expect(document.querySelectorAll("input, select, textarea")).toHaveLength(
      INFOR.measured.formControlsInTopDocument,
    );
    const frame = document.querySelector("iframe")!;
    expect(frame.getAttribute("data-osp-id")).toBe(INFOR.lnFrame.ospId);
    expect(frame.getAttribute("name")).toBe(INFOR.lnFrame.name);
    expect(new URL(frame.src).searchParams.has("inforTenantId")).toBe(true);
    expect(frame.hasAttribute("#frameview")).toBe(true);
    expect([...document.documentElement.classList]).toEqual(
      INFOR.rootEnvironmentClasses,
    );
  });

  it("attach IDS declarative shadow roots three levels deep, with slotted labels", () => {
    const { shadowRootsAttached } = loadErpFixture("infor-ids-shadow");

    expect(shadowRootsAttached).toBeGreaterThan(10);
    const switcher = document.querySelector("ids-theme-switcher")!;
    const menuButton = switcher.shadowRoot!.querySelector("ids-menu-button")!;
    const button = menuButton.shadowRoot!.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Theme Switcher");
    expect(document.querySelector("button")).toBeNull();
    const popup = switcher
      .shadowRoot!.querySelector("ids-popup-menu")!
      .shadowRoot!.querySelector("ids-popup")!;
    expect(popup.shadowRoot!.querySelector(".content-wrapper")).not.toBeNull();
  });

  it("put the athenaOne micro-frontend in a shadow root of a plain div, Pendo badges on both sides", () => {
    loadErpFixture("athena-forge-panel");

    const host = document.querySelector(
      ".eal_c_nimbus-app-container__nimbus-app-container",
    )!;
    expect(host.tagName).toBe("DIV");
    expect(host.shadowRoot!.querySelector("form#xpr_rf")).not.toBeNull();
    expect(document.getElementById("legalSex")).toBeNull();
    const pendo = querySelectorAllDeep(document, '[id^="pendo-image-badge-"]');
    expect(pendo.map((el) => el.id)).toEqual([
      ATHENA.pendoIds[0],
      ATHENA.pendoIds[1],
    ]);
  });

  it("keep the athenaOne frames as script-navigated placeholders and shims", () => {
    loadErpFixture("athena-frameset");

    for (const id of ATHENA.frameIds) {
      const frame = document.getElementById(id)!;
      expect(frame.tagName).toBe("IFRAME");
      expect(frame.hasAttribute("src")).toBe(false);
    }
    expect(
      document
        .getElementById("searchmenuiframe")!
        .classList.contains(ATHENA.shimFrameClass),
    ).toBe(true);
  });

  it("contain none of the real customer values that were redacted", () => {
    for (const name of [
      "infor-portal-workspace",
      "infor-ids-shadow",
      "athena-frameset",
      "athena-forge-panel",
      "athena-search-state",
    ] as const) {
      const tokens = readErpFixture(name)
        .toLowerCase()
        .match(/[a-z0-9]+/g);
      const leaked = (tokens ?? []).filter((token) =>
        REDACTED_VALUE_HASHES.has(sha256(token)),
      );
      expect(leaked, name).toEqual([]);
    }
  });
});
