/**
 * `ElementRef`: a stored reference to one element that can be re-resolved
 * later from the top of a document, across any number of shadow
 * boundaries.
 *
 * An `ElementPath` alone records no root. `buildElementPath` walks
 * `parentElement`, which stops at a shadow boundary, so a shadow element's
 * path starts at the top of its own shadow root and `pathToSelector` only
 * works inside that root. Replaying it against `document`, as the frame
 * responder did (defect D-1), cannot find it. On real data that is most of
 * the page: 68 of the 74 interactive elements in the Infor LN export sit
 * inside its 251 shadow roots (measured in jsdom with the declarative roots
 * attached), and athenaOne hosts a whole micro-frontend in one.
 *
 * `ElementRef` wraps the faithful engine without changing it.
 * `hostChain[k]` is the full `ElementPath` of the k-th shadow host from the
 * document down, captured in that host's own root, so a host whose
 * attributes are generated still goes through `findElement`'s normal
 * recovery. `path` is the element itself, inside the innermost root.
 */
import {
  buildElementPath,
  type ElementPath,
  type FindResult,
  findElement,
  pathToSelector,
} from "./des-engine.js";
import type { DesConfig } from "./health-attribute-classification.js";
import { AUDIT_DES_CONFIG } from "./health-audit-profile.js";
import { shadowRootOf } from "./shadow-roots.js";

/** Bumped whenever the stored shape changes; a sample without it predates `ElementRef` (see `toElementRef`). */
export const ELEMENT_REF_VERSION = 1;

export interface ElementRef {
  version: typeof ELEMENT_REF_VERSION;
  /** Shadow hosts from the document down to the root that owns `path`; empty when `path` is rooted in the document. */
  hostChain: ElementPath[];
  path: ElementPath;
  /** Stable identity of the frame the element lives in, or "" when the frame layer has not assigned one. */
  frameKey: string;
}

/** Joins hop selectors in `describeElementRef`. Diagnostic text, never passed to `querySelector`. */
export const SHADOW_BOUNDARY = " >>> ";

/** The shadow hosts above `el`, outermost first: empty for an element in the document's own tree. */
export function shadowHostChain(el: Element): Element[] {
  const hosts: Element[] = [];
  let root = el.getRootNode();
  while (root instanceof ShadowRoot) {
    hosts.unshift(root.host);
    root = root.host.getRootNode();
  }
  return hosts;
}

export function buildElementRef(
  el: Element,
  options: { config?: DesConfig; frameKey?: string } = {},
): ElementRef {
  const config = options.config ?? AUDIT_DES_CONFIG;
  return {
    version: ELEMENT_REF_VERSION,
    hostChain: shadowHostChain(el).map((host) =>
      buildElementPath(host, config),
    ),
    path: buildElementPath(el, config),
    frameKey: options.frameKey ?? "",
  };
}

export type ElementRefHopOutcome =
  | "resolved"
  | "not-resolved"
  | "no-shadow-root";

export interface ElementRefHop {
  /** 0-based position in `hostChain`; the target is hop `hostChain.length`. */
  hop: number;
  kind: "host" | "target";
  /** The hop's own path as a selector, valid inside the root it was resolved in. */
  selector: string;
  outcome: ElementRefHopOutcome;
  strategy: FindResult["strategy"];
}

export interface HostChainResolution {
  /** The root `path` should be resolved in, or null when the chain broke. */
  root: Document | ShadowRoot | null;
  hops: ElementRefHop[];
  /** Index of the host hop that failed, or null when every host resolved. */
  brokenAtHop: number | null;
}

/**
 * Walk `ref.hostChain` from `doc`, resolving each host with the real
 * `findElement` in its parent root and entering its shadow root through
 * `shadowRootOf` (closed roots included in an extension content script).
 * A failure is reported at the hop where it happened, with that host's
 * selector, never as a generic miss.
 */
export function resolveHostChain(
  ref: ElementRef,
  doc: Document,
  config: DesConfig = AUDIT_DES_CONFIG,
): HostChainResolution {
  const hops: ElementRefHop[] = [];
  let scope: Document | ShadowRoot = doc;
  for (let hop = 0; hop < ref.hostChain.length; hop++) {
    const hostPath = ref.hostChain[hop]!;
    const result = findElement(hostPath, scope, config);
    const selector = pathToSelector(hostPath);
    if (!result.element) {
      hops.push({
        hop,
        kind: "host",
        selector,
        outcome: "not-resolved",
        strategy: null,
      });
      return { root: null, hops, brokenAtHop: hop };
    }
    const shadow = shadowRootOf(result.element);
    if (!shadow) {
      hops.push({
        hop,
        kind: "host",
        selector,
        outcome: "no-shadow-root",
        strategy: result.strategy,
      });
      return { root: null, hops, brokenAtHop: hop };
    }
    hops.push({
      hop,
      kind: "host",
      selector,
      outcome: "resolved",
      strategy: result.strategy,
    });
    scope = shadow;
  }
  return { root: scope, hops, brokenAtHop: null };
}

export interface ElementRefResolution extends HostChainResolution {
  element: Element | null;
  target: FindResult | null;
}

/** Resolve `ref` from the top of `doc`: every host hop, then the element itself in the innermost root. */
export function resolveElementRef(
  ref: ElementRef,
  doc: Document,
  config: DesConfig = AUDIT_DES_CONFIG,
): ElementRefResolution {
  const chain = resolveHostChain(ref, doc, config);
  if (!chain.root) return { ...chain, element: null, target: null };
  const target = findElement(ref.path, chain.root, config);
  chain.hops.push({
    hop: ref.hostChain.length,
    kind: "target",
    selector: pathToSelector(ref.path),
    outcome: target.element ? "resolved" : "not-resolved",
    strategy: target.strategy,
  });
  return { ...chain, element: target.element, target };
}

/** `host >>> host >>> element`, for reports. Diagnostic text: no browser parses `>>>`. */
export function describeElementRef(ref: ElementRef): string {
  return [...ref.hostChain, ref.path]
    .map((path) => pathToSelector(path))
    .join(SHADOW_BOUNDARY);
}

function isElementRef(value: unknown): value is ElementRef {
  const ref = value as Partial<ElementRef> | null;
  return (
    ref !== null &&
    typeof ref === "object" &&
    ref.version === ELEMENT_REF_VERSION &&
    Array.isArray(ref.hostChain) &&
    Array.isArray(ref.path)
  );
}

/**
 * The `ElementRef` a stored sample carries, migrating the pre-`ElementRef`
 * shape: a bare `path` becomes a document-rooted ref with `legacy: true`,
 * because that is all it ever recorded. A ref with an unknown version is
 * rejected (null) rather than guessed at.
 */
export function toElementRef(sample: {
  ref?: unknown;
  path?: unknown;
}): { ref: ElementRef; legacy: boolean } | null {
  if (sample.ref !== undefined) {
    return isElementRef(sample.ref) ? { ref: sample.ref, legacy: false } : null;
  }
  if (Array.isArray(sample.path)) {
    return {
      ref: {
        version: ELEMENT_REF_VERSION,
        hostChain: [],
        path: sample.path as ElementPath,
        frameKey: "",
      },
      legacy: true,
    };
  }
  return null;
}
