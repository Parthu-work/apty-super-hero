import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../services/preflight-browser", () => ({
  browserPreflightDeps: {},
}));
vi.mock("../../services/stored-data", () => ({ purgeStoredData: vi.fn() }));
vi.mock("@apty/browser-runtime/runtime/redaction-mode", () => ({
  redactTextStrict: (text: string) => text,
}));

const runPreflight = vi.hoisted(() => vi.fn());
vi.mock("../../services/preflight", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runPreflight,
}));

import { PreflightPanel } from "./preflight-panel";

describe("PreflightPanel", () => {
  it("shows the recent requests it is given, sizes only", () => {
    render(
      <PreflightPanel
        deps={{} as never}
        requestReports={[
          {
            at: 1,
            redactionMode: "standard",
            systemPromptTokens: 3928,
            toolCount: 0,
            toolSchemaTokens: 0,
            historyTokens: 1,
            toolResultTokens: 0,
            totalTokens: 3929,
            items: 1,
            toolResults: 0,
            toolResultsStubbed: 0,
            toolResultsCut: 0,
            images: 0,
          },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Recent requests" });
    expect(within(list).getByRole("listitem")).toHaveTextContent(
      "about 3,929 tokens",
    );
  });

  it("runs the checks on click and shows each fix with a copy button", async () => {
    runPreflight.mockResolvedValue([
      { id: "ai-provider", label: "AI provider", status: "pass", detail: "ok" },
      {
        id: "apty-client",
        label: "Apty Client",
        status: "fail",
        detail: "not answering",
        fix: "Add the ID",
      },
    ]);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<PreflightPanel deps={{} as never} />);
    expect(runPreflight).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Run all checks" }));

    expect(await screen.findByText("1 failing, 0 with warnings.")).toBeTruthy();
    const results = screen.getByRole("list", { name: "Preflight results" });
    expect(within(results).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy the fix for Apty Client" }),
    );
    expect(writeText).toHaveBeenCalledWith("Add the ID");
  });

  it("resets demo data only after confirmation", async () => {
    const purge = vi.fn(async () => {});
    render(<PreflightPanel deps={{} as never} purge={purge} />);

    fireEvent.click(screen.getByRole("button", { name: "Reset demo data" }));
    expect(purge).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete conversations and screenshots",
      }),
    );

    expect(
      await screen.findByText(
        "Demo data reset: stored conversations and screenshots deleted.",
      ),
    ).toBeTruthy();
    expect(purge).toHaveBeenCalledTimes(1);
  });
});
