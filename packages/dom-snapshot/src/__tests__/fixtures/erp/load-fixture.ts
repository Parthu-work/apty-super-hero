import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ErpFixtureName =
  | "infor-portal-workspace"
  | "infor-ids-shadow"
  | "athena-frameset"
  | "athena-forge-panel"
  | "athena-search-state";

export function readErpFixture(name: ErpFixtureName): string {
  return readFileSync(join(__dirname, `${name}.html`), "utf8");
}

/**
 * Attach every `<template shadowrootmode>` under `root` the way a browser's
 * parser would: the template's content becomes the parent's shadow root,
 * then nested declarative roots inside it are attached in turn. Returns the
 * number of roots attached; closed ones are also recorded in `closedRoots`,
 * standing in for `chrome.dom.openOrClosedShadowRoot` in tests.
 */
export function attachDeclarativeShadowRoots(
  root: ParentNode,
  closedRoots?: Map<Element, ShadowRoot>,
): number {
  let attached = 0;
  const templates = Array.from(
    root.querySelectorAll("template[shadowrootmode]"),
  ) as HTMLTemplateElement[];
  for (const template of templates) {
    const host = template.parentElement;
    if (!host || host.shadowRoot) continue;
    const mode =
      template.getAttribute("shadowrootmode") === "closed" ? "closed" : "open";
    const shadow = host.attachShadow({ mode });
    if (mode === "closed") closedRoots?.set(host, shadow);
    shadow.append(template.content);
    template.remove();
    attached += 1 + attachDeclarativeShadowRoots(shadow, closedRoots);
  }
  return attached;
}

/**
 * Replace the test document with the fixture and attach its declarative
 * shadow roots. `transform` edits the markup first, for a state the export
 * does not show (an opened menu): jsdom caches computed styles inside
 * shadow trees and does not see an attribute removed after load.
 */
export function loadErpFixture(
  name: ErpFixtureName,
  options: { doc?: Document; transform?: (html: string) => string } = {},
): { shadowRootsAttached: number; closedRoots: Map<Element, ShadowRoot> } {
  const doc = options.doc ?? document;
  const html = readErpFixture(name);
  const parsed = new DOMParser().parseFromString(
    options.transform ? options.transform(html) : html,
    "text/html",
  );
  doc.replaceChild(
    doc.importNode(parsed.documentElement, true),
    doc.documentElement,
  );
  const closedRoots = new Map<Element, ShadowRoot>();
  return {
    shadowRootsAttached: attachDeclarativeShadowRoots(doc, closedRoots),
    closedRoots,
  };
}
