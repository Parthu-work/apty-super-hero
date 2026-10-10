import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addListener = vi.hoisted(() => vi.fn());
const sendMessage = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.hoisted(() => {
  (globalThis as any).chrome = {
    runtime: { id: "agent-id", onMessage: { addListener }, sendMessage },
  };
});

import { collectDomHealthSnapshot } from "@apty/dom-snapshot";
import {
  collectShadowRoots,
  handleFrameMessage,
  installFrameResponder,
  noteProbeClick,
  recordFirstRequest,
  waitForDomToStabilize,
  waitForFrameToSettle,
} from "./frame-responder";
import { HISTORY_API_EVENT, SHADOW_ATTACHED_EVENT } from "./page-events";

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

  it("clicks a navigation candidate that lives inside a shadow root, by its composed path", async () => {
    document.body.innerHTML = "<x-shell></x-shell>";
    const shadow = document
      .querySelector("x-shell")!
      .attachShadow({ mode: "open" });
    shadow.innerHTML = '<nav><div role="menuitem">Orders</div></nav>';
    const item = shadow.querySelector<HTMLElement>('[role="menuitem"]')!;
    const click = vi.spyOn(item, "click");
    const [candidate] = (
      await ask({ request: "collect-dom-health-safe-navigation-candidates" })
    ).data;

    const response = await ask({
      request: "click-safe-navigation-candidate",
      domPath: candidate.domPath,
    });

    expect(response.data.clicked).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("clicks a discovered link only while it still verifies as a safe same-origin link", async () => {
    document.body.innerHTML =
      '<a href="/orders">Orders</a><a href="/logout">Sign out</a>';
    const [orders, logout] = Array.from(document.querySelectorAll("a"));
    const ordersClick = vi.spyOn(orders!, "click").mockImplementation(() => {});
    const logoutClick = vi.spyOn(logout!, "click").mockImplementation(() => {});
    const links = (await ask({ request: "collect-dom-health-links" })).data;

    const safe = await ask({
      request: "click-dom-health-link",
      domPath: links[0].domPath,
    });
    const unsafe = await ask({
      request: "click-dom-health-link",
      domPath: links[1].domPath,
    });

    expect(safe.data.clicked).toBe(true);
    expect(ordersClick).toHaveBeenCalledTimes(1);
    expect(unsafe.data.clicked).toBe(false);
    expect(logoutClick).not.toHaveBeenCalled();
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

describe("waitForDomToStabilize with shadow roots attached late (N-5)", () => {
  it("keeps waiting while a shadow root attached after the wait began keeps changing", async () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);

    const result = waitForDomToStabilize(100, 2000);
    await vi.advanceTimersByTimeAsync(50);
    const late = host.attachShadow({ mode: "open" });
    window.dispatchEvent(new CustomEvent(SHADOW_ATTACHED_EVENT));
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(60);
      late.append(document.createElement("p"));
    }
    await vi.advanceTimersByTimeAsync(200);

    const { settled, elapsedMs } = await result;
    expect(settled).toBe(true);
    expect(elapsedMs).toBeGreaterThanOrEqual(400);
  });

  it("observes a host that arrives with its root already attached", async () => {
    vi.useFakeTimers();
    const result = waitForDomToStabilize(100, 2000);
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    await vi.advanceTimersByTimeAsync(20);
    document.body.append(host);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(60);
      shadow.append(document.createElement("p"));
    }
    await vi.advanceTimersByTimeAsync(200);

    expect((await result).elapsedMs).toBeGreaterThanOrEqual(400);
  });
});

describe("waitForFrameToSettle for child frames", () => {
  it("returns at once for a loaded frame, however busy", async () => {
    vi.useFakeTimers();
    const busy = setInterval(() => {
      document.body.append(document.createElement("i"));
    }, 20);

    const result = await waitForFrameToSettle(400, 8000, true);

    clearInterval(busy);
    expect(result).toEqual({ settled: true, elapsedMs: 0 });
  });

  it("waits for a frame that is still loading", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");

    let done = false;
    const result = waitForFrameToSettle(100, 8000, true).then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false);

    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    window.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(200);

    expect(await result).toMatchObject({ settled: true });
    expect((await result).elapsedMs).toBeGreaterThanOrEqual(1000);
  });
});

describe("routing evidence and the route probe", () => {
  it("reports the page's history API totals announced by the MAIN-world hooks", async () => {
    const announce = (totals: object) =>
      window.dispatchEvent(
        new CustomEvent(HISTORY_API_EVENT, { detail: JSON.stringify(totals) }),
      );

    announce({ pushState: 3, replaceState: 1, popstate: 0, hashchange: 1 });
    announce({ pushState: 2, replaceState: 1, popstate: 0, hashchange: 1 });
    window.dispatchEvent(
      new CustomEvent(HISTORY_API_EVENT, { detail: "forged" }),
    );
    const model = (await ask({ request: "get-dom-health-navigation-model" }))
      .data;

    expect(model).toEqual({
      usesHistoryApiRouting: true,
      historyApiCallCount: 5,
      pushStateCount: 3,
    });
  });

  describe("route probe", () => {
    afterEach(async () => {
      await ask({ request: "dom-health-probe-disarm" });
      delete (globalThis as any).chrome.runtime.getFrameId;
    });

    it("reports each child frame's owner attributes against its frameId", async () => {
      document.title = "LN";
      document.body.innerHTML =
        '<iframe title="LN" name="LN_44_11111111-2222-4333-8444-555555555555" data-osp-id="LN"></iframe><iframe id="searchmenuiframe" class="shimiframe" style="display: none;"></iframe>';
      const [app, shim] = Array.from(document.querySelectorAll("iframe"));
      const runtime = (globalThis as any).chrome.runtime;
      // Like Chrome's binding: only callable on chrome.runtime itself.
      runtime.getFrameId = function (this: unknown, el: Element) {
        if (this !== runtime) throw new TypeError("Illegal invocation");
        return el === app ? 7 : el === shim ? 9 : -1;
      };

      const response = await ask({ request: "dom-health-probe-capture" });

      expect(response.success).toBe(true);
      expect(response.data.title).toBe("LN");
      expect(response.data.owners).toEqual([
        expect.objectContaining({ frameId: 7, ospId: "LN", title: "LN" }),
        expect.objectContaining({
          frameId: 9,
          id: "searchmenuiframe",
          rendered: false,
        }),
      ]);
      expect(response.data.armed).toBe(false);
    });

    it("keeps the first API call that starts after a click, path only", async () => {
      await ask({ request: "dom-health-probe-arm" });
      document.body.innerHTML = '<button id="go">Patients</button>';

      noteProbeClick(document.getElementById("go"), 100);
      recordFirstRequest([
        {
          name: "https://ehr.example.test/early.png",
          startTime: 50,
          initiatorType: "img",
        },
        {
          name: "https://ehr.example.test/font.woff2",
          startTime: 120,
          initiatorType: "css",
        },
        {
          name: "https://ehr.example.test/4242424/2/api/patients?q=123456",
          startTime: 140,
          initiatorType: "fetch",
        },
        {
          name: "https://ehr.example.test/later",
          startTime: 160,
          initiatorType: "xmlhttprequest",
        },
      ] as unknown as PerformanceEntryList);
      const response = await ask({ request: "dom-health-probe-capture" });

      expect(sendMessage).toHaveBeenCalledWith({
        request: "dom-health-probe-click",
        label: "Patients",
      });
      expect(response.data.firstRequest).toEqual({
        origin: "https://ehr.example.test",
        path: "/4242424/2/api/patients",
        initiatorType: "fetch",
        msAfterClick: 40,
      });
    });

    it("ignores clicks while it is not armed", () => {
      sendMessage.mockClear();
      noteProbeClick(document.body, 10);
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });
});

describe("cross-state replay", () => {
  function renderTwoRootsDeep() {
    document.body.innerHTML = '<x-shell id="shell"></x-shell>';
    const outer = document
      .getElementById("shell")!
      .attachShadow({ mode: "open" });
    outer.innerHTML = '<x-panel data-panel="orders"></x-panel>';
    outer.querySelector("x-panel")!.attachShadow({ mode: "open" }).innerHTML =
      '<button data-action="approve">Approve</button>';
  }

  it("replays a sample captured two shadow roots deep through its own hosts, not against the document (D-1)", async () => {
    renderTwoRootsDeep();
    const snapshot = await collectDomHealthSnapshot(document, {
      freshAudit: true,
    });
    const sample = snapshot.elementPathSamples.find(
      (s) => s.tagName === "button",
    )!;

    renderTwoRootsDeep();
    const response = await ask({
      request: "replay-dom-health-element-paths",
      samples: [sample],
    });

    expect(response).toEqual({
      success: true,
      data: [{ fingerprint: sample.fingerprint, verdict: "DIRECT_STABLE" }],
    });
  });
});
