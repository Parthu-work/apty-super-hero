import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClearConversations = vi.hoisted(() => vi.fn());
const mockClearScreenshots = vi.hoisted(() => vi.fn());

vi.mock("@apty/browser-runtime/conversation/conversation-storage", () => ({
  conversationStorage: { clearAllConversations: mockClearConversations },
}));
vi.mock("@apty/browser-runtime/storage/screenshot-storage", () => ({
  RuntimeScreenshotStorage: { clearAll: mockClearScreenshots },
}));

import { StoredDataPanel } from "./stored-data-panel";

beforeEach(() => {
  vi.clearAllMocks();
  mockClearConversations.mockResolvedValue(undefined);
  mockClearScreenshots.mockResolvedValue(undefined);
});

describe("StoredDataPanel", () => {
  it("states the retention period", () => {
    render(<StoredDataPanel />);

    expect(screen.getByText(/after 7 days without use/)).toBeInTheDocument();
  });

  it("deletes conversations and screenshots only after confirmation", async () => {
    render(<StoredDataPanel />);

    fireEvent.click(
      screen.getByRole("button", { name: "Delete stored data now" }),
    );
    expect(mockClearConversations).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete everything" }));

    expect(await screen.findByText(/were deleted/)).toBeInTheDocument();
    expect(mockClearConversations).toHaveBeenCalledTimes(1);
    expect(mockClearScreenshots).toHaveBeenCalledTimes(1);
  });

  it("reports a failed purge", async () => {
    mockClearScreenshots.mockRejectedValue(new Error("blocked"));
    render(<StoredDataPanel />);

    fireEvent.click(
      screen.getByRole("button", { name: "Delete stored data now" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete everything" }));

    expect(await screen.findByText(/failed/)).toBeInTheDocument();
  });
});
