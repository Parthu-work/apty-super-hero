import type {
  CorrelationCluster,
  DiagnosticEvidence,
} from "@apty/browser-runtime";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvidenceTimeline } from "./evidence-timeline";

function evidence(
  overrides: Partial<DiagnosticEvidence> = {},
): DiagnosticEvidence {
  return {
    evidenceId: "ev-1",
    source: "network",
    type: "network-http-error",
    timestamp: 1_700_000_000_000,
    scope: "tab",
    url: "https://app.example.com/api/orders",
    data: { status: 500 },
    ...overrides,
  };
}

function cluster(
  overrides: Partial<CorrelationCluster> = {},
): CorrelationCluster {
  const items = overrides.evidence ?? [evidence()];
  return {
    clusterId: "c-1",
    startTimestamp: items[0]!.timestamp,
    endTimestamp: items.at(-1)!.timestamp,
    evidence: items,
    likelySameIncident: false,
    summary: "Network request failed (500)",
    ...overrides,
  };
}

describe("EvidenceTimeline", () => {
  it("marks a likely related incident only where the correlation says so", () => {
    render(
      <EvidenceTimeline
        clusters={[
          cluster({
            clusterId: "related",
            summary: "Network request failed (500) with a console error",
            likelySameIncident: true,
            evidence: [
              evidence(),
              evidence({
                evidenceId: "ev-2",
                source: "console",
                type: "console-error",
              }),
            ],
          }),
          cluster({ clusterId: "alone", summary: "Widget status checked" }),
        ]}
      />,
    );

    const [related, alone] = screen.getAllByRole("listitem");
    expect(
      within(related!).getByText("Likely related incident"),
    ).toBeInTheDocument();
    expect(
      within(alone!).queryByText("Likely related incident"),
    ).not.toBeInTheDocument();
  });

  it("keeps a cluster's evidence behind one View details, failures marked by word", () => {
    render(
      <EvidenceTimeline
        clusters={[
          cluster({
            evidence: [
              evidence(),
              evidence({
                evidenceId: "ev-2",
                source: "apty-widget",
                type: "widget-status",
                url: undefined,
                data: { initialized: true },
              }),
            ],
          }),
        ]}
      />,
    );

    const details = screen.getAllByRole("button", { name: /View details/ });
    expect(details).toHaveLength(1);
    expect(screen.queryByText("network-http-error")).not.toBeInTheDocument();

    fireEvent.click(details[0]!);

    expect(screen.getByText("network-http-error")).toBeInTheDocument();
    expect(screen.getByText("widget-status")).toBeInTheDocument();
    expect(screen.getAllByText("Failure")).toHaveLength(1);
    expect(screen.getByText("Apty Widget")).toBeInTheDocument();
  });

  it("says so when nothing was collected", () => {
    render(<EvidenceTimeline clusters={[]} />);

    expect(screen.getByText(/No evidence collected yet/)).toBeInTheDocument();
  });
});
