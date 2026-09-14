/**
 * Selector diagnostics tool.
 *
 * Apty's core recurring debugging question is "why can't Studio/a Workflow
 * select this element" — this tool answers it directly instead of leaving
 * the model to eyeball a selector string. Given an element already located
 * via `search_elements`/`take_snapshot` (its snapshot `uid`), it:
 *
 * 1. Reads the live element's tag/id/classes/attributes/text and its
 *    ancestor chain, plus whether it sits inside an iframe or Shadow DOM.
 * 2. Generates ranked candidate selectors (see `../automation/selector-analysis.ts`)
 *    — data-apty-* attributes first, then stable id, aria, semantic
 *    attributes, stable classes, text, and structural path as a last
 *    resort — flagging dynamic-looking values (hashes, UUIDs, CSS-in-JS
 *    prefixes, purely numeric ids) as unstable.
 * 3. Tests every candidate against the live page (how many elements it
 *    matches, and whether the target is among them) so the verdict isn't
 *    just a guess.
 *
 * CDP-mode snapshots only (requires a `backendDOMNodeId`) — DOM-mode
 * snapshots don't expose one. This is an honest limitation, not silently
 * degraded behavior: see `DECISIONS.md`'s "Apty diagnostics are honest
 * stubs" precedent.
 */
import { tool } from "@aipexstudio/aipex-core";
import { z } from "zod";
import { redactSensitiveText } from "../apty/redact.js";
import { CdpCommander } from "../automation/cdp-commander.js";
import { debuggerManager } from "../automation/debugger-manager.js";
import {
  type ElementDescriptor,
  formatSelectorReport,
  generateSelectorCandidates,
  type LiveSelectorResult,
  rankSelectorCandidates,
} from "../automation/selector-analysis.js";
import * as snapshotProvider from "../automation/snapshot-provider.js";

interface RawElementDescription {
  tagName: string;
  classes: string[];
  attributes: Record<string, string>;
  textContent: string;
  ancestors: Array<{
    tagName: string;
    classes: string[];
    attributes: Record<string, string>;
  }>;
  inShadowDom: boolean;
  inIframe: boolean;
}

/** Runs bound to the target element (`this`). Kept as a plain function body string — this executes inside the untrusted page via CDP `Runtime.callFunctionOn`, not in extension context. */
const DESCRIBE_ELEMENT_FN = `function() {
  function describe(el) {
    const attrs = {};
    for (const attr of (el.attributes || [])) { attrs[attr.name] = attr.value; }
    return {
      tagName: el.tagName,
      classes: Array.from(el.classList || []),
      attributes: attrs,
    };
  }

  const self = describe(this);
  const text = (this.textContent || "").trim().slice(0, 200);

  const ancestors = [];
  let node = this.parentElement;
  let depth = 0;
  while (node && depth < 5) {
    ancestors.push(describe(node));
    node = node.parentElement;
    depth++;
  }

  let inShadowDom = false;
  try {
    inShadowDom = typeof ShadowRoot !== "undefined" && this.getRootNode() instanceof ShadowRoot;
  } catch (e) {}

  let inIframe = false;
  try {
    inIframe = window.self !== window.top;
  } catch (e) {
    inIframe = true; // cross-origin access threw — we're in a foreign frame
  }

  return Object.assign({}, self, { textContent: text, ancestors, inShadowDom, inIframe });
}`;

/** Runs bound to the target element (`this`); `selectors` is the candidate list to test. CSS candidates are scoped to the element's root (pierces into the containing Shadow root when relevant); `//`-prefixed candidates are evaluated as XPath. */
const TEST_SELECTORS_FN = `function(selectors) {
  const results = [];
  for (const sel of selectors) {
    let matchCount = -1;
    let matchesTarget = false;
    try {
      if (sel.indexOf("//") === 0) {
        const xpathResult = document.evaluate(sel, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        matchCount = xpathResult.snapshotLength;
        for (let i = 0; i < xpathResult.snapshotLength; i++) {
          if (xpathResult.snapshotItem(i) === this) { matchesTarget = true; break; }
        }
      } else {
        const root = (this.getRootNode && this.getRootNode()) || document;
        const matches = root.querySelectorAll(sel);
        matchCount = matches.length;
        matchesTarget = Array.prototype.indexOf.call(matches, this) !== -1;
      }
    } catch (e) {
      matchCount = -1;
      matchesTarget = false;
    }
    results.push({ selector: sel, matchCount: matchCount, matchesTarget: matchesTarget });
  }
  return results;
}`;

function toElementDescriptor(raw: RawElementDescription): ElementDescriptor {
  return {
    tagName: raw.tagName,
    id: raw.attributes?.id,
    classes: raw.classes ?? [],
    attributes: redactAttributeValues(raw.attributes ?? {}),
    textContent: redactSensitiveText(raw.textContent ?? ""),
    ancestors: (raw.ancestors ?? []).map((a) => ({
      tagName: a.tagName,
      id: a.attributes?.id,
      classes: a.classes ?? [],
      attributes: redactAttributeValues(a.attributes ?? {}),
    })),
    inIframe: raw.inIframe,
    inShadowDom: raw.inShadowDom,
  };
}

function redactAttributeValues(
  attributes: Record<string, string>,
): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    redacted[key] = redactSensitiveText(value);
  }
  return redacted;
}

export const analyzeElementSelectorsTool = tool({
  name: "analyze_element_selectors",
  description:
    "Analyze an element (found via search_elements/take_snapshot's uid) and recommend a stable CSS/XPath selector for it — Apty's core 'why can't Studio select this element' question. " +
    "Generates candidate selectors (data-apty-* attributes, id, aria attributes, semantic attributes, stable classes, text, structural path as last resort), flags dynamic-looking values (hashes, UUIDs, CSS-in-JS class names, purely numeric ids), and tests every candidate against the live page to report how many elements it actually matches. " +
    "Use this before configuring a Workflow step/selector, or when diagnosing why an existing selector isn't matching — it's a definitive check, not a guess. " +
    "Only works for elements found via a CDP-mode snapshot (the default); reports unavailable for DOM-mode snapshots.",
  parameters: z.object({
    tabId: z.number().describe("The ID of the tab the element is on"),
    uid: z
      .string()
      .describe(
        "The unique identifier of an element from the page snapshot (from search_elements or take_snapshot)",
      ),
  }),
  execute: async ({ tabId, uid }) => {
    const node = snapshotProvider.getNodeByUid(tabId, uid);
    if (!node) {
      return {
        available: false,
        message:
          "No such element in the current snapshot — the page content may have changed. Call search_elements again to get a fresh snapshot.",
      };
    }

    if (!node.backendDOMNodeId) {
      return {
        available: false,
        message:
          "Selector analysis requires a CDP-mode snapshot (this element was found in DOM mode, which doesn't expose a backend node id).",
      };
    }

    const attached = await debuggerManager.safeAttachDebugger(tabId);
    if (!attached) {
      return {
        available: false,
        message: "Failed to attach the debugger to this tab.",
      };
    }

    let objectId: string | undefined;
    try {
      const cdp = new CdpCommander(tabId);
      await cdp.sendCommand("DOM.enable", {});

      const resolved = await cdp.sendCommand<{
        object?: { objectId?: string };
      }>("DOM.resolveNode", { backendNodeId: node.backendDOMNodeId });
      objectId = resolved?.object?.objectId;
      if (!objectId) {
        return {
          available: false,
          message:
            "Could not resolve the element on the live page — it may have been removed or navigated away from. Call search_elements again.",
        };
      }

      const describeResult = await cdp.sendCommand<{
        result?: { value?: RawElementDescription };
      }>("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: DESCRIBE_ELEMENT_FN,
        returnByValue: true,
      });

      const raw = describeResult?.result?.value;
      if (!raw) {
        return {
          available: false,
          message: "Could not read the element's attributes from the page.",
        };
      }

      const descriptor = toElementDescriptor(raw);
      const candidates = generateSelectorCandidates(descriptor);

      let liveResults: Map<string, LiveSelectorResult> | undefined;
      if (candidates.length > 0) {
        const testResult = await cdp.sendCommand<{
          result?: {
            value?: Array<{
              selector: string;
              matchCount: number;
              matchesTarget: boolean;
            }>;
          };
        }>("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: TEST_SELECTORS_FN,
          arguments: [{ value: candidates.map((c) => c.selector) }],
          returnByValue: true,
        });

        const results = testResult?.result?.value ?? [];
        liveResults = new Map(
          results.map((r) => [
            r.selector,
            { matchCount: r.matchCount, matchesTarget: r.matchesTarget },
          ]),
        );
      }

      const ranked = rankSelectorCandidates(candidates, liveResults);
      const recommended = ranked.find((r) => r.verdict === "recommended");

      return {
        available: true,
        tagName: descriptor.tagName,
        inIframe: descriptor.inIframe ?? false,
        inShadowDom: descriptor.inShadowDom ?? false,
        recommendedSelector: recommended?.selector,
        candidates: ranked,
        report: formatSelectorReport(ranked),
      };
    } finally {
      if (objectId) {
        const cdp = new CdpCommander(tabId);
        await cdp
          .sendCommand("Runtime.releaseObject", { objectId })
          .catch(() => {});
      }
      await debuggerManager.safeDetachDebugger(tabId);
    }
  },
});

export const selectorTools = [analyzeElementSelectorsTool];
