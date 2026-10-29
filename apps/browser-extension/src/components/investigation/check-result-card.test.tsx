import { diagnoseContentNotVisible } from "@apty/browser-runtime/apty/diagnosis/content-not-visible";
import {
  capture,
  evidenceFrom,
} from "@apty/browser-runtime/apty/diagnosis/diagnosis-test-utils";
import type { ClientEvidence } from "@apty/browser-runtime/apty/diagnosis/types";
import { diagnoseWidgetNotVisible } from "@apty/browser-runtime/apty/diagnosis/widget-not-visible";
import { I18nProvider } from "@apty/ui/i18n/context";
import type { UIToolPart } from "@apty/ui/types";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AptyToolDisplay } from "./apty-tool-display";
import { CheckResultCard } from "./check-result-card";

function tool(output: unknown): UIToolPart {
  return {
    type: "tool",
    toolName: "run_diagnosis",
    toolCallId: "call-1",
    input: { kind: "workflow" },
    output,
    state: "completed",
  };
}

const check = (query?: string, evidence = evidenceFrom(capture())) =>
  diagnoseContentNotVisible(evidence, "workflow", query);

describe("CheckResultCard", () => {
  it("shows the cause with its fix, evidence, rule and KB card", () => {
    render(<CheckResultCard tool={tool(check("Take a tour"))} />);

    const card = screen.getByRole("region", {
      name: "Why “Take a tour” may not be visible",
    });
    expect(within(card).getByText("Cause found")).toBeInTheDocument();
    expect(
      within(card).getAllByText("“Hide from widget” is on for “Take a tour”."),
    ).toHaveLength(2);
    expect(
      within(card).getByText(
        "In Studio, clear “Hide from widget” in its settings and publish.",
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByText("workflow.json: hideFromWidget = true"),
    ).toBeInTheDocument();
    expect(within(card).getByText("Rule CNV-03")).toBeInTheDocument();
    const links = within(card).getAllByRole("link", {
      name: /KB card 1496842241/,
    });
    expect(links[0]).toHaveAttribute(
      "href",
      "https://apty.atlassian.net/wiki/spaces/JA/pages/1496842241",
    );
  });

  it("says what is left to the browser when the files show no blocker", () => {
    render(<CheckResultCard tool={tool(check("Create a lead"))} />);

    expect(
      screen.getByText("Needs a check in the browser"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The files show no blocker. What is left is decided in the browser.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Test as a user known to match the segment, and confirm the widget shows for that user.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The user must match one of: Sales team", {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Not checked from the files")).toBeInTheDocument();
    expect(
      screen.getByText("Whether this user matches a segment's rule"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "From 5.x code at 4c406d5, not runtime-verified. Confidence: likely.",
      ),
    ).toBeInTheDocument();
  });

  it("lists every blocked item when no item was named", () => {
    render(<CheckResultCard tool={tool(check())} />);

    expect(
      screen.getByRole("region", { name: "Visibility check: every workflow" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("2 of 9 have a blocker in the files"),
    ).toBeInTheDocument();
    expect(screen.getByText("Take a tour")).toBeInTheDocument();
    expect(screen.getByText("Hidden from the widget")).toBeInTheDocument();
    expect(screen.getByText("Only in turned-off segments")).toBeInTheDocument();
  });

  it("asks which one when several items match", () => {
    render(<CheckResultCard tool={tool(check("Request"))} />);

    expect(screen.getAllByText("2 items match “Request”")).toHaveLength(2);
    expect(
      screen.getByText("Request activities (0c000000)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Which one? Give the full name or the sourceId."),
    ).toBeInTheDocument();
  });

  it("names a Client it could not reach instead of a verdict", () => {
    const unreachable: ClientEvidence = {
      connection: {
        ok: false,
        failure: "no_receiver",
        message: "Chrome found nothing listening.",
      },
      observedNames: [],
      files: {},
    };

    render(<CheckResultCard tool={tool(check("x", unreachable))} />);

    expect(screen.getByText("No data to check")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Could not reach the Apty Client: Chrome found nothing listening.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Fix the connection to the Apty Client first; this says nothing about the content.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the card in Chinese when the language is zh", async () => {
    const languageStorage = {
      load: vi.fn().mockResolvedValue("zh"),
      save: vi.fn(),
      watch: vi.fn(() => () => {}),
    };
    render(
      <I18nProvider storageAdapter={languageStorage as never}>
        <CheckResultCard tool={tool(check("Take a tour"))} />
      </I18nProvider>,
    );

    expect(await screen.findByText("已找到原因")).toBeInTheDocument();
    expect(
      screen.getAllByText("“Take a tour”开启了“在小组件中隐藏”。"),
    ).toHaveLength(2);
    expect(screen.queryByText("Cause found")).toBeNull();
  });

  it("shows the widget check: a page no environment covers, with its fix and card", () => {
    const result = diagnoseWidgetNotVisible(
      evidenceFrom(capture()),
      "https://other.example.org/x",
    );
    render(<CheckResultCard tool={tool(result)} />);

    const card = screen.getByRole("region", {
      name: "Why the widget may not be visible",
    });
    expect(within(card).getByText("Cause found")).toBeInTheDocument();
    expect(
      within(card).getAllByText(
        "No environment's URL pattern matches this page, so nothing from Apty loads here.",
      ),
    ).toHaveLength(2);
    expect(
      within(card).getByText(
        "environments checked: Production (order 1), UAT (order 2)",
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getAllByRole("link", { name: /KB card 1496645690/ })[0],
    ).toHaveAttribute(
      "href",
      "https://apty.atlassian.net/wiki/spaces/JA/pages/1496645690",
    );
    expect(
      within(card).getByText(
        "Whether the page's CSS hides the widget container",
      ),
    ).toBeInTheDocument();
  });

  it("lists the open widget checks when the files show no blocker", () => {
    const result = diagnoseWidgetNotVisible(
      evidenceFrom(capture()),
      "https://uat.crm.example.com/leads",
    );
    render(<CheckResultCard tool={tool(result)} />);

    expect(
      screen.getByText("Needs a check in the browser"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This page belongs to UAT (order 2)", { exact: false }),
    ).toBeInTheDocument();
  });

  it("shows the widget check and a missing translation in Chinese", async () => {
    const languageStorage = {
      load: vi.fn().mockResolvedValue("zh"),
      save: vi.fn(),
      watch: vi.fn(() => () => {}),
    };
    const widget = diagnoseWidgetNotVisible(
      evidenceFrom(capture()),
      "https://other.example.org/x",
    );
    const language = diagnoseContentNotVisible(
      evidenceFrom(capture()),
      "workflow",
      "Create a lead",
      "fr",
    );
    render(
      <I18nProvider storageAdapter={languageStorage as never}>
        <CheckResultCard tool={tool(widget)} />
        <CheckResultCard tool={tool(language)} />
      </I18nProvider>,
    );

    expect(
      await screen.findByRole("region", { name: "小组件为何可能不可见" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "没有环境的 URL 模式匹配此页面，因此 Apty 在这里不加载任何内容。",
      ),
    ).toHaveLength(2);
    expect(
      screen.getAllByText(
        "“Create a lead”没有法语（fr）名称，因此小组件不会向法语用户显示它。",
      ),
    ).toHaveLength(2);
  });

  it("falls back to the default display for an output it does not recognise", () => {
    render(<AptyToolDisplay tool={tool({ unexpected: true })} />);

    expect(screen.queryByText("Cause found")).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("is what the tool display shows for a completed run_diagnosis call", () => {
    render(<AptyToolDisplay tool={tool(check("Take a tour"))} />);

    expect(screen.getByText("Cause found")).toBeInTheDocument();
  });
});
