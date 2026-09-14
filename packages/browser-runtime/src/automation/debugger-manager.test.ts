import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebuggerManager } from "./debugger-manager";

/**
 * Regression coverage for a real finding: `safeAttachDebugger` used to call
 * `chrome.scripting.executeScript` on every attach to find-and-remove any
 * `<iframe src="chrome-extension://...">` on the page (including inside
 * Shadow DOM), unconditionally and with no scoping to this extension's own
 * id. That is destructive DOM mutation of the customer's live page as a
 * side effect of merely enabling diagnostics — exactly the "diagnostics
 * must not create the problem being diagnosed" failure mode this product
 * exists to avoid (e.g. it could delete Apty's own Widget iframe while
 * investigating "why isn't the widget showing"). It was undocumented,
 * untested, and inherited unchanged from the original AIPex import — no
 * evidence exists that it was ever actually required for a real attach
 * failure. Removed; these tests pin down that `executeScript` is never
 * invoked as part of attach/detach and that attach/detach still work.
 */
describe("DebuggerManager — does not mutate the page to attach", () => {
  let mockAttach: ReturnType<typeof vi.fn>;
  let mockDetach: ReturnType<typeof vi.fn>;
  let mockExecuteScript: ReturnType<typeof vi.fn>;
  let manager: DebuggerManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mockAttach = vi.fn((_target, _version, callback) => callback());
    mockDetach = vi.fn((_target, callback) => callback());
    mockExecuteScript = vi.fn();

    (global as any).chrome = {
      debugger: {
        attach: mockAttach,
        detach: mockDetach,
        onDetach: { addListener: vi.fn() },
      },
      tabs: { onRemoved: { addListener: vi.fn() } },
      scripting: { executeScript: mockExecuteScript },
      runtime: { lastError: undefined },
    };

    manager = new DebuggerManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("attaches without ever calling chrome.scripting.executeScript", async () => {
    const result = await manager.safeAttachDebugger(1);

    expect(result).toBe(true);
    expect(mockAttach).toHaveBeenCalledWith(
      { tabId: 1 },
      "1.3",
      expect.any(Function),
    );
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });

  it("detaches immediately without calling chrome.scripting.executeScript", async () => {
    await manager.safeAttachDebugger(1);
    await manager.safeDetachDebugger(1, true);

    expect(mockDetach).toHaveBeenCalledWith({ tabId: 1 }, expect.any(Function));
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });

  it("reuses an already-attached tab without re-attaching or mutating the page", async () => {
    await manager.safeAttachDebugger(1);
    mockAttach.mockClear();

    const second = await manager.safeAttachDebugger(1);

    expect(second).toBe(true);
    expect(mockAttach).not.toHaveBeenCalled();
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });

  it("returns false when chrome.debugger.attach reports an error, without mutating the page", async () => {
    (global as any).chrome.runtime.lastError = { message: "Cannot attach" };
    mockAttach.mockImplementation((_target, _version, callback) => callback());

    const result = await manager.safeAttachDebugger(2);

    expect(result).toBe(false);
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });

  it("auto-detaches after the inactivity timeout", async () => {
    await manager.safeAttachDebugger(1);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockDetach).toHaveBeenCalledWith({ tabId: 1 }, expect.any(Function));
  });
});
