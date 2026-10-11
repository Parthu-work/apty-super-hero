import type { RouteProbeReport } from "@apty/browser-runtime";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockBuildValidationBundle = vi.hoisted(() => vi.fn());
const mockResolveThresholds = vi.hoisted(() => vi.fn());

vi.mock("@apty/browser-runtime", () => ({
  buildValidationBundle: mockBuildValidationBundle,
  chromeVersionFrom: (ua: string) => /Chrome\/([\d.]+)/.exec(ua)?.[1] ?? null,
  resolveThresholds: mockResolveThresholds,
}));

import { ValidationBundleExport } from "./validation-bundle-export";

const probe = { startedAt: 1, steps: [] } as unknown as RouteProbeReport;
const BUNDLE = { schema: "apty-dom-health-validation/1", hosts: ["a.test"] };
const BUNDLE_JSON = JSON.stringify(BUNDLE, null, 2);

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildValidationBundle.mockReturnValue(BUNDLE);
  mockResolveThresholds.mockImplementation((overrides) => ({ overrides }));
  vi.stubGlobal("chrome", {
    runtime: { getManifest: () => ({ version: "9.8.7" }) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function exportButton() {
  return screen.getByRole("button", { name: "Export validation bundle" });
}

describe("ValidationBundleExport", () => {
  it("is disabled until there is a result or a probe report to export", () => {
    render(<ValidationBundleExport page={{ available: false, error: "x" }} />);
    expect(exportButton()).toBeDisabled();
  });

  it("builds from the available evidence only, with the overrides and versions, and shows it for review", () => {
    render(
      <ValidationBundleExport
        page={{ available: false, error: "x" }}
        application={{ available: true } as never}
        probe={probe}
        thresholdOverrides={{ sameUrlRatioForClickFirst: 0.4 }}
      />,
    );
    fireEvent.click(exportButton());

    expect(mockResolveThresholds).toHaveBeenCalledWith({
      sameUrlRatioForClickFirst: 0.4,
    });
    expect(mockBuildValidationBundle).toHaveBeenCalledWith({
      page: null,
      application: { available: true },
      probe,
      thresholds: { overrides: { sameUrlRatioForClickFirst: 0.4 } },
      versions: {
        extension: "9.8.7",
        chrome: expect.toSatisfy(
          (v: unknown) => v === null || typeof v === "string",
        ),
      },
    });
    expect(screen.getByText("Review before sharing")).toBeInTheDocument();
    expect(screen.getByLabelText("Validation bundle")).toHaveTextContent(
      "apty-dom-health-validation/1",
    );
  });

  it("downloads the reviewed JSON and closes, or closes on Cancel without saving", async () => {
    let saved: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      saved = blob as Blob;
      return "blob:bundle";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<ValidationBundleExport probe={probe} />);
    fireEvent.click(exportButton());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByText("Review before sharing")).toBeNull(),
    );
    expect(click).not.toHaveBeenCalled();

    fireEvent.click(exportButton());
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(saved?.type).toBe("application/json");
    expect(await saved?.text()).toBe(BUNDLE_JSON);
  });

  it("copies the reviewed JSON", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<ValidationBundleExport probe={probe} />);
    fireEvent.click(exportButton());
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(BUNDLE_JSON);
  });
});
