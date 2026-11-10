import {
  capture,
  evidenceFrom,
} from "@apty/browser-runtime/apty/diagnosis/diagnosis-test-utils";
import type { ClientEvidence } from "@apty/browser-runtime/apty/diagnosis/types";
import { diagnoseWidgetNotVisible } from "@apty/browser-runtime/apty/diagnosis/widget-not-visible";
import type { UIToolPart } from "@apty/ui/types";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captureAndReload = vi.hoisted(() => vi.fn());
const recheckFromCapture = vi.hoisted(() => vi.fn());
vi.mock("@apty/browser-runtime/apty/diagnosis/capture-check", () => ({
  captureAndReload,
  recheckFromCapture,
}));

import { CheckResultCard } from "./check-result-card";

const unreachable: ClientEvidence = {
  connection: {
    ok: false,
    failure: "no_receiver",
    message: "Nothing listening.",
  },
  observedNames: [],
  files: {},
};
const tool = (output: unknown): UIToolPart => ({
  type: "tool",
  toolName: "run_diagnosis",
  toolCallId: "c1",
  input: {},
  output,
  state: "completed",
});
const PAGE = "https://uat.crm.example.com/leads/42";

beforeEach(() => {
  captureAndReload.mockReset();
  recheckFromCapture.mockReset();
  (chrome as unknown as { tabs: unknown }).tabs = {
    query: vi.fn(async () => [{ id: 3, url: PAGE }]),
  };
});

describe("getting a 4.x tenant's files from the verdict card (K15)", () => {
  it("captures the tab's network, reloads it and shows the check run on what it captured", async () => {
    captureAndReload.mockResolvedValue({ ok: true, calls: 7 });
    recheckFromCapture.mockResolvedValue(
      diagnoseWidgetNotVisible(evidenceFrom(capture("content-4x")), PAGE),
    );
    render(
      <CheckResultCard
        tool={tool(diagnoseWidgetNotVisible(unreachable, PAGE))}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Capture and reload" }));
    expect(
      await screen.findByText("Captured 7 Apty calls. The check ran on them:"),
    ).toBeInTheDocument();
    expect(captureAndReload).toHaveBeenCalledWith(3);
    expect(recheckFromCapture).toHaveBeenCalledWith(
      expect.objectContaining({ packId: "widget-not-visible" }),
      3,
      PAGE,
    );
    expect(
      screen.getAllByRole("region", {
        name: "Why the widget may not be visible",
      }),
    ).toHaveLength(2);
  });

  it("says when the capture saw no Apty call", async () => {
    captureAndReload.mockResolvedValue({ ok: true, calls: 0 });
    render(
      <CheckResultCard
        tool={tool(diagnoseWidgetNotVisible(unreachable, PAGE))}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Capture and reload" }));
    expect(
      await screen.findByText(
        "The page made no Apty content call. In Extension mode the 4.x Client makes them: save a HAR from its service worker.",
      ),
    ).toBeInTheDocument();
    expect(recheckFromCapture).not.toHaveBeenCalled();
  });

  it("lists the six steps to save a HAR from the 4.x Client's service worker, with a copy button", () => {
    render(
      <CheckResultCard
        tool={tool(diagnoseWidgetNotVisible(unreachable, PAGE))}
      />,
    );
    const steps = screen.getByRole("list", {
      name: "Save a HAR from the 4.x Client's service worker",
    });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(6);
    expect(
      within(steps).getByRole("button", { name: "Copy chrome://extensions" }),
    ).toBeInTheDocument();
  });

  it("offers neither when the check read files", () => {
    render(
      <CheckResultCard
        tool={tool(diagnoseWidgetNotVisible(evidenceFrom(capture()), PAGE))}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Capture and reload" }),
    ).toBeNull();
  });
});
