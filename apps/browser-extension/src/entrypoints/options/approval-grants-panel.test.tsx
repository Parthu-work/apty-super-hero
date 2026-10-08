import { STORAGE_KEYS } from "@apty/agent-core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ApprovalGrantsPanel } from "./approval-grants-panel";

let storageStore: Record<string, unknown> = {};

beforeEach(() => {
  const future = Date.now() + 10 * 60_000;
  storageStore = {
    [STORAGE_KEYS.RISKY_ORIGIN_GRANTS]: [
      { toolName: "fill_form", origin: "https://a.test", expiresAt: future },
      {
        toolName: "run_console_command",
        origin: "https://b.test",
        expiresAt: future,
      },
      { toolName: "fill_form", origin: "https://old.test", expiresAt: 1 },
    ],
  };
  (global as any).chrome = {
    storage: {
      local: {
        get: (key: string) => Promise.resolve({ [key]: storageStore[key] }),
        set: (items: Record<string, unknown>) => {
          storageStore = { ...storageStore, ...items };
          return Promise.resolve();
        },
      },
    },
  };
});

describe("ApprovalGrantsPanel", () => {
  it("lists only unexpired approvals", async () => {
    render(<ApprovalGrantsPanel />);

    expect(await screen.findByText(/https:\/\/a\.test/)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/b\.test/)).toBeInTheDocument();
    expect(screen.queryByText(/old\.test/)).toBeNull();
  });

  it("revokes one approval", async () => {
    render(<ApprovalGrantsPanel />);
    await screen.findByText(/https:\/\/a\.test/);

    const [firstRevoke] = screen.getAllByRole("button", { name: "Revoke" });
    fireEvent.click(firstRevoke as HTMLElement);

    await waitFor(() =>
      expect(screen.queryByText(/https:\/\/a\.test/)).toBeNull(),
    );
    expect(screen.getByText(/https:\/\/b\.test/)).toBeInTheDocument();
  });

  it("revokes everything", async () => {
    render(<ApprovalGrantsPanel />);
    await screen.findByText(/https:\/\/a\.test/);

    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));

    expect(await screen.findByText("No active approvals.")).toBeInTheDocument();
    expect(storageStore[STORAGE_KEYS.RISKY_ORIGIN_GRANTS]).toEqual([]);
  });
});
