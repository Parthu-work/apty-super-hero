import { newCase } from "@apty/agent-core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@apty/browser-runtime/apty/extension-network-inspector", () => ({
  loadBodyDenyList: async () => [],
}));

import { SupportBundleButton } from "./support-bundle-button";

const NOW = new Date("2026-11-12T10:00:00.000Z");

describe("SupportBundleButton (KB-RAG K25, L2)", () => {
  it("opens the review dialog with the JSON, the missing fields, Copy, Download and Copy as text, and makes no request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const record = {
      ...newCase("conv", NOW, {
        tabHost: "crm.acme-corp.com",
        random: () => 0,
      }),
      aptyVersion: "4.x" as const,
    };
    render(<SupportBundleButton record={record} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare support bundle" }),
    );
    const missing = await screen.findByTestId("support-missing");
    expect(missing).toHaveTextContent(/Add before sending: mode, environment/);
    expect(
      screen.getByText(/"schema": "apty-support-bundle"/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/"pageOrigin": "https:\/\/customer-app"/),
    ).toBeInTheDocument();
    for (const name of ["Copy", "Copy as text", "Download"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("says when the conversation has no case yet", async () => {
    render(<SupportBundleButton loadRecord={async () => undefined} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare support bundle" }),
    );
    expect(
      await screen.findByText("There is no case for this conversation yet."),
    ).toBeInTheDocument();
  });

  it("adds the DOM Config settings file only when the SE ticks it (K26 C4)", async () => {
    const record = {
      ...newCase("conv", NOW, { random: () => 0 }),
      domConfig: {
        runId: "dc-1",
        at: NOW.toISOString(),
        pages: 3,
        rules: 5,
        warnings: 1,
        exportSha256: "c".repeat(64),
        settingsFile: '{"FIXTURE_setting":true}',
      },
    };
    render(<SupportBundleButton record={record} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare support bundle" }),
    );
    const box = await screen.findByTestId("support-include-dom-settings");
    expect(screen.getByText(/"runId": "dc-1"/)).toBeInTheDocument();
    expect(screen.queryByText(/FIXTURE_setting/)).toBeNull();
    fireEvent.click(box);
    expect(await screen.findByText(/FIXTURE_setting/)).toBeInTheDocument();
  });
});
