import { diagnoseContentNotVisible } from "@apty/browser-runtime/apty/diagnosis/content-not-visible";
import {
  capture,
  evidenceFrom,
} from "@apty/browser-runtime/apty/diagnosis/diagnosis-test-utils";
import { diagnoseElementNotFound } from "@apty/browser-runtime/apty/diagnosis/element-not-found";
import { diagnoseLogsAndErrors } from "@apty/browser-runtime/apty/diagnosis/logs-and-errors";
import { diagnosePageReadiness } from "@apty/browser-runtime/apty/diagnosis/page-readiness";
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

  const logsResult = () =>
    diagnoseLogsAndErrors({
      connection: { ok: true },
      clientLogs: {
        ok: true,
        lines: [{ level: "debug", message: "No active application found" }],
      },
      calls: [
        { name: "segment.json", host: "client.apty.example", status: 403 },
      ],
      page: undefined,
    });

  it("shows the logs check: each message the cards name, a failed content request, and what it could not read", () => {
    render(<CheckResultCard tool={tool(logsResult())} />);

    const card = screen.getByRole("region", { name: "Errors and logs" });
    expect(within(card).getByText("Cause found")).toBeInTheDocument();
    expect(
      within(card).getAllByText(
        "Apty found no environment whose URL pattern matches the page, so nothing loads there.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      within(card).getByText("segment.json: HTTP 403"),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        "No web page is open in this tab, so its console was not read",
        { exact: false },
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        "CORS blocks, which the browser does not report to the page",
      ),
    ).toBeInTheDocument();
  });

  it("shows the logs check in Chinese", async () => {
    const languageStorage = {
      load: vi.fn().mockResolvedValue("zh"),
      save: vi.fn(),
      watch: vi.fn(() => () => {}),
    };
    render(
      <I18nProvider storageAdapter={languageStorage as never}>
        <CheckResultCard tool={tool(logsResult())} />
      </I18nProvider>,
    );

    expect(
      await screen.findByRole("region", { name: "错误与日志" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Apty Client 请求 segment.json 失败，因此其中的内容无法到达播放器。",
      ).length,
    ).toBeGreaterThan(0);
  });

  const twoMatches = async () => ({
    ok: true as const,
    frames: [
      {
        depth: 0,
        sameOriginAsTop: true,
        answered: true,
        test: {
          invalid: false,
          matchCount: 2,
          renderedCount: 2,
          brokenHostIndex: null,
          shadowMatches: 0,
          chosen: { rendered: true, inViewport: true },
        },
      },
    ],
  });
  const selectorResult = () =>
    diagnoseElementNotFound(
      evidenceFrom(capture()),
      { kind: "validation", query: "Email format" },
      twoMatches,
    );

  it("shows the selector check with each element it ran, named by where it sits on the item", async () => {
    render(<CheckResultCard tool={tool(await selectorResult())} />);

    const card = screen.getByRole("region", {
      name: "Why Apty may not find the element of “Email format”",
    });
    expect(
      within(card).getAllByText(
        "Disabled element 1: the selector matches 2 elements (2 rendered). Apty takes the first rendered one, which may not be yours.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      within(card).getByText(
        "Whether the element is on the page at the moment the content runs",
      ),
    ).toBeInTheDocument();
  });

  it("shows the selector check in Chinese, the element's place included", async () => {
    const languageStorage = {
      load: vi.fn().mockResolvedValue("zh"),
      save: vi.fn(),
      watch: vi.fn(() => () => {}),
    };
    const result = await selectorResult();
    render(
      <I18nProvider storageAdapter={languageStorage as never}>
        <CheckResultCard tool={tool(result)} />
      </I18nProvider>,
    );

    expect(
      await screen.findByRole("region", {
        name: "Apty 可能找不到“Email format”元素的原因",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "禁用元素 1：选择器匹配 2 个元素（2 个已渲染）。Apty 使用第一个已渲染的元素，它可能不是你要的那个。",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("shows the page check with each DOM Health finding and its card", () => {
    const result = diagnosePageReadiness({
      available: true,
      score: 60,
      grade: "FAIR",
      confidence: "MEDIUM",
      evidenceState: "HEALTHY_EVIDENCE",
      frameAccessibility: {
        framesTotal: 1,
        framesAccessible: 1,
        framesFailed: 0,
        framesInaccessible: 0,
      },
      iframes: { total: 0 },
      shadowDom: { roots: 0, elements: 0 },
      zIndex: { highZIndexElementCount: 0 },
      duplicateIds: { elementsWithDuplicatedId: 4 },
      virtualized: { containers: 0, observedItems: 0 },
      manualSelectorDependency: 5,
      metadata: { interactiveElementsAnalyzed: 80 },
      risks: [{ id: "duplicate-ids" }],
    } as never);
    render(<CheckResultCard tool={tool(result)} />);

    const card = screen.getByRole("region", {
      name: "Element selection on this page",
    });
    expect(
      within(card).getAllByText(
        "4 element(s) share their id with another in the same document or shadow root, so a selector on that id matches more than one.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      within(card).getAllByRole("link", { name: /1496580223/ }).length,
    ).toBeGreaterThan(0);
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
