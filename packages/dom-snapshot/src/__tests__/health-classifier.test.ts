import { beforeEach, describe, expect, it } from "vitest";
import {
  buildElementPath,
  buildElementPattern,
  generateMinimalSelector,
  pathToSelector,
} from "../des-engine";
import {
  DEFAULT_DES_CONFIG,
  DEFAULT_IGNORE,
  DEFAULT_PRIORITY,
} from "../health-attribute-classification";
import {
  AUDIT_DES_CONFIG,
  isUnstableAttributeName,
  normalizeAttributeName,
  stableClassTokens,
} from "../health-audit-profile";
import {
  classifyUnstableClass,
  extractStablePrefix,
  extractStableSuffix,
  looksDynamic,
} from "../health-dynamic";
import {
  computeElementFingerprint,
  resolveElement,
} from "../health-selector-engine";
import { loadErpFixture } from "./fixtures/erp/load-fixture";
import { ATHENA, INFOR } from "./fixtures/erp/values";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("section 2.3: real values the old heuristic got wrong", () => {
  it.each(
    ATHENA.reactAriaIds,
  )("flags the react-aria id %s as generated", (id) => {
    expect(looksDynamic(id)).toBe(true);
  });

  it.each(ATHENA.pendoIds)("flags the Pendo id %s as generated", (id) => {
    expect(looksDynamic(id)).toBe(true);
  });

  it.each(
    ATHENA.emotionClasses,
  )("flags the Emotion class %s as generated", (token) => {
    expect(looksDynamic(token)).toBe(true);
    expect(classifyUnstableClass(token)).toBe("generated");
  });

  it.each([
    ...INFOR.svgClipIds,
    INFOR.svgGradientId,
  ])("treats every SVG clip/gradient id the same way, short tail included: %s", (id) => {
    expect(looksDynamic(id)).toBe(true);
  });

  it("ignores Angular's per-build encapsulation attribute names, which Studio's defaults keep", () => {
    for (const name of INFOR.angularScopedAttributes) {
      expect(DEFAULT_IGNORE.attribute(name, "")).toBe(false);
      expect(isUnstableAttributeName(name)).toBe(true);
    }
    expect(normalizeAttributeName("_ngcontent-ng-c1137233439")).toBe(
      normalizeAttributeName("_ngcontent-ng-c99"),
    );
    expect(normalizeAttributeName("_nghost-ng-c349936244")).toBe("_nghost-*");
  });

  it.each(
    ATHENA.stateClasses,
  )("treats the Forge state class %s as state, not identity", (token) => {
    expect(classifyUnstableClass(token)).toBe("state");
  });

  it.each([
    ...INFOR.rootEnvironmentClasses,
    ...ATHENA.rootEnvironmentClasses,
    ATHENA.browserClass,
  ])("treats the browser / OS / theme / environment class %s as environment", (token) => {
    expect(classifyUnstableClass(token)).toBe("environment");
  });
});

describe("further shapes measured in the exports", () => {
  it("flags Angular's animation class and athenaOne's package-version classes", () => {
    expect(classifyUnstableClass(INFOR.angularAnimationClass)).toBe(
      "generated",
    );
    for (const token of ATHENA.packageVersionClasses) {
      expect(classifyUnstableClass(token)).toBe("build");
    }
  });

  it("flags a styled-components generated class only next to its sc- component id", () => {
    for (const [componentId, generated] of ATHENA.styledComponentsClasses) {
      expect(classifyUnstableClass(generated, [componentId, generated])).toBe(
        "generated",
      );
      expect(classifyUnstableClass(generated)).toBeNull();
    }
  });

  it("keeps a bare GUID id generated", () => {
    expect(looksDynamic(ATHENA.bareGuidId)).toBe(true);
  });

  it("extracts react-select's stable prefix and part suffix, and Emotion's label", () => {
    for (const id of ATHENA.reactSelectIds) {
      expect(looksDynamic(id)).toBe(true);
      expect(extractStablePrefix(id)).toBe("react-select-");
    }
    expect(extractStableSuffix("react-select-b2qe-m-input")).toBe("-input");
    expect(extractStableSuffix("react-select-TXQoB6-live-region")).toBe(
      "-live-region",
    );
    expect(extractStableSuffix("fe-c-1xc3v61-indicatorContainer")).toBe(
      "-indicatorContainer",
    );
    expect(extractStableSuffix("fe-c-1mkvw8y")).toBeNull();
  });

  it("leaves authored classes and ids alone", () => {
    for (const token of [
      "fe_c_button",
      "fe_c_button--large",
      "portal-root",
      "osp-width-full",
      "ng-star-inserted",
      "xpr_rf--field-sex",
    ]) {
      expect(classifyUnstableClass(token)).toBeNull();
    }
    expect(looksDynamic("osp-nav-launcher")).toBe(false);
    expect(looksDynamic("GlobalNav")).toBe(false);
  });
});

describe("Studio defaults are unchanged", () => {
  it("keeps the reconstructed priority, ignore list and empty configuration", () => {
    expect(DEFAULT_PRIORITY).toEqual(["id", "class", "href", "src"]);
    expect(DEFAULT_DES_CONFIG.ignore).toEqual({});
    expect(DEFAULT_DES_CONFIG.partialSelectors).toBeUndefined();
    expect(DEFAULT_IGNORE.attribute("style", "")).toBe(true);
    expect(DEFAULT_IGNORE.attribute("id", "react-select-94dJfC-input")).toBe(
      true,
    );
    expect(DEFAULT_IGNORE.attribute("id", "osp-nav-launcher")).toBe(false);
    expect(DEFAULT_IGNORE.attribute("ygtrackview", "Workspace")).toBe(false);
    expect(DEFAULT_IGNORE.class("class", "fe_is-disabled")).toBe(false);
  });

  it("still builds Studio patterns with state classes and Angular attributes in them", () => {
    document.body.innerHTML =
      '<button _ngcontent-ng-c1137233439="" class="fe_c_button fe_is-disabled">Save</button>';
    const pattern = buildElementPattern(document.querySelector("button")!);

    expect(pattern.attributes.map((a) => a.name)).toContain(
      "_ngcontent-ng-c1137233439",
    );
    expect(pattern.classes.map((c) => c.class)).toContain("fe_is-disabled");
  });
});

describe("the audit profile", () => {
  it("drops state classes and Angular attributes from the pattern, keeping the rest", () => {
    document.body.innerHTML =
      '<button _ngcontent-ng-c1137233439="" ygtrackclick="Save" class="fe_c_button fe_is-disabled add-button">Save</button>';
    const pattern = buildElementPattern(
      document.querySelector("button")!,
      AUDIT_DES_CONFIG,
    );

    expect(pattern.attributes.map((a) => a.name)).toEqual(["ygtrackclick"]);
    expect(pattern.classes.map((c) => c.class)).toEqual([
      "fe_c_button",
      "add-button",
    ]);
  });

  it("ignores a class attribute made only of environment classes (LN's <html>)", () => {
    loadErpFixture("infor-portal-workspace");

    const pattern = buildElementPattern(
      document.documentElement,
      AUDIT_DES_CONFIG,
    );

    expect(pattern.classes).toEqual([]);
    expect(pattern.attributes.map((a) => a.name)).not.toContain(
      "data-sohoxi-version",
    );
  });

  it("gives two Angular builds of the same control one fingerprint", () => {
    document.body.innerHTML =
      '<div><button _ngcontent-ng-c1137233439="" class="menu-item">Go</button></div><div><button _ngcontent-ng-c99="" class="menu-item">Go</button></div>';
    const [first, second] = Array.from(document.querySelectorAll("button"));

    expect(computeElementFingerprint(first!)).toBe(
      computeElementFingerprint(second!),
    );
    document.body.innerHTML =
      '<div><button class="menu-item">Go</button></div>';
    expect(
      computeElementFingerprint(document.querySelector("button")!),
    ).not.toBe(computeElementFingerprint(first!));
  });

  it("ignores a generated id outright rather than anchoring on part of it", () => {
    document.body.innerHTML =
      '<input id="react-select-94dJfC-input" name="sex">';
    const pattern = buildElementPattern(
      document.querySelector("input")!,
      AUDIT_DES_CONFIG,
    );

    expect(pattern.attributes).toEqual([
      { name: "name", value: "sex", selectionType: undefined },
    ]);
  });

  it("drops an Emotion class token without matching on its label", () => {
    expect(
      stableClassTokens(
        "fe_c_select__indicator fe-c-1xc3v61-indicatorContainer",
      ),
    ).toEqual(["fe_c_select__indicator"]);
    document.body.innerHTML =
      '<div class="a fe-c-1xc3v61-indicatorContainer b"></div><div class="a"></div>';
    const target = document.querySelector("div")!;

    const pattern = buildElementPattern(target, AUDIT_DES_CONFIG);
    const selector = pathToSelector(buildElementPath(target, AUDIT_DES_CONFIG));

    expect(pattern.classes.map((c) => c.class)).toEqual(["a", "b"]);
    expect(selector).not.toContain("indicatorContainer");
    expect(document.querySelector(selector)).toBe(target);
  });

  it("prefers a data-testid over styled-components classes, which Studio's defaults would pick", () => {
    document.body.innerHTML =
      '<div class="sc-bdVaJa hEcuXe"><button class="sc-htpNat jrIVkE" data-testid="publish-model-button">Publish</button></div>';
    const button = document.querySelector("button")!;

    expect(resolveElement(document, button).bestSelector).toContain(
      "publish-model-button",
    );
    expect(
      resolveElement(document, button, { desConfig: DEFAULT_DES_CONFIG })
        .bestSelector,
    ).not.toContain("publish-model-button");
  });

  it("resolves the athenaOne Legal sex select without its state or Emotion classes", () => {
    loadErpFixture("athena-forge-panel");
    const shadow = document.querySelector(
      ".eal_c_nimbus-app-container__nimbus-app-container",
    )!.shadowRoot!;
    const control = shadow.querySelector(".fe_c_select__control")!;

    const resolution = resolveElement(shadow, control);

    expect(["NOT_RESOLVED", "WRONG_TARGET"]).not.toContain(resolution.outcome);
    expect(resolution.bestSelector).not.toMatch(
      /fe_is-|fe-c-16xfy0z|--is-disabled/,
    );
    expect(shadow.querySelectorAll(resolution.bestSelector!)).toHaveLength(1);
  });

  it("never puts LN's invalid attribute names into a selector", () => {
    loadErpFixture("infor-portal-workspace");
    const frame = document.querySelector("iframe")!;

    const minimal = generateMinimalSelector(frame, document, AUDIT_DES_CONFIG);

    expect(minimal?.selector).not.toContain("#frameview");
    expect(() => document.querySelectorAll(minimal!.selector)).not.toThrow();
    expect(document.querySelector(minimal!.selector)).toBe(frame);
  });
});
