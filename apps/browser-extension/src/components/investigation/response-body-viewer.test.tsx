import { recordEvidence } from "@apty/browser-runtime/apty/evidence-store";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { evidenceIdOf, ResponseBodyViewer } from "./response-body-viewer";

function recordBody(body: string): string {
  return recordEvidence({
    conversationId: "conv-1",
    source: "service-worker",
    type: "network-response",
    timestamp: Date.now(),
    tabId: null,
    scope: "shared",
    data: { resourceName: "segments.json", body },
  } as Parameters<typeof recordEvidence>[0]).evidenceId;
}

describe("evidenceIdOf", () => {
  it("reads the evidence id from object or JSON-string tool output", () => {
    const output = { response: { evidenceId: "ev-1" } };

    expect(evidenceIdOf(output)).toBe("ev-1");
    expect(evidenceIdOf(JSON.stringify(output))).toBe("ev-1");
    expect(evidenceIdOf("not json")).toBeUndefined();
  });
});

describe("ResponseBodyViewer", () => {
  it("shows every item of a body the model only saw a preview of", () => {
    const segments = Array.from({ length: 206 }, (_, i) => ({
      id: i,
      name: `segment-${i}`,
    }));
    const evidenceId = recordBody(JSON.stringify(segments));

    render(<ResponseBodyViewer evidenceId={evidenceId} />);
    fireEvent.click(screen.getByRole("button", { name: "View full response" }));

    expect(screen.getByText("Array(206)")).toBeInTheDocument();
    expect(screen.getAllByText("{2 keys}")).toHaveLength(100);

    fireEvent.click(screen.getByRole("button", { name: /Show 100 more/ }));
    fireEvent.click(screen.getByRole("button", { name: /Show 6 more/ }));

    expect(screen.getAllByText("{2 keys}")).toHaveLength(206);
  });

  it("shows a non-JSON body as text", () => {
    const evidenceId = recordBody("<html>forbidden</html>");

    render(<ResponseBodyViewer evidenceId={evidenceId} />);
    fireEvent.click(screen.getByRole("button", { name: "View full response" }));

    expect(screen.getByText("<html>forbidden</html>")).toBeInTheDocument();
  });

  it("says so when the evidence is gone", () => {
    render(<ResponseBodyViewer evidenceId="missing" />);

    expect(screen.getByText(/no longer available/)).toBeInTheDocument();
  });
});
