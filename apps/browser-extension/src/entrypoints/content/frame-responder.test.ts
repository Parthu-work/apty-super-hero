import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addListener = vi.hoisted(() => vi.fn());
vi.hoisted(() => {
  (globalThis as any).chrome = {
    runtime: { id: "agent-id", onMessage: { addListener } },
  };
});

import {
  collectShadowRoots,
  handleFrameMessage,
  installFrameResponder,
  waitForDomToStabilize,
} from "./frame-responder";

function ask(message: unknown): Promise<any> {
  return new Promise((resolve) => {
    const handled = handleFrameMessage(message, resolve);
    if (!handled) resolve(undefined);
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("frame responder", () => {
  it("registers its listener as soon as the script loads, with no UI mount", () => {
    expect(addListener).toHaveBeenCalledTimes(1);
  });

  it("does not install twice for the same live extension instance", () => {
    expect(installFrameResponder()).toBe(false);
    expect(addListener).toHaveBeenCalledTimes(1);
  });

  it("reinstalls when the previous responder belongs to a reloaded extension", () => {
    const previous = (globalThis as any).chrome;
    (globalThis as any).chrome = {
      runtime: { id: "agent-id", onMessage: { addListener } },
    };

    expect(installFrameResponder()).toBe(true);
    expect(addListener).toHaveBeenCalledTimes(2);
    (globalThis as any).chrome = previous;
  });

  it("answers a ping", async () => {
    await expect(ask({ request: "dom-health-ping" })).resolves.toEqual({
      success: true,
      data: { pong: true },
    });
  });

  it("leaves messages meant for the UI script unanswered", async () => {
    expect(handleFrameMessage({ request: "open-apty-agent" }, vi.fn())).toBe(
      false,
    );
  });

  it("counts history API navigation for the SPA navigation model", async () => {
    history.pushState({}, "", "#/next");

    const response = await ask({ request: "get-dom-health-navigation-model" });

    expect(response.data.usesHistoryApiRouting).toBe(true);
    expect(response.data.historyApiCallCount).toBeGreaterThan(0);
  });

  it("refuses to click a control that is not a verified navigation candidate", async () => {
    document.body.innerHTML = '<button id="delete">Delete account</button>';
    const button = document.getElementById("delete") as HTMLButtonElement;
    const click = vi.spyOn(button, "click");

    const response = await ask({
      request: "click-safe-navigation-candidate",
      domPath: "#delete",
    });

    expect(response.data.clicked).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });
});

describe("waitForDomToStabilize", () => {
  it("finds nested shadow roots", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const outer = host.attachShadow({ mode: "open" });
    const inner = document.createElement("span");
    outer.append(inner);
    const innerRoot = inner.attachShadow({ mode: "open" });

    expect(collectShadowRoots(document.body)).toEqual([outer, innerRoot]);
  });

  it("treats mutations inside a shadow tree as activity", async () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });

    const result = waitForDomToStabilize(100, 1000);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(60);
      shadow.append(document.createElement("p"));
    }
    await vi.advanceTimersByTimeAsync(200);

    const { settled, elapsedMs } = await result;
    expect(settled).toBe(true);
    expect(elapsedMs).toBeGreaterThanOrEqual(400);
  });
});
