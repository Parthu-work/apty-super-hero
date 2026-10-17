import type { AppSettings, RequestReport } from "@apty/agent-core";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataHandlingCard } from "./data-handling-card";
import { RecentRequests } from "./recent-requests";

const report = (
  at: number,
  extra: Partial<RequestReport> = {},
): RequestReport => ({
  at,
  redactionMode: "strict",
  systemPromptTokens: 3928,
  toolCount: 6,
  toolSchemaTokens: 1715,
  historyTokens: 40,
  toolResultTokens: 2013,
  totalTokens: 7696,
  items: 7,
  toolResults: 3,
  toolResultsStubbed: 1,
  toolResultsCut: 1,
  images: 0,
  ...extra,
});

describe("RecentRequests", () => {
  it("says nothing was sent yet", () => {
    render(<RecentRequests reports={[]} />);
    expect(screen.getByText(/No requests sent yet/)).toBeInTheDocument();
  });

  it("lists each request with its size and what was cut, newest first", () => {
    render(
      <RecentRequests
        reports={[
          report(2000, { images: 1 }),
          report(1000, { redactionMode: "off" }),
        ]}
      />,
    );
    const rows = within(
      screen.getByRole("list", { name: "Recent requests" }),
    ).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("about 7,696 tokens");
    expect(rows[0]).toHaveTextContent("system prompt 3,928");
    expect(rows[0]).toHaveTextContent("6 tools 1,715");
    expect(rows[0]).toHaveTextContent(
      "tool results 2,013 (3 results, 1 stubbed, 1 cut)",
    );
    expect(rows[0]).toHaveTextContent("1 screenshot");
    expect(rows[0]).toHaveTextContent("Strict");
    expect(rows[1]).toHaveTextContent("Off");
  });
});

describe("DataHandlingCard recent requests", () => {
  it("shows the requests the host passes in", () => {
    render(
      <DataHandlingCard
        settings={{} as AppSettings}
        onChange={vi.fn()}
        recentRequests={[report(1000)]}
      />,
    );
    expect(
      within(
        screen.getByRole("list", { name: "Recent requests" }),
      ).getAllByRole("listitem"),
    ).toHaveLength(1);
  });
});
