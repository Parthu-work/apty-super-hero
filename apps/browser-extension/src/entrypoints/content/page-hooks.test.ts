import { describe, expect, it, vi } from "vitest";
import {
  HISTORY_API_EVENT,
  HISTORY_SYNC_REQUEST_EVENT,
  parseHistoryTotals,
  SHADOW_ATTACHED_EVENT,
} from "./page-events";
import { installPageHooks } from "./page-hooks";

/** A window stand-in with its own History prototype, so each test wraps a fresh one. */
function fakeWindow(pushState: (...args: unknown[]) => void = () => {}) {
  class FakeHistory {
    pushState(...args: unknown[]) {
      pushState(...args);
    }
    replaceState() {}
  }
  const events = new EventTarget();
  const announced: unknown[] = [];
  events.addEventListener(HISTORY_API_EVENT, (event) =>
    announced.push(parseHistoryTotals((event as CustomEvent).detail)),
  );
  const win = {
    History: FakeHistory,
    history: new FakeHistory(),
    addEventListener: events.addEventListener.bind(events),
    dispatchEvent: (event: Event) => events.dispatchEvent(event),
  } as unknown as Window & { History: typeof History };
  return { win, announced };
}

describe("installPageHooks", () => {
  it("announces running totals after each of the page's own history calls", () => {
    const calls: unknown[][] = [];
    const { win, announced } = fakeWindow((...args) => calls.push(args));

    expect(installPageHooks(win)).toBe(true);
    win.history.pushState({ a: 1 }, "", "/orders");
    win.history.replaceState({}, "", "/orders/1");

    expect(calls).toEqual([[{ a: 1 }, "", "/orders"]]);
    expect(announced).toEqual([
      { pushState: 1, replaceState: 0, popstate: 0, hashchange: 0 },
      { pushState: 1, replaceState: 1, popstate: 0, hashchange: 0 },
    ]);
  });

  it("answers a late listener's sync request with everything counted so far", () => {
    const { win, announced } = fakeWindow();
    installPageHooks(win);
    win.history.pushState({}, "", "/early");
    win.dispatchEvent(new Event("popstate"));
    announced.length = 0;

    win.dispatchEvent(new CustomEvent(HISTORY_SYNC_REQUEST_EVENT));

    expect(announced).toEqual([
      { pushState: 1, replaceState: 0, popstate: 1, hashchange: 0 },
    ]);
  });

  it("wraps the prototype, so a call made through History.prototype is seen too", () => {
    const { win, announced } = fakeWindow();
    installPageHooks(win);

    win.History.prototype.pushState.call(win.history, {}, "", "/direct");

    expect(announced).toHaveLength(1);
  });

  it("installs once per window", () => {
    const { win, announced } = fakeWindow();

    installPageHooks(win);
    expect(installPageHooks(win)).toBe(false);
    win.history.pushState({}, "", "/once");

    expect(announced).toHaveLength(1);
  });

  it("rethrows what the page's call throws and counts nothing", () => {
    const failure = new DOMException("blocked", "SecurityError");
    const { win, announced } = fakeWindow(() => {
      throw failure;
    });
    installPageHooks(win);

    expect(() => win.history.pushState({}, "", "/x")).toThrow(failure);
    expect(announced).toEqual([]);
  });

  it("never throws into the page when announcing fails", () => {
    const { win } = fakeWindow();
    installPageHooks(win);
    (win as any).dispatchEvent = vi.fn(() => {
      throw new Error("broken");
    });

    expect(() => win.history.pushState({}, "", "/y")).not.toThrow();
  });
});

describe("parseHistoryTotals", () => {
  it("rejects anything that is not a complete, non-negative totals message", () => {
    expect(parseHistoryTotals("pushState")).toBeNull();
    expect(parseHistoryTotals({ pushState: 1 })).toBeNull();
    expect(
      parseHistoryTotals(
        JSON.stringify({
          pushState: -1,
          replaceState: 0,
          popstate: 0,
          hashchange: 0,
        }),
      ),
    ).toBeNull();
    expect(
      parseHistoryTotals(
        JSON.stringify({
          pushState: 2,
          replaceState: 0,
          popstate: 0,
          hashchange: 1,
        }),
      ),
    ).toEqual({ pushState: 2, replaceState: 0, popstate: 0, hashchange: 1 });
  });
});

describe("attachShadow hook (re-audit N-5)", () => {
  function windowWithElement(attach: (init: ShadowRootInit) => unknown) {
    class FakeElement {
      attachShadow(init: ShadowRootInit) {
        return attach(init);
      }
    }
    const events = new EventTarget();
    let announcements = 0;
    events.addEventListener(SHADOW_ATTACHED_EVENT, () => announcements++);
    const win = {
      Element: FakeElement,
      addEventListener: events.addEventListener.bind(events),
      dispatchEvent: (event: Event) => events.dispatchEvent(event),
    } as unknown as Window;
    return { win, FakeElement, announcements: () => announcements };
  }

  it("announces each attached root and hands the page its own root back", () => {
    const root = { kind: "root" };
    const { win, FakeElement, announcements } = windowWithElement(() => root);
    installPageHooks(win);

    expect(new FakeElement().attachShadow({ mode: "closed" })).toBe(root);
    expect(announcements()).toBe(1);
  });

  it("lets the page's own error through without announcing anything", () => {
    const { win, FakeElement, announcements } = windowWithElement(() => {
      throw new DOMException("not supported", "NotSupportedError");
    });
    installPageHooks(win);

    expect(() => new FakeElement().attachShadow({ mode: "open" })).toThrow(
      "not supported",
    );
    expect(announcements()).toBe(0);
  });
});
