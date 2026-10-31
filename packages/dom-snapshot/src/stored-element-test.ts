/**
 * Runs an Apty item's stored selector in one document the way the 5.x
 * player does (`playSelection`: the shadow hosts first, then the first
 * rendered match, else the first match) and reports what it found as
 * counts and booleans only: no text, attribute value or URL leaves the page.
 */
import { playSelection } from "./apty-selector.js";
import { querySelectorAllDeep } from "./composed-tree.js";
import { isElementRendered, resetDesPerformanceCaches } from "./des-engine.js";

export interface StoredElementTarget {
  /** "css" for the picker's and hand-written CSS selectors, "xpath" for XPath. */
  language: "css" | "xpath";
  selector: string;
  /** One selector per shadow host, outermost first (`shadowRootSelectors`). */
  shadowRoots: string[];
  /** One selector per frame level, outermost first (`iframesPath`). */
  framePath?: string[];
}

export interface StoredElementTest {
  /** The selector does not parse, so the lookup finds nothing. */
  invalid: boolean;
  matchCount: number;
  renderedCount: number;
  /** The first shadow host selector that found no open root; the lookup then ran against the document. */
  brokenHostIndex: number | null;
  /** Matches inside open shadow roots, which a lookup in the document never reaches; counted only when the lookup found nothing. */
  shadowMatches: number;
  /** The element the player would take. */
  chosen: { rendered: boolean; inViewport: boolean } | null;
  /**
   * With a frame path: whether this frame is the one it leads to, each
   * level's selector taking the first match as the player's lookup does;
   * null when a level cannot be read from here (a cross-origin parent).
   */
  onFramePath?: boolean | null;
}

const MAX_SHADOW_MATCHES = 50;

function cssParses(doc: Document, selector: string): boolean {
  try {
    doc.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

function xpathMatches(doc: Document, selector: string): Element[] | null {
  try {
    const result = doc.evaluate(
      selector,
      doc,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const elements: Element[] = [];
    for (let i = 0; i < result.snapshotLength; i++) {
      const node = result.snapshotItem(i);
      if (node?.nodeType === 1) elements.push(node as Element);
    }
    return elements;
  } catch {
    return null;
  }
}

function inViewport(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  const rect = el.getBoundingClientRect();
  return (
    (rect.width > 0 || rect.height > 0) &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < view.innerHeight &&
    rect.left < view.innerWidth
  );
}

function describeChosen(el: Element | null): StoredElementTest["chosen"] {
  return el
    ? { rendered: isElementRendered(el), inViewport: inViewport(el) }
    : null;
}

function onFramePath(
  doc: Document,
  framePath: readonly string[],
): boolean | null {
  const chain: Element[] = [];
  let view: Window | null = doc.defaultView;
  while (view && view.parent !== view) {
    let frame: Element | null;
    try {
      frame = view.frameElement;
    } catch {
      return null;
    }
    if (!frame) return null;
    chain.unshift(frame);
    view = view.parent;
  }
  if (chain.length !== framePath.length) return false;
  return chain.every((frame, level) => {
    try {
      return (
        frame.ownerDocument.querySelector(framePath[level] ?? "") === frame
      );
    } catch {
      return false;
    }
  });
}

export function testStoredElement(
  doc: Document,
  target: StoredElementTarget,
): StoredElementTest {
  resetDesPerformanceCaches();
  const empty: StoredElementTest = {
    invalid: true,
    matchCount: 0,
    renderedCount: 0,
    brokenHostIndex: null,
    shadowMatches: 0,
    chosen: null,
    ...(target.framePath
      ? { onFramePath: onFramePath(doc, target.framePath) }
      : {}),
  };

  if (target.language === "xpath") {
    const matches = xpathMatches(doc, target.selector);
    if (!matches) return empty;
    const rendered = matches.filter(isElementRendered);
    return {
      ...empty,
      invalid: false,
      matchCount: matches.length,
      renderedCount: rendered.length,
      chosen: describeChosen(rendered[0] ?? matches[0] ?? null),
    };
  }

  if (!cssParses(doc, target.selector)) return empty;
  const played = playSelection(
    { selector: target.selector, shadowRoots: target.shadowRoots },
    doc,
  );
  return {
    ...empty,
    invalid: false,
    matchCount: played.matchCount,
    renderedCount: played.renderedCount,
    brokenHostIndex: played.brokenHostIndex,
    shadowMatches:
      played.matchCount === 0
        ? querySelectorAllDeep(doc, target.selector, MAX_SHADOW_MATCHES).filter(
            (el) => el.getRootNode() !== doc,
          ).length
        : 0,
    chosen: describeChosen(played.element),
  };
}
