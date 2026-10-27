import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const copyText = vi.hoisted(() => vi.fn());
vi.mock("../../lib/clipboard", () => ({ copyText }));

import { CopyButton } from "./copy-button";

describe("CopyButton", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies its text, reads Copied for 1.5 s, then its own name again", async () => {
    copyText.mockResolvedValue(true);
    render(<CopyButton text="{ a: 1 }" label="Copy result" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy result" }));
    });
    expect(copyText).toHaveBeenCalledWith("{ a: 1 }");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1499));
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(
      screen.getByRole("button", { name: "Copy result" }),
    ).toBeInTheDocument();
  });

  it("does not claim a copy the clipboard refused", async () => {
    copyText.mockResolvedValue(false);
    render(<CopyButton text="x" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });
});
