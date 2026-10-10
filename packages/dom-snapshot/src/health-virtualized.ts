/**
 * Virtualized lists (brief WP B4). A virtualized grid or list renders only
 * the rows in view, so an audit of the DOM sees a fraction of the
 * application's controls and can look healthier, or emptier, than it is.
 * This finds the signs of one, so the report can say coverage is partial
 * instead of passing cleanly.
 *
 * Signals, each read from the composed tree:
 * - `aria-count`: `aria-rowcount`, `aria-colcount` or `aria-setsize`
 *   declares more items than are rendered (or -1, "unknown").
 * - `index-gap`: siblings carry `data-index` / `data-row-index` values that
 *   don't start at 0 or skip numbers.
 * - `spacer`: an empty child with an explicit height of at least
 *   `SPACER_MIN_PX` stands in for rows that are not rendered.
 * - `scroll-height`: a list-like container scrolls far further than its
 *   rendered items are tall.
 *
 * The thresholds are general knowledge of react-window, react-virtualized,
 * AG Grid and TanStack Virtual, not measured on the two applications.
 */
import { walkComposedTree } from "./composed-tree.js";

export type VirtualizationSignal =
  | "aria-count"
  | "index-gap"
  | "spacer"
  | "scroll-height";

export interface VirtualizedContainer {
  /** The container's role, or its tag when it has none. */
  role: string;
  signals: VirtualizationSignal[];
  observedItems: number;
  /** How many items the container says it has (or at least has); null when unknown. */
  declaredTotal: number | null;
}

export interface VirtualizedListSummary {
  containers: number;
  observedItems: number;
  /** Sum of the declared totals; null when any container's total is unknown. */
  declaredTotal: number | null;
  /** Up to `MAX_SAMPLES` containers, for the report. */
  samples: VirtualizedContainer[];
}

/** An empty element at least this tall (inline style) is taken for a spacer. Unverified threshold. */
export const SPACER_MIN_PX = 500;
/** Scroll height at least this many times the rendered items' height. Unverified threshold. */
export const SCROLL_HEIGHT_RATIO = 2;
/** ... and at least this many pixels more. Unverified threshold. */
export const SCROLL_HEIGHT_EXCESS_PX = 1_000;

const MAX_SAMPLES = 5;
const MAX_ELEMENTS_SCANNED = 50_000;

const LIST_ROLES = new Set([
  "grid",
  "treegrid",
  "list",
  "listbox",
  "tree",
  "table",
]);
const LIST_TAGS = new Set(["ul", "ol", "table", "tbody"]);
const ITEM_SELECTOR =
  '[role="row"], [role="listitem"], [role="option"], [role="treeitem"], li, tr, [data-index], [data-row-index]';

interface Finding {
  signals: Set<VirtualizationSignal>;
  observed: number;
  declared: number | null;
}

function roleOf(element: Element): string {
  return element.getAttribute("role") ?? element.tagName.toLowerCase();
}

function intAttr(element: Element, name: string): number | null {
  const raw = element.getAttribute(name);
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

function inlinePx(element: Element, property: "height" | "minHeight"): number {
  const style = (element as HTMLElement).style;
  const value = style?.[property] ?? "";
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
  return match ? Number(match[1]) : 0;
}

function itemsUnder(container: Element): Element[] {
  return Array.from(container.querySelectorAll(ITEM_SELECTOR));
}

export function detectVirtualizedLists(
  root: Document | ShadowRoot,
): VirtualizedListSummary {
  const findings = new Map<Element, Finding>();
  const finding = (container: Element): Finding => {
    let entry = findings.get(container);
    if (!entry) {
      entry = { signals: new Set(), observed: 0, declared: null };
      findings.set(container, entry);
    }
    return entry;
  };
  const record = (
    container: Element,
    signal: VirtualizationSignal,
    observed: number,
    declared: number | null,
  ) => {
    const entry = finding(container);
    entry.signals.add(signal);
    entry.observed = Math.max(entry.observed, observed);
    if (declared !== null) {
      entry.declared = Math.max(entry.declared ?? 0, declared);
    }
  };
  const checkedParents = new Set<Element>();

  walkComposedTree(
    root,
    (element) => {
      const rowCount = intAttr(element, "aria-rowcount");
      if (rowCount !== null) {
        const rows = element.querySelectorAll('[role="row"], tr').length;
        if (rowCount === -1 || rowCount > rows) {
          record(
            element,
            "aria-count",
            rows,
            rowCount === -1 ? null : rowCount,
          );
        }
      }
      const colCount = intAttr(element, "aria-colcount");
      if (colCount !== null) {
        const firstRow = element.querySelector('[role="row"], tr');
        const cells = firstRow
          ? firstRow.querySelectorAll(
              '[role="gridcell"], [role="columnheader"], [role="cell"], td, th',
            ).length
          : 0;
        if (colCount === -1 || colCount > cells) {
          record(
            element,
            "aria-count",
            cells,
            colCount === -1 ? null : colCount,
          );
        }
      }

      const parent = element.parentElement;
      if (parent && !checkedParents.has(parent)) {
        checkedParents.add(parent);
        const children = Array.from(parent.children);

        const setSizes = children
          .map((child) => intAttr(child, "aria-setsize"))
          .filter((size): size is number => size !== null);
        if (setSizes.length > 0) {
          const declared = Math.max(...setSizes);
          if (setSizes.includes(-1) || declared > setSizes.length) {
            record(
              parent,
              "aria-count",
              setSizes.length,
              setSizes.includes(-1) ? null : declared,
            );
          }
        }

        const indices = children
          .map(
            (child) =>
              intAttr(child, "data-index") ?? intAttr(child, "data-row-index"),
          )
          .filter((index): index is number => index !== null && index >= 0);
        if (indices.length > 0) {
          const min = Math.min(...indices);
          const max = Math.max(...indices);
          if (min > 0 || max - min + 1 > indices.length) {
            record(parent, "index-gap", indices.length, max + 1);
          }
        }

        const spacers = children.filter(
          (child) =>
            child.childElementCount === 0 &&
            !(child.textContent ?? "").trim() &&
            Math.max(inlinePx(child, "height"), inlinePx(child, "minHeight")) >=
              SPACER_MIN_PX,
        );
        if (spacers.length > 0 && children.length - spacers.length >= 2) {
          record(parent, "spacer", children.length - spacers.length, null);
        }
      }

      if (
        LIST_ROLES.has(element.getAttribute("role") ?? "") ||
        LIST_TAGS.has(element.tagName.toLowerCase())
      ) {
        const items = itemsUnder(element);
        if (items.length > 0) {
          const itemsHeight = items.reduce(
            (sum, item) => sum + item.getBoundingClientRect().height,
            0,
          );
          const scrollHeight = element.scrollHeight;
          if (
            itemsHeight > 0 &&
            scrollHeight >= itemsHeight * SCROLL_HEIGHT_RATIO &&
            scrollHeight - itemsHeight >= SCROLL_HEIGHT_EXCESS_PX
          ) {
            record(element, "scroll-height", items.length, null);
          }
        }
      }
      return true;
    },
    { maxElements: MAX_ELEMENTS_SCANNED },
  );

  // One list is often flagged twice: the grid by its aria-rowcount and its
  // row wrapper by an index gap or a spacer. Fold each finding into the
  // outermost flagged ancestor so the list counts once.
  for (const element of [...findings.keys()]) {
    let ancestor = element.parentElement;
    let outer: Element | null = null;
    while (ancestor) {
      if (findings.has(ancestor)) outer = ancestor;
      ancestor = ancestor.parentElement;
    }
    if (!outer) continue;
    const inner = findings.get(element)!;
    const target = findings.get(outer)!;
    for (const signal of inner.signals) target.signals.add(signal);
    target.observed = Math.max(target.observed, inner.observed);
    if (inner.declared !== null) {
      target.declared = Math.max(target.declared ?? 0, inner.declared);
    }
    findings.delete(element);
  }

  const containers: VirtualizedContainer[] = [...findings].map(
    ([element, f]) => ({
      role: roleOf(element),
      signals: [...f.signals].sort(),
      observedItems: f.observed,
      declaredTotal: f.declared,
    }),
  );
  const anyUnknown = containers.some((c) => c.declaredTotal === null);
  return {
    containers: containers.length,
    observedItems: containers.reduce((sum, c) => sum + c.observedItems, 0),
    declaredTotal: anyUnknown
      ? null
      : containers.reduce((sum, c) => sum + (c.declaredTotal ?? 0), 0),
    samples: containers.slice(0, MAX_SAMPLES),
  };
}

export const NO_VIRTUALIZED_LISTS: VirtualizedListSummary = {
  containers: 0,
  observedItems: 0,
  declaredTotal: 0,
  samples: [],
};

/** Merge per-frame summaries; a total is unknown when any frame's is. */
export function mergeVirtualizedLists(
  summaries: readonly (VirtualizedListSummary | undefined)[],
): VirtualizedListSummary {
  const present = summaries.filter(
    (s): s is VirtualizedListSummary => s !== undefined,
  );
  return {
    containers: present.reduce((sum, s) => sum + s.containers, 0),
    observedItems: present.reduce((sum, s) => sum + s.observedItems, 0),
    declaredTotal: present.some((s) => s.declaredTotal === null)
      ? null
      : present.reduce((sum, s) => sum + (s.declaredTotal ?? 0), 0),
    samples: present.flatMap((s) => s.samples).slice(0, MAX_SAMPLES),
  };
}
