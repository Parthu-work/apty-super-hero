import type { UIMessage } from "@apty/ui/types";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.hoisted(() => vi.fn());
vi.mock("@apty/ui/components/chatbot", () => ({
  useChatContext: () => ({ sendMessage }),
}));

import { BrowserMessageActions } from "./browser-message-actions";

const message: UIMessage = {
  id: "a1",
  role: "assistant",
  parts: [{ type: "text", text: "The button is enabled." }],
};

describe("BrowserMessageActions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers Copy, Save as skill and Retry on the last answer", () => {
    render(
      <BrowserMessageActions
        message={message}
        isLast
        onRegenerate={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Copy",
      "Save as skill",
      "Retry",
    ]);
    fireEvent.click(screen.getByRole("button", { name: /save as skill/i }));
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("offers only Copy on an earlier answer", () => {
    render(<BrowserMessageActions message={message} onCopy={vi.fn()} />);

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Copy",
    ]);
  });

  it("names Copy 'Copied' for 1.5 s after a copy that worked", async () => {
    vi.useFakeTimers();
    const onCopy = vi.fn().mockResolvedValue(true);
    render(<BrowserMessageActions message={message} isLast onCopy={onCopy} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(onCopy).toHaveBeenCalledWith("The button is enabled.");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });
});
