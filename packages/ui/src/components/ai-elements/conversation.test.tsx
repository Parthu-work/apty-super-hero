import { act, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "./conversation";

const observers: Array<() => void> = [];

class FakeResizeObserver {
  constructor(private callback: () => void) {
    observers.push(() => this.callback());
  }
  observe() {}
  disconnect() {}
}

/** A scroller with the given heights, whose scrollTop clamps like a browser's. */
function sizeScroller(
  scroller: HTMLElement,
  size: { scrollHeight: number; clientHeight: number },
) {
  let top = 0;
  Object.defineProperty(scroller, "clientHeight", {
    configurable: true,
    get: () => size.clientHeight,
  });
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    get: () => size.scrollHeight,
  });
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(value, size.scrollHeight - size.clientHeight));
    },
  });
  scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
}

/** An element whose top on screen moves with the scroller and `offset()`. */
function placeAt(el: Element, scroller: HTMLElement, offset: () => number) {
  el.getBoundingClientRect = () =>
    ({ top: offset() - scroller.scrollTop }) as DOMRect;
}

function resize() {
  act(() => {
    for (const notify of observers) notify();
  });
}

function setup(buttonProps: { "aria-label"?: string } = {}) {
  const size = { scrollHeight: 2000, clientHeight: 500 };
  render(
    <Conversation>
      <ConversationContent>
        <div data-scroll-anchor>
          <button type="button">Layer 4</button>
        </div>
        <div data-scroll-anchor>last</div>
      </ConversationContent>
      <ConversationScrollButton {...buttonProps} />
    </Conversation>,
  );
  const log = screen.getByRole("log");
  const scroller = log.firstElementChild as HTMLElement;
  sizeScroller(scroller, size);
  resize();
  return { size, scroller };
}

function scrollTo(scroller: HTMLElement, top: number) {
  act(() => {
    scroller.scrollTop = top;
    fireEvent.scroll(scroller);
  });
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "elementFromPoint");
});

describe("the chat's scroll engine (KB-RAG K29, L3)", () => {
  it("follows a new message when the SE was within 48 px of the bottom", () => {
    const { size, scroller } = setup();
    scrollTo(scroller, 1460);
    size.scrollHeight = 2600;
    resize();
    expect(scroller.scrollTop).toBe(2100);
  });

  it("follows a message that grows the content in the frame of a scroll event", () => {
    const { size, scroller } = setup();
    scrollTo(scroller, 1500);
    size.scrollHeight = 2200;
    scrollTo(scroller, 1480);
    resize();
    expect(scroller.scrollTop).toBe(1700);
  });

  it("does not move the view for a new message while the SE reads higher up", () => {
    const { size, scroller } = setup();
    scrollTo(scroller, 600);
    size.scrollHeight = 2600;
    resize();
    expect(scroller.scrollTop).toBe(600);
  });

  it("keeps what the SE clicked where it was, even at the bottom, instead of following", () => {
    const { size, scroller } = setup();
    scrollTo(scroller, 1500);
    const button = screen.getByRole("button", { name: "Layer 4" });
    let offset = 1700;
    placeAt(button, scroller, () => offset);
    fireEvent.click(button);
    offset = 1820;
    size.scrollHeight = 2400;
    resize();
    expect(scroller.scrollTop).toBe(1620);
    expect(button.getBoundingClientRect().top).toBe(200);
  });

  it("keeps the turn at the top of the view where it was when a card above it changes height", async () => {
    const { size, scroller } = setup();
    const last = screen.getByText("last");
    let offset = 1000;
    placeAt(last, scroller, () => offset);
    document.elementFromPoint = () => last;
    scrollTo(scroller, 900);
    await act(() => new Promise((r) => requestAnimationFrame(r)));
    offset = 1300;
    size.scrollHeight = 2300;
    resize();
    expect(scroller.scrollTop).toBe(1200);
  });
});

describe("ConversationScrollButton", () => {
  it("is named when the conversation is scrolled up, and scrolls down", async () => {
    const { scroller } = setup();
    scrollTo(scroller, 200);
    const button = screen.getByRole("button", {
      name: "Scroll to the latest message",
    });
    const { violations } = await axe.run(document.body, {
      resultTypes: ["violations"],
    });
    expect(violations.map((v) => v.id)).toEqual([]);
    fireEvent.click(button);
    expect(scroller.scrollTop).toBe(1500);
    expect(
      screen.queryByRole("button", { name: "Scroll to the latest message" }),
    ).toBeNull();
  });

  it("takes another name from its props", () => {
    const { scroller } = setup({ "aria-label": "Jump to the end" });
    scrollTo(scroller, 200);
    expect(
      screen.getByRole("button", { name: "Jump to the end" }),
    ).toBeInTheDocument();
  });

  it("is not shown at the bottom", () => {
    const { scroller } = setup();
    scrollTo(scroller, 1500);
    expect(
      screen.queryByRole("button", { name: "Scroll to the latest message" }),
    ).toBeNull();
  });
});
