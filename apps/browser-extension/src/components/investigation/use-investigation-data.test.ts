import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const RAW = {
  evidenceId: "ev-1",
  conversationId: "conv",
  source: "service-worker",
  type: "network-response",
  timestamp: 1,
  scope: "shared",
  requestId: "ok",
  url: "/api/ok/users/4815162342.json?dob=1980-01-01",
  data: { resourceName: "4815162342.json", status: 200 },
};

vi.mock("@apty/browser-runtime", () => ({
  correlateEvidence: (evidence: unknown[]) => [
    { evidence, likelySameIncident: false },
  ],
  getEvidence: () => [RAW],
  getInvestigation: () => undefined,
}));

import { useInvestigationData } from "./use-investigation-data";

describe("useInvestigationData", () => {
  it("shows a stored relative URL and its name under the current mode (Strict before settings load), never raw", () => {
    const { result } = renderHook(() => useInvestigationData("conv", false));

    expect(result.current.evidence[0]).toMatchObject({
      url: "/api/ok/users/:id.json",
      data: { resourceName: ":id.json" },
    });
    const shown = JSON.stringify(result.current);
    expect(shown).not.toContain("4815162342");
    expect(shown).not.toContain("1980-01-01");
    expect(RAW.url).toContain("4815162342");
  });
});
