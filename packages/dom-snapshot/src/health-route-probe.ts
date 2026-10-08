/**
 * In-frame half of the DOM Health route probe: the signals that could
 * identify "which screen is this" without the URL, read the way a user
 * sees them.
 *
 * Section 8 of the DOM Health brief asks for these after every click in a
 * real tenant, because the exports alone cannot say which of them changes
 * per screen in Infor LN or athenaOne, and that decides how `RouteKey` is
 * built and whether traversal has to be click-first. This module only
 * reads one document; the extension's frame responder adds what needs
 * `chrome.*` (frame ids, click events, network timing) and
 * `@apty/browser-runtime`'s `route-probe.ts` redacts and compares steps.
 */
import {
  isRenderedInComposedTree,
  querySelectorAllDeep,
} from "./composed-tree.js";
import {
  findActiveNavItemDeep,
  sampleHeadingsDeep,
} from "./health-state-signature.js";

/** Attributes of an `<iframe>` / `<frame>` element, read in the document that owns it (the child's own document cannot see them). */
export interface RouteProbeFrameOwner {
  element: HTMLIFrameElement | HTMLFrameElement;
  tagName: "iframe" | "frame";
  name: string | null;
  id: string | null;
  title: string | null;
  /** `data-osp-id`, Infor OS Portal's stable app-frame identity (`"LN"` in the LN export). */
  ospId: string | null;
  /** The `src` attribute as written, or null when the frame was navigated from script (athenaOne's `GlobalNav` / `Status` have none). */
  srcAttribute: string | null;
  rendered: boolean;
}

export interface RouteProbeFrameSignals {
  url: string;
  title: string;
  firstHeading: string | null;
  activeNavItem: string | null;
  owners: RouteProbeFrameOwner[];
}

/** First rendered heading in composed order, read with slot projection (the same reading the state signature uses). */
export function findFirstHeadingDeep(
  root: Document | ShadowRoot,
): string | null {
  return sampleHeadingsDeep(root, 1)[0] ?? null;
}

export { findActiveNavItemDeep };

/** Every `<iframe>` / `<frame>` this document owns, light DOM and shadow roots alike. */
export function collectFrameOwners(
  root: Document | ShadowRoot,
): RouteProbeFrameOwner[] {
  return (
    querySelectorAllDeep(root, "iframe, frame") as Array<
      HTMLIFrameElement | HTMLFrameElement
    >
  ).map((element) => ({
    element,
    tagName: element.tagName === "FRAME" ? "frame" : "iframe",
    name: element.getAttribute("name"),
    id: element.getAttribute("id"),
    title: element.getAttribute("title"),
    ospId: element.getAttribute("data-osp-id"),
    srcAttribute: element.getAttribute("src"),
    rendered: isRenderedInComposedTree(element),
  }));
}

export function collectRouteProbeFrameSignals(
  doc: Document,
): RouteProbeFrameSignals {
  return {
    url: doc.location?.href ?? "",
    title: doc.title ?? "",
    firstHeading: findFirstHeadingDeep(doc),
    activeNavItem: findActiveNavItemDeep(doc),
    owners: collectFrameOwners(doc),
  };
}
