import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revealSection } from "./reveal-section";

beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("revealSection", () => {
  it("waits for a section that renders after settings load", async () => {
    revealSection("apty-client");

    const section = document.createElement("div");
    section.id = "apty-client";
    document.body.append(section);
    await vi.advanceTimersByTimeAsync(0);

    expect(section.scrollIntoView).toHaveBeenCalled();
    expect(section.classList.contains("ring-2")).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(section.classList.contains("ring-2")).toBe(false);
  });

  it("gives up quietly when the section never appears", async () => {
    revealSection("missing");
    await vi.advanceTimersByTimeAsync(6000);

    const late = document.createElement("div");
    late.id = "missing";
    document.body.append(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(late.scrollIntoView).not.toHaveBeenCalled();
  });
});
