import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardPicker } from "./card-picker";

const CARDS = [
  { pageId: "101", title: "FIXTURE banner never glows", aptyVersion: "5.x" },
  { pageId: "202", title: "FIXTURE tooltip opens twice", aptyVersion: "5.x" },
  { pageId: "303", title: "FIXTURE tooltip flickers", aptyVersion: "4.x" },
];

function setup() {
  const onPick = vi.fn();
  render(
    <CardPicker label="Which card was right?" cards={CARDS} onPick={onPick} />,
  );
  const input = screen.getByRole("combobox", { name: "Which card was right?" });
  return { onPick, input };
}

describe("CardPicker (KB-RAG K27, E7)", () => {
  it("searches card titles as the SE types and picks one with the arrow keys and Enter", () => {
    const { onPick, input } = setup();
    fireEvent.change(input, { target: { value: "tooltip" } });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("FIXTURE tooltip flickers"),
      expect.stringContaining("FIXTURE tooltip opens twice"),
    ]);
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-activedescendant", options[0]?.id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", options[1]?.id);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenLastCalledWith("202");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toHaveValue("FIXTURE tooltip opens twice");
    expect(
      screen.getByText("Right card: FIXTURE tooltip opens twice (202)"),
    ).toBeInTheDocument();
  });

  it("wraps with ArrowUp, closes on Escape, and picks with a click", () => {
    const { onPick, input } = setup();
    fireEvent.change(input, { target: { value: "FIXTURE" } });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      screen.getAllByRole("option")[2]?.id,
    );
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.mouseDown(
      screen.getByRole("option", { name: /banner never glows/ }),
    );
    expect(onPick).toHaveBeenLastCalledWith("101");
  });

  it("takes a typed page id, says when no title matches, and forgets a pick once the text changes", () => {
    const { onPick, input } = setup();
    fireEvent.change(input, { target: { value: "202" } });
    expect(onPick).toHaveBeenLastCalledWith("202");
    fireEvent.change(input, { target: { value: "segment" } });
    expect(onPick).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No card title matches.",
    );
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("leaves Enter to the form when no list is open, so it saves", () => {
    const { input } = setup();
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true);
    fireEvent.change(input, { target: { value: "tooltip" } });
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
  });

  it("closes the list on blur only after a click has landed, so the form's buttons do not move under it", () => {
    vi.useFakeTimers();
    try {
      const { input } = setup();
      fireEvent.change(input, { target: { value: "tooltip" } });
      fireEvent.blur(input);
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.queryByRole("listbox")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
