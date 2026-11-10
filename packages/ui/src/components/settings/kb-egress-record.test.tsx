import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KbEgressRecord } from "./kb-egress-record";

const download = vi.hoisted(() => vi.fn());
vi.mock("../../lib/download", () => ({ downloadText: download }));

function adapter(clearAllowed: boolean) {
  return {
    countLast30Days: vi.fn(async () => 2),
    exportJson: vi.fn(async () => '{"records":[]}'),
    clearAllowed: vi.fn(async () => clearAllowed),
    clear: vi.fn(async () => {}),
  };
}

describe("KbEgressRecord (KB-RAG K22, S7)", () => {
  it("shows the count, exports JSON and clears with no policy", async () => {
    const log = adapter(true);
    render(<KbEgressRecord log={log} />);
    expect(
      await screen.findByText(
        "Requests that carried KB card text in the last 30 days: 2.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export (JSON)" }));
    await vi.waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        expect.stringMatching(/^apty-kb-sent-.*\.json$/),
        '{"records":[]}',
        "application/json",
      ),
    );
    const clear = screen.getByRole("button", { name: "Clear" });
    await vi.waitFor(() => expect(clear).toBeEnabled());
    fireEvent.click(clear);
    await vi.waitFor(() => expect(log.clear).toHaveBeenCalledOnce());
  });

  it("disables Clear under an organization policy, and says why", async () => {
    render(<KbEgressRecord log={adapter(false)} />);
    const clear = await screen.findByRole("button", { name: "Clear" });
    await screen.findByText(
      "Your organization keeps this record, so it cannot be cleared here.",
    );
    expect(clear).toBeDisabled();
    expect(clear).toHaveAccessibleDescription(/organization keeps this record/);
  });
});
