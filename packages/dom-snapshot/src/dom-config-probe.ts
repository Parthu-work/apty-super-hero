/**
 * How a settled page keeps changing, for DOM Config's debounce and ignored
 * events (R2.3): mutation bursts and the rate of hover, pointer, scroll and
 * resize events, over a short window after the page settles. Mutations
 * inside noise subtrees (Apty, extensions, overlay vendors) are not
 * counted. Armed, captured and disarmed like the route probe.
 *
 * An automatic capture has no human input: nobody moves the mouse or
 * scrolls, so event rates are usually zero, and the report says "none
 * measured" rather than "none" (DOM Config D6).
 */
import { now } from "./collector-budget.js";
import { walkComposedTree } from "./composed-tree.js";
import type { BehaviorProbe, MutationBurst } from "./dom-profile-types.js";
import {
  type IgnoredRootMatcher,
  ignoredRootOf,
  ignoredRootPolicy,
} from "./ignored-roots.js";
import { shadowRootOf } from "./shadow-roots.js";

export const DEFAULT_PROBE_WINDOW_MS = 3_000;

/** Mutation callbacks closer together than this belong to one burst. */
export const PROBE_BURST_GAP_MS = 100;

/** Events counted, and only when they actually fire. */
export const PROBED_EVENTS = [
  "mousemove",
  "mouseover",
  "mouseout",
  "pointermove",
  "pointerover",
  "pointerout",
  "scroll",
  "wheel",
  "resize",
  "touchmove",
] as const;

export interface BehaviorProbeOptions {
  windowMs?: number;
  /** Settings → Troubleshooting entries, on top of the default noise list. */
  ignoredRoots?: readonly string[];
  /** The clock; tests pass their own. */
  clock?: () => number;
}

export interface BehaviorProbeHandle {
  capture(): BehaviorProbe;
  disarm(): void;
}

function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  const parent = node.parentNode;
  if (!parent) return null;
  if (parent.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    return (parent as ShadowRoot).host ?? null;
  }
  return parent.nodeType === Node.ELEMENT_NODE ? (parent as Element) : null;
}

function isNoise(
  node: Node | null,
  policy: readonly IgnoredRootMatcher[],
): boolean {
  const element = elementOf(node);
  return element !== null && ignoredRootOf(element, policy) !== null;
}

function bursts(callbacks: Array<{ at: number; count: number }>): {
  bursts: MutationBurst[];
  gaps: number[];
} {
  const found: Array<{ first: number; last: number; count: number }> = [];
  for (const callback of callbacks) {
    const current = found.at(-1);
    if (current && callback.at - current.last <= PROBE_BURST_GAP_MS) {
      current.last = callback.at;
      current.count += callback.count;
    } else {
      found.push({
        first: callback.at,
        last: callback.at,
        count: callback.count,
      });
    }
  }
  return {
    bursts: found.map((b) => ({
      durationMs: Math.round(b.last - b.first),
      mutationCount: b.count,
    })),
    gaps: found.slice(1).map((b, i) => Math.round(b.first - found[i]!.last)),
  };
}

/** Start watching `doc` (and every shadow root in it now) until `disarm`. */
export function armBehaviorProbe(
  doc: Document,
  options: BehaviorProbeOptions = {},
): BehaviorProbeHandle {
  const clock = options.clock ?? now;
  const windowMs = options.windowMs ?? DEFAULT_PROBE_WINDOW_MS;
  const policy = ignoredRootPolicy(options.ignoredRoots);
  const armedAt = clock();
  const callbacks: Array<{ at: number; count: number }> = [];
  const events = new Map<string, number>();

  const record = (records: MutationRecord[]) => {
    const count = records.filter((r) => !isNoise(r.target, policy)).length;
    if (count > 0) callbacks.push({ at: clock(), count });
  };
  const observer = new MutationObserver(record);
  const watch = { subtree: true, childList: true, attributes: true };
  observer.observe(doc, watch);
  walkComposedTree(doc, (element) => {
    const root = shadowRootOf(element);
    if (root) observer.observe(root, watch);
  });

  const onEvent = (event: Event) => {
    if (isNoise(event.target instanceof Node ? event.target : null, policy)) {
      return;
    }
    events.set(event.type, (events.get(event.type) ?? 0) + 1);
  };
  const view = doc.defaultView;
  for (const type of PROBED_EVENTS) {
    view?.addEventListener(type, onEvent, { capture: true, passive: true });
  }

  return {
    capture() {
      record(observer.takeRecords());
      const elapsedMs = Math.max(0, clock() - armedAt);
      const seconds = elapsedMs / 1000;
      const { bursts: mutationBursts, gaps } = bursts(callbacks);
      const eventRates: Record<string, number> = {};
      for (const [type, count] of [...events].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      )) {
        eventRates[type] =
          seconds > 0 ? Math.round((count / seconds) * 100) / 100 : count;
      }
      return {
        ran: true,
        windowMs,
        mutationBursts,
        burstGapsMs: gaps,
        eventRates,
        ranToCompletion: elapsedMs >= windowMs,
      };
    },
    disarm() {
      observer.disconnect();
      for (const type of PROBED_EVENTS) {
        view?.removeEventListener(type, onEvent, { capture: true });
      }
    },
  };
}
