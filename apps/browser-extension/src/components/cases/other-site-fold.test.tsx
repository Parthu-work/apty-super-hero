import { siteKeyOf } from "@apty/agent-core";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/cases", () => ({
  caseStore: () => ({
    list: async () => [
      {
        id: "CASE-20261112-0000",
        createdAt: "2026-11-12T00:00:00.000Z",
        tabHost: "one.example.com",
      },
    ],
  }),
  caseRecorder: () => ({ subscribe: () => () => undefined }),
}));

import { OtherSiteFold } from "./other-site-fold";

beforeEach(() => {
  (globalThis as { chrome?: unknown }).chrome = {
    tabs: {
      query: async () => [{ url: "https://two.example.com/page" }],
    },
  };
});

describe("OtherSiteFold (KB-RAG K27, F4)", () => {
  it("collapses a card from another site under From <site>", async () => {
    render(
      <OtherSiteFold siteKey={siteKeyOf("one.example.com")}>
        <p>FIXTURE verdict</p>
      </OtherSiteFold>,
    );
    const fold = await screen.findByTestId("other-site-fold");
    expect(fold).not.toHaveAttribute("open");
    expect(await screen.findByText("From one.example.com")).toBeInTheDocument();
  });

  it("shows a card from the current site as it is", async () => {
    render(
      <OtherSiteFold siteKey={siteKeyOf("two.example.com")}>
        <p>FIXTURE verdict</p>
      </OtherSiteFold>,
    );
    expect(await screen.findByText("FIXTURE verdict")).toBeVisible();
    expect(screen.queryByTestId("other-site-fold")).toBeNull();
  });
});
