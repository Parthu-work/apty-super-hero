/**
 * The DOM analysis console script SEs run today (DOM Config brief,
 * Appendix A), step for step, returning its result instead of copying it
 * to the clipboard. The collector's shared fields are compared with it.
 */
import type { DomProfileFrame, DomProfileNode } from "../../dom-profile-types";

export function runDomAnalysisScript(doc: Document): DomProfileNode {
  const win = doc.defaultView!;
  let crossOriginCount = 1;

  const getAllElements = (root: ParentNode | null | undefined) => {
    try {
      return root?.querySelectorAll("*");
    } catch {
      return undefined;
    }
  };

  const getIFrameOrigin = (element: HTMLIFrameElement): string => {
    let origin: string | null = "";
    try {
      const view = element.contentWindow;
      origin = view ? view.location.href : null;
    } catch {
      origin = `Cross Origin ${crossOriginCount} (src: ${element.src})`;
      crossOriginCount++;
    }
    return String(origin);
  };

  const isCrossOriginFrame = (element: HTMLIFrameElement): boolean => {
    let isCrossOrigin = false;
    try {
      const view = element.contentWindow;
      const origin = view ? view.location.origin : null;
      isCrossOrigin = win.top!.location.origin !== origin;
    } catch {
      isCrossOrigin = true;
    }
    return isCrossOrigin;
  };

  const findIFrame = (tag: string, element: Element, out: DomProfileNode) => {
    if (tag !== "iframe") return;
    const frame = element as HTMLIFrameElement;
    const origin = getIFrameOrigin(frame);
    out.iframes ??= {};
    if (!out.iframes[origin]) {
      const entry: DomProfileFrame = {
        isCrossOrigin: isCrossOriginFrame(frame),
      };
      out.iframes[origin] = entry;
      const frameElements = getAllElements(frame.contentDocument);
      if (frameElements?.length) startDomAnalysis(frameElements, entry);
    }
  };

  const findAttributes = (element: Element, out: DomProfileNode) => {
    for (const attribute of Array.from(element.attributes ?? [])) {
      out.attributes ??= {};
      out.attributes[attribute.name] ??= {};
      const values = out.attributes[attribute.name]!;
      values[attribute.value] ??= 0;
      values[attribute.value]!++;
    }
  };

  const findShadowRoots = (
    tag: string,
    element: Element,
    out: DomProfileNode,
  ) => {
    if (element?.shadowRoot instanceof win.DocumentFragment) {
      out.shadowRoots ??= {};
      if (!out.shadowRoots[tag]) {
        const nested: DomProfileNode = {};
        out.shadowRoots[tag] = nested;
        const shadowRootElements = getAllElements(element.shadowRoot);
        if (shadowRootElements?.length) {
          startDomAnalysis(shadowRootElements, nested);
        }
      }
    }
  };

  const findMaxZIndex = (element: Element, out: DomProfileNode) => {
    const styles = win.getComputedStyle(element);
    const zIndex = +(styles?.zIndex ?? 0) || 0;
    if (zIndex) {
      out.maxZIndex ??= 0;
      if (zIndex > out.maxZIndex) out.maxZIndex = zIndex;
    }
  };

  const safely = (step: () => void) => {
    try {
      step();
    } catch {
      // The script wraps every step in makeSafe and goes on.
    }
  };

  const startDomAnalysis = (
    elements: NodeListOf<Element>,
    out: DomProfileNode = {},
  ): DomProfileNode => {
    for (const element of Array.from(elements)) {
      const tag = (element.tagName || "").toLowerCase();
      out.tags ??= {};
      out.tags[tag] = (out.tags[tag] ?? 0) + 1;
      safely(() => findAttributes(element, out));
      safely(() => findMaxZIndex(element, out));
      safely(() => findIFrame(tag, element, out));
      safely(() => findShadowRoots(tag, element, out));
    }
    return out;
  };

  return startDomAnalysis(getAllElements(doc)!);
}
