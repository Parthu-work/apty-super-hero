/**
 * Frame identity and frame-addressed messaging for the DOM Health audit
 * (forensic audit RC-1/RC-2).
 *
 * The previous implementation sent every DOM Health message via
 * `chrome.tabs.sendMessage(tabId, message)` with no `frameId`. The content
 * script is registered with `all_frames: true` (see the extension
 * manifest), so that call is delivered to EVERY frame's content-script
 * instance in the tab, and whichever one happens to answer first is what
 * the caller gets back — a non-deterministic race with exactly one frame
 * (this document) on a simple page, and an arbitrary, unaddressed frame on
 * a page built from a frameset/iframe shell.
 *
 * This module fixes that by enumerating the tab's real frame tree via
 * `chrome.webNavigation.getAllFrames` (already a declared manifest
 * permission) and addressing every message at an explicit `frameId`. This
 * is a browser-level, navigation-model concept: it treats a legacy
 * `<frame>` exactly like an `<iframe>`, because both are separate browsing
 * contexts to the browser, not something distinguished by DOM tag — so
 * this single mechanism fixes both the frame-targeting race (RC-1) and
 * legacy frameset/frame blindness (RC-2) without needing any special-cased
 * `<frame>` DOM-traversal code anywhere.
 *
 * Deliberately does NOT use the `chrome.debugger`/CDP frame-tree
 * infrastructure that `automation/iframe-manager.ts` uses elsewhere in this
 * codebase: that path requires attaching the debugger to the tab (a
 * visible "this page is being debugged" banner, and a heavier lifecycle),
 * which would be a significant, unrequested behavior change for a feature
 * designed to run silently from the side panel. `chrome.webNavigation` is
 * already relied on for read-only frame identity and needs no attach step.
 * If a future need arises to map a specific `<iframe>`/`<frame>` DOM
 * element to its `frameId` (e.g. for UI highlighting), that is exactly what
 * `iframe-manager.ts`'s `DOM.getFrameOwner` approach is for — this module
 * does not attempt or need that mapping, because every frame audits only
 * its own document.
 */

export interface AuditFrame {
  frameId: number;
  parentFrameId: number;
  url: string;
  origin: string | null;
  /** 0 for the top frame, 1 for its direct children, and so on — derived from walking `parentFrameId` back to the top frame. */
  depth: number;
  frameType: "top" | "child";
  /** True when the browser itself reports this frame failed to load (`webNavigation`'s own `errorOccurred`) — never guessed. */
  errorOccurred: boolean;
  /** True for a frame parked at `about:blank` (a common placeholder before a real navigation) — still reported, never silently dropped, but excluded from capture by default. */
  isAboutBlank: boolean;
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Enumerate every frame in the tab via `chrome.webNavigation.getAllFrames`
 * — the browser's own authoritative frame tree, not a guess reconstructed
 * from content-script broadcasts. Returns `null` (never throws) when the
 * tab cannot be inspected at all (closed, or the API itself failed) so
 * callers can report FAILED explicitly rather than crash.
 */
export async function getFrameTree(
  tabId: number,
): Promise<AuditFrame[] | null> {
  let rawFrames: chrome.webNavigation.GetAllFrameResultDetails[] | null;
  try {
    rawFrames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch {
    return null;
  }
  if (!rawFrames) return null;

  const byId = new Map(rawFrames.map((f) => [f.frameId, f]));
  const depthCache = new Map<number, number>();

  function computeDepth(frameId: number, guard = 0): number {
    if (guard > 32) return guard; // pathological/cyclic parent chain — bail rather than loop forever
    const cached = depthCache.get(frameId);
    if (cached !== undefined) return cached;
    const frame = byId.get(frameId);
    if (!frame || frame.parentFrameId < 0) {
      depthCache.set(frameId, 0);
      return 0;
    }
    const depth = 1 + computeDepth(frame.parentFrameId, guard + 1);
    depthCache.set(frameId, depth);
    return depth;
  }

  return rawFrames
    .map((f) => ({
      frameId: f.frameId,
      parentFrameId: f.parentFrameId,
      url: f.url,
      origin: safeOrigin(f.url),
      depth: computeDepth(f.frameId),
      frameType: f.frameId === 0 ? ("top" as const) : ("child" as const),
      errorOccurred: f.errorOccurred,
      isAboutBlank: f.url === "about:blank",
    }))
    .sort((a, b) => a.depth - b.depth || a.frameId - b.frameId);
}

/** Honest, evidence-level summary of how much of the tab's frame tree was actually reachable — the input `dom-health-scoring.ts`'s `determineEvidenceState` uses to tell "genuinely nothing here" apart from "we couldn't see everything". */
export interface FrameAccessibilitySummary {
  framesTotal: number;
  framesAccessible: number;
  /** Content-script unreachable, timed out, or the browser itself reported `errorOccurred`. */
  framesFailed: number;
  /** Reached, but a boundary inside it blocked meaningful inspection (e.g. entirely closed-shadow-DOM content) — a best-effort signal, not exhaustive. */
  framesInaccessible: number;
}

export interface FrameMessageResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Send a message to exactly one frame, by `frameId` — never a broadcast.
 * Resolves rather than rejects on any failure (timeout, unreachable frame,
 * `chrome.runtime.lastError`) so callers can build an explicit
 * accessibility picture instead of an unhandled rejection.
 */
export function sendFrameMessage<T>(
  tabId: number,
  frameId: number,
  message: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<FrameMessageResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({
        success: false,
        error: "Timed out waiting for this frame to respond.",
      });
    }, timeoutMs);

    try {
      chrome.tabs.sendMessage(
        tabId,
        message,
        { frameId },
        (response: FrameMessageResult<T> | undefined) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error:
                chrome.runtime.lastError.message ??
                "Could not reach this frame.",
            });
            return;
          }
          if (!response?.success) {
            resolve({
              success: false,
              error: response?.error ?? "Frame reported failure.",
            });
            return;
          }
          resolve(response);
        },
      );
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to message this frame.",
      });
    }
  });
}

/** Lightweight reachability probe — used to build frame accessibility evidence without paying for a full snapshot collection. */
export async function pingFrame(
  tabId: number,
  frameId: number,
  timeoutMs = 3000,
): Promise<boolean> {
  const result = await sendFrameMessage<{ pong: true }>(
    tabId,
    frameId,
    { request: "dom-health-ping" },
    timeoutMs,
  );
  return result.success;
}
