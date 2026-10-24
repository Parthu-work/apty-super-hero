import { fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stickToBottom = vi.hoisted(() => ({
  isAtBottom: false,
  scrollToBottom: vi.fn(),
}));

vi.mock("use-stick-to-bottom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("use-stick-to-bottom")>()),
  useStickToBottomContext: () => stickToBottom,
}));

import { ConversationScrollButton } from "./conversation";

beforeEach(() => {
  stickToBottom.isAtBottom = false;
  stickToBottom.scrollToBottom.mockReset();
});

describe("ConversationScrollButton", () => {
  it("is named when the conversation is scrolled up, and scrolls down", async () => {
    const { container } = render(<ConversationScrollButton />);

    const button = screen.getByRole("button", {
      name: "Scroll to the latest message",
    });
    const { violations } = await axe.run(container, {
      resultTypes: ["violations"],
    });
    expect(violations.map((v) => v.id)).toEqual([]);
    fireEvent.click(button);
    expect(stickToBottom.scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("takes another name from its props", () => {
    render(<ConversationScrollButton aria-label="Jump to the end" />);
    expect(
      screen.getByRole("button", { name: "Jump to the end" }),
    ).toBeInTheDocument();
  });

  it("is not shown at the bottom", () => {
    stickToBottom.isAtBottom = true;
    render(<ConversationScrollButton />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
