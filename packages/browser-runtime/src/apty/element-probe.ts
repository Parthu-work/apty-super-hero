/**
 * Runs a stored selector in every frame of a tab through each frame's
 * responder (`test-apty-element`), so a check can tell a selector that
 * matches nothing from one that matches only inside a child frame. Only the
 * counts and each frame's place in the tree come back; no URL is kept.
 */
import type {
  StoredElementTarget,
  StoredElementTest,
} from "@apty/dom-snapshot";
import { isUnsupportedPage } from "./dom-health.js";
import { getFrameTree, sendFrameMessage } from "./frame-tree.js";

const FRAME_TIMEOUT_MS = 3000;

export interface FrameProbe {
  /** 0 for the top document, 1 for its frames, and so on. */
  depth: number;
  sameOriginAsTop: boolean;
  /** The frame's responder answered; a cross-origin or failed frame may not. */
  answered: boolean;
  test?: StoredElementTest;
}

export type ElementProbe =
  | { ok: true; frames: FrameProbe[] }
  | { ok: false; reason: "no-page" | "frames-unreadable" };

/** @internal */
export async function probeStoredElement(
  tabId: number,
  target: StoredElementTarget,
): Promise<ElementProbe> {
  const tree = await getFrameTree(tabId);
  if (!tree) return { ok: false, reason: "frames-unreadable" };
  const topOrigin = tree.find((f) => f.frameType === "top")?.origin ?? null;
  const frames = await Promise.all(
    tree
      .filter((frame) => !frame.isAboutBlank)
      .map(async (frame): Promise<FrameProbe> => {
        const place = {
          depth: frame.depth,
          sameOriginAsTop: frame.origin !== null && frame.origin === topOrigin,
        };
        if (frame.errorOccurred) return { ...place, answered: false };
        const reply = await sendFrameMessage<StoredElementTest>(
          tabId,
          frame.frameId,
          { request: "test-apty-element", target },
          FRAME_TIMEOUT_MS,
        );
        return reply.success && reply.data
          ? { ...place, answered: true, test: reply.data }
          : { ...place, answered: false };
      }),
  );
  return { ok: true, frames: frames.sort((a, b) => a.depth - b.depth) };
}

/** The probe for the conversation's tab, or one that names why there is no page to probe. */
export function tabElementProbeOf(
  runContext: unknown,
): (target: StoredElementTarget) => Promise<ElementProbe> {
  return async (target) => {
    const tabId = (runContext as { tabId?: unknown } | undefined)?.tabId;
    if (typeof tabId !== "number") return { ok: false, reason: "no-page" };
    let url: string | undefined;
    try {
      url = (await chrome.tabs.get(tabId)).url;
    } catch {
      return { ok: false, reason: "no-page" };
    }
    if (isUnsupportedPage(url) || !/^https?:/i.test(url ?? "")) {
      return { ok: false, reason: "no-page" };
    }
    return probeStoredElement(tabId, target);
  };
}
