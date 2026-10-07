import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionsPanel } from "./permissions-panel";

const mockContains = vi.fn();
const mockRequest = vi.fn();
const mockRemove = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockContains.mockResolvedValue(false);
  (global as any).chrome = {
    permissions: {
      contains: mockContains,
      request: mockRequest,
      remove: mockRemove,
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PermissionsPanel", () => {
  it("renders a toggle for each optional permission, all off by default", async () => {
    render(<PermissionsPanel />);

    expect(await screen.findByText("Bookmarks")).toBeInTheDocument();
    expect(screen.getByText("Browsing history")).toBeInTheDocument();
    expect(screen.getByText("Manage extensions")).toBeInTheDocument();

    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(3);
    for (const el of switches) {
      expect(el).toHaveAttribute("aria-checked", "false");
    }
  });

  it("reflects an already-granted permission as on", async () => {
    mockContains.mockImplementation(
      async ({ permissions }: { permissions: string[] }) =>
        permissions[0] === "bookmarks",
    );

    render(<PermissionsPanel />);

    await waitFor(() => {
      const switches = screen.getAllByRole("switch");
      expect(switches[0]).toHaveAttribute("aria-checked", "true");
    });
  });

  it("requests the permission when turned on, from the toggle's own click", async () => {
    mockRequest.mockResolvedValue(true);

    render(<PermissionsPanel />);
    await screen.findByText("Bookmarks");

    const [bookmarksSwitch] = screen.getAllByRole("switch");
    fireEvent.click(bookmarksSwitch!);

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledWith({
        permissions: ["bookmarks"],
      });
    });
    expect(bookmarksSwitch).toHaveAttribute("aria-checked", "true");
  });

  it("reflects a declined permission request as still off", async () => {
    mockRequest.mockResolvedValue(false);

    render(<PermissionsPanel />);
    await screen.findByText("Bookmarks");

    const [bookmarksSwitch] = screen.getAllByRole("switch");
    fireEvent.click(bookmarksSwitch!);

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalled();
    });
    expect(bookmarksSwitch).toHaveAttribute("aria-checked", "false");
  });

  it("removes the permission when turned off", async () => {
    mockContains.mockResolvedValue(true);
    mockRemove.mockResolvedValue(true);

    render(<PermissionsPanel />);
    await waitFor(() => {
      expect(screen.getAllByRole("switch")[0]).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });

    const [bookmarksSwitch] = screen.getAllByRole("switch");
    fireEvent.click(bookmarksSwitch!);

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith({ permissions: ["bookmarks"] });
    });
    expect(bookmarksSwitch).toHaveAttribute("aria-checked", "false");
  });
});
