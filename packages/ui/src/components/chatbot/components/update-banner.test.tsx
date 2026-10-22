/**
 * UpdateBanner is not mounted anywhere in the extension, so the real-browser
 * a11y e2e cannot reach it; axe runs here on the rendered banner instead.
 * jsdom applies no CSS, so the light and dark scans check names and roles,
 * not contrast.
 */
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { UpdateBanner, type VersionCheckResult } from "./update-banner";

const VERSIONS: VersionCheckResult = {
  hasUpdate: false,
  currentVersion: "1.0.0",
  latestVersion: "1.1.0",
  changelogUrl: "https://example.test/changes",
  isNewlyUpdated: false,
  notes: null,
};

async function seriousViolations(node: Element, theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
  const { violations } = await axe.run(node, { resultTypes: ["violations"] });
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.html).join(" ")}`);
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

describe("UpdateBanner", () => {
  it.each([
    ["an update is available", { hasUpdate: true }, "Update Available: v1.1.0"],
    [
      "what's new after an update",
      { isNewlyUpdated: true },
      "What's New in v1.0.0",
    ],
  ])("%s: the dismiss button is named, in light and dark", async (_state, flags, heading) => {
    const { container } = render(
      <UpdateBanner onCheckVersion={async () => ({ ...VERSIONS, ...flags })} />,
    );
    await screen.findByText(heading);

    for (const theme of ["light", "dark"] as const) {
      expect(await seriousViolations(container, theme), theme).toEqual([]);
    }
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });
});
