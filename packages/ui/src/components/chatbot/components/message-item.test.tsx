import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as downloadLib from "../../../lib/download";
import type { UIMessage } from "../../../types";
import { DefaultMessageItem } from "./message-item";

function assistantMessage(text: string): UIMessage {
  return {
    id: "msg-1",
    role: "assistant",
    parts: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

describe("DefaultMessageItem — copy/download actions", () => {
  it("shows a checkmark after a successful copy, then reverts", async () => {
    vi.useFakeTimers();
    const onCopy = vi.fn().mockResolvedValue(true);

    render(
      <DefaultMessageItem
        message={assistantMessage("hello world")}
        isLast
        onCopy={onCopy}
      />,
    );

    const copyButton = screen.getByRole("button", { name: /^copy$/i });
    fireEvent.click(copyButton);

    await vi.waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^copied$/i }),
      ).toBeInTheDocument();
    });
    expect(onCopy).toHaveBeenCalledWith("hello world");

    vi.advanceTimersByTime(2000);
    await vi.waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^copy$/i }),
      ).toBeInTheDocument();
    });

    vi.useRealTimers();
  });

  it("does not show a checkmark when the copy fails", async () => {
    const onCopy = vi.fn().mockResolvedValue(false);

    render(
      <DefaultMessageItem
        message={assistantMessage("hello world")}
        isLast
        onCopy={onCopy}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    await waitFor(() => expect(onCopy).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: /^copied$/i }),
    ).not.toBeInTheDocument();
  });

  it("treats a plain void-returning onCopy (legacy consumers) as success", async () => {
    const onCopy = vi.fn();

    render(
      <DefaultMessageItem
        message={assistantMessage("hello world")}
        isLast
        onCopy={onCopy}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^copied$/i }),
      ).toBeInTheDocument();
    });
  });

  it("always renders a Download action, independent of onCopy, and triggers downloadText", () => {
    const downloadSpy = vi
      .spyOn(downloadLib, "downloadText")
      .mockReturnValue(true);

    render(
      <DefaultMessageItem message={assistantMessage("some content")} isLast />,
    );

    fireEvent.click(screen.getByRole("button", { name: /download/i }));

    expect(downloadSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^message-.*\.md$/),
      "some content",
      "text/markdown",
    );
  });
});
