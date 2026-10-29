/**
 * The DES configuration the Agent audits with.
 *
 * `health-attribute-classification.ts` reproduces the real Apty Studio
 * defaults and stays exactly as Studio ships them. Real enterprise DOMs
 * carry values those defaults keep as identity although they change per
 * build, render, interaction, browser, OS or theme (DOM Health brief,
 * section 2.3). A Studio administrator onboarding such an application would
 * configure them away. This profile does the same, through Studio's own
 * hooks: an `ignore` function that calls the `defaultFn` it is handed
 * first and only adds to it, and `partialSelectors` functions returning
 * the stable part of a value. Audit results are therefore "selectable with
 * this configuration", and the report names the profile.
 *
 * Class tokens go through the class ignore hook one at a time, as Apty's
 * `ignoreSelectorClassFunction` does; this port also hands the hook the
 * whole `class` value, so a styled-components partner can be recognised
 * next to its `sc-` id. The profile only removes what is unstable; it
 * never invents a substring anchor (a react-select or Emotion stem from
 * `extractStablePrefix` / `extractStableSuffix`), because a partial
 * selector on part of a value is a choice Studio leaves to explicit
 * configuration.
 */

import {
  DEFAULT_DES_CONFIG,
  type DesConfig,
  type IgnoreFn,
} from "./health-attribute-classification.js";
import { classifyUnstableClass, looksDynamic } from "./health-dynamic.js";
import { isPrivateAttribute } from "./health-privacy.js";

/**
 * Angular view-encapsulation attributes: the name itself carries a
 * per-build component number. 508 occurrences of `_ngcontent-ng-c<n>` /
 * `_nghost-ng-c<n>` in the Infor LN export (e.g.
 * `_ngcontent-ng-c1137233439`); Studio's default ignore list keeps them.
 */
const ANGULAR_ENCAPSULATION_ATTRIBUTE = /^_ng(content|host)-ng-c\d+$/;

/**
 * Attributes whose name says they carry a version: measured `ng-version`,
 * `data-sohoxi-version`, `data-ids-enterprise-ng-version` (Infor LN) and
 * `data-app-version-info` (athenaOne Nimbus app root). Their values change
 * with every release.
 */
const VERSION_ATTRIBUTE = /(?:^|-)version(?:-|$)/;

/** True for an attribute whose name, not just its value, is generated or release-specific. */
export function isUnstableAttributeName(name: string): boolean {
  return (
    ANGULAR_ENCAPSULATION_ATTRIBUTE.test(name) || VERSION_ATTRIBUTE.test(name)
  );
}

/**
 * The name used for identity comparisons: Angular's per-build
 * encapsulation attributes collapse to `_ngcontent-*` / `_nghost-*`, so two
 * builds of the same screen compare equal.
 */
export function normalizeAttributeName(name: string): string {
  const match = name.match(ANGULAR_ENCAPSULATION_ATTRIBUTE);
  return match ? `_ng${match[1]}-*` : name;
}

function splitClasses(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}

/** The class tokens of `value` that are identity: everything `classifyUnstableClass` does not reject. */
export function stableClassTokens(value: string): string[] {
  const tokens = splitClasses(value);
  return tokens.filter(
    (token) => classifyUnstableClass(token, tokens) === null,
  );
}

/**
 * Never part of a path: an input's `value` attribute is what the user
 * typed or what the server pre-filled (a patient name on a registration
 * form), and a path is stored and replayed (brief section 4.12).
 */
const PRIVATE_ATTRIBUTES = new Set(["value"]);

const auditIgnoreAttribute: IgnoreFn = (name, value, defaultFn) => {
  if (defaultFn?.(name, value)) return true;
  if (PRIVATE_ATTRIBUTES.has(name) || isPrivateAttribute(name, value ?? "")) {
    return true;
  }
  if (isUnstableAttributeName(name)) return true;
  return name === "id" && Boolean(value) && looksDynamic(value ?? "");
};

const auditIgnoreClass: IgnoreFn = (token, classValue, defaultFn) => {
  if (defaultFn?.(token, undefined)) return true;
  const tokens = splitClasses(classValue ?? token);
  return classifyUnstableClass(token, tokens) !== null;
};

export const AUDIT_PROFILE_NAME = "apty-agent-audit-v1";

export const AUDIT_DES_CONFIG: DesConfig = {
  ...DEFAULT_DES_CONFIG,
  ignore: {
    attribute: auditIgnoreAttribute,
    class: auditIgnoreClass,
  },
};

/**
 * `config` with `id` ignored for every value in `duplicated`. An id is
 * unique per root (a document or a shadow root), and one shared by two
 * elements in the same root cannot single either out, so the engine falls
 * back to the next attribute instead of producing a confident selector
 * that matches both (defect D-8). Measured: 9 id values are duplicated
 * within one root in the Infor LN export, 15 across the whole page.
 */
export function withDuplicateIdsIgnored(
  config: DesConfig,
  duplicated: ReadonlySet<string>,
): DesConfig {
  const base = config.ignore.attribute;
  const ignoreAttribute: IgnoreFn = (name, value, defaultFn) =>
    (base ? base(name, value, defaultFn) : Boolean(defaultFn?.(name, value))) ||
    (name === "id" && value !== undefined && duplicated.has(value));
  return {
    ...config,
    ignore: { ...config.ignore, attribute: ignoreAttribute },
  };
}
