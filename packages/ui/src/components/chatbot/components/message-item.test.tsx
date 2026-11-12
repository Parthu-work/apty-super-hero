import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as downloadLib from "../../../lib/download";
import type { UIMessage } from "../../../types";
import { ComponentsContext } from "../context";
import { CollapsedMessageItem, DefaultMessageItem } from "./message-item";

function assistantMessage(text: string): UIMessage {
  return {
    id: "msg-1",
    role: "assistant",
    parts: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

describe("DefaultMessageItem — copy/download actions", () => {
  it("shows a checkmark after a successful copy, then reverts", async () => {
    vi.useFakeTimers();
    const onCopy = vi.fn().mockResolvedValue(true);

    render(
      <DefaultMessageItem
        message={assistantMessage("hello world")}
        isLast
        onCopy={onCopy}
      />,
    );

    const copyButton = screen.getByRole("button", { name: /^copy$/i });
    fireEvent.click(copyButton);

    await vi.waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^copied$/i }),
      ).toBeInTheDocument();
    });
    expect(onCopy).toHaveBeenCalledWith("hello world");

    vi.advanceTimersByTime(2000);
    await vi.waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^copy$/i }),
      ).toBeInTheDocument();
    });

    vi.useRealTimers();
  });

  it("does not show a checkmark when the copy fails", async () => {
    const onCopy = vi.fn().mockResolvedValue(false);

    render(
      <DefaultMessageItem
        message={assistantMessage("hello world")}
        isLast
        onCopy={onCopy}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    await waitFor(() => expect(onCopy).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: /^copied$/i }),
    ).not.toBeInTheDocument();
  });

  it("treats a plain void-returning onCopy (legacy consumers) as success", async () => {
    const onCopy = vi.fn();

    render(
      <DefaultMessageItem
        message={assistantMessage("hello world")}
        isLast
        onCopy={onCopy}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^copied$/i }),
      ).toBeInTheDocument();
    });
  });

  it("always renders a Download action, independent of onCopy, and triggers downloadText", () => {
    const downloadSpy = vi
      .spyOn(downloadLib, "downloadText")
      .mockReturnValue(true);

    render(
      <DefaultMessageItem message={assistantMessage("some content")} isLast />,
    );

    fireEvent.click(screen.getByRole("button", { name: /download/i }));

    expect(downloadSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^message-.*\.md$/),
      "some content",
      "text/markdown",
    );
  });
});

describe("DefaultMessageItem — export header", () => {
  it("downloads the text through formatExport", () => {
    const downloadSpy = vi
      .spyOn(downloadLib, "downloadText")
      .mockReturnValue(true);

    render(
      <DefaultMessageItem
        message={assistantMessage("some content")}
        isLast
        formatExport={(text) => `HEADER\n\n${text}`}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /download/i }));

    expect(downloadSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^message-.*\.md$/),
      "HEADER\n\nsome content",
      "text/markdown",
    );
  });
});

describe("toolFooter slot", () => {
  const toolMessage: UIMessage = {
    id: "msg-tool",
    role: "assistant",
    parts: [
      {
        type: "tool",
        toolName: "inspect_extension_network",
        toolCallId: "call-1",
        input: {},
        output: { ok: true },
        state: "completed",
      },
    ],
    timestamp: Date.now(),
  };
  const slots = {
    toolFooter: ({ tool }: { tool: { toolName: string } }) => (
      <span>footer for {tool.toolName}</span>
    ),
  };

  it.each([
    ["full", <DefaultMessageItem key="full" message={toolMessage} isLast />],
    ["collapsed", <CollapsedMessageItem key="c" message={toolMessage} />],
  ])("renders under a tool call in the %s view", (_view, element) => {
    render(
      <ComponentsContext.Provider value={{ components: {}, slots }}>
        {element}
      </ComponentsContext.Provider>,
    );

    expect(
      screen.getByText("footer for inspect_extension_network"),
    ).toBeInTheDocument();
  });
});

describe("DefaultMessageItem — image file parts", () => {
  function fileMessage(url: string): UIMessage {
    return {
      id: "msg-file",
      role: "user",
      parts: [
        { type: "file", mediaType: "image/png", url, filename: "shot.png" },
      ],
      timestamp: Date.now(),
    } as UIMessage;
  }

  it("never loads a remote image URL from a file part", () => {
    const { container } = render(
      <DefaultMessageItem
        message={fileMessage("https://evil.test/leak.png?d=SECRET")}
        isLast={false}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("evil.test");
    expect(screen.getByText("shot.png")).toBeInTheDocument();
  });

  it("renders a data: image file part", () => {
    const url = "data:image/png;base64,AAAA";
    const { container } = render(
      <DefaultMessageItem message={fileMessage(url)} isLast={false} />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(url);
  });
});

describe("DefaultMessageItem — screenshot links", () => {
  const data = "data:image/png;base64,AAAA";

  function screenshotMessage(text: string): UIMessage {
    return {
      id: "msg-shot",
      role: "assistant",
      parts: [
        {
          type: "tool",
          toolName: "capture_screenshot",
          toolCallId: "call-1",
          input: {},
          state: "completed",
          screenshotUid: "screenshot_1_x",
          screenshot: data,
        },
        { type: "text", text },
      ],
      timestamp: Date.now(),
    } as UIMessage;
  }

  it.each([
    ["a screenshot placeholder", "see [[screenshot:1]]"],
    [
      "a link under the host earlier versions wrote",
      "see ![](https://aipex-screenshot.invalid/screenshot_1_x)",
    ],
  ])("shows the screenshot for %s", async (_name, text) => {
    const { container } = render(
      <DefaultMessageItem message={screenshotMessage(text)} isLast={false} />,
    );
    await waitFor(() =>
      expect(
        Array.from(container.querySelectorAll("img")).map((img) =>
          img.getAttribute("src"),
        ),
      ).toContain(data),
    );
  });
});

describe("DefaultMessageItem — a failed turn", () => {
  function failed(
    kind: "badKey" | "rateLimit" | "timeout",
    extra: { retryAfterMs?: number; text?: string } = {},
  ): UIMessage {
    return {
      id: "msg-err",
      role: "assistant",
      parts: extra.text ? [{ type: "text", text: extra.text }] : [],
      metadata: {
        errorCode: "LLM_API_ERROR",
        error: {
          kind,
          message: "401 Incorrect API key provided",
          ...(extra.retryAfterMs ? { retryAfterMs: extra.retryAfterMs } : {}),
        },
      },
    };
  }

  it("shows an alert after what streamed, with the cause, the provider's words under Details, Retry and the provider settings", () => {
    const onRegenerate = vi.fn();
    const onOpenProviderSettings = vi.fn();
    render(
      <DefaultMessageItem
        message={failed("badKey", { text: "partial answer" })}
        isLast
        onRegenerate={onRegenerate}
        onOpenProviderSettings={onOpenProviderSettings}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(screen.getByText("partial answer")).toBeInTheDocument();
    expect(alert).toHaveTextContent("Couldn't get an answer");
    expect(alert).toHaveTextContent(/rejected the request/i);
    const details = screen.getByText("Details").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("401 Incorrect API key provided");

    const actions = within(alert).getAllByRole("button");
    expect(actions.map((b) => b.textContent)).toEqual([
      "Retry",
      "Open AI provider settings",
    ]);
    fireEvent.click(actions[0]!);
    fireEvent.click(actions[1]!);
    expect(onRegenerate).toHaveBeenCalledOnce();
    expect(onOpenProviderSettings).toHaveBeenCalledOnce();
  });

  it("offers no provider settings for a failure they cannot fix, and says when to retry", () => {
    render(
      <DefaultMessageItem
        message={failed("rateLimit", { retryAfterMs: 12_000 })}
        isLast
        onRegenerate={vi.fn()}
        onOpenProviderSettings={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/retry in about 12 s/i);
    expect(
      within(alert).queryByRole("button", { name: /provider settings/i }),
    ).not.toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("offers no Retry on an earlier failure, since Retry regenerates the last answer", () => {
    render(
      <DefaultMessageItem
        message={failed("timeout")}
        isLast={false}
        onRegenerate={vi.fn()}
      />,
    );

    expect(
      within(screen.getByRole("alert")).queryByRole("button"),
    ).not.toBeInTheDocument();
  });
});

describe("DefaultMessageItem — the user's message", () => {
  it("puts the words in a quiet bubble and the context chips under it, in the order sent", () => {
    const { container } = render(
      <DefaultMessageItem
        message={{
          id: "msg-user",
          role: "user",
          parts: [
            {
              type: "context",
              contextType: "custom",
              label: "DOM health result",
              value: "{}",
            },
            { type: "text", text: "What should we fix first?" },
          ],
        }}
      />,
    );

    const words = screen.getByText("What should we fix first?");
    const chip = screen.getByText("DOM health result");
    expect(
      words.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelector(".is-user")).not.toBeNull();
    expect(container.querySelector(".bg-primary")).toBeNull();
  });
});

describe("DefaultMessageItem — actions on every answer", () => {
  it("shows the last answer's actions, Retry among them", () => {
    const { container } = render(
      <DefaultMessageItem
        message={assistantMessage("latest")}
        isLast
        onRegenerate={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(container.querySelector(".opacity-0")).toBeNull();
  });

  it("keeps an earlier answer's Copy until hover or focus, and offers no Retry there", () => {
    const { container } = render(
      <DefaultMessageItem
        message={assistantMessage("earlier")}
        isLast={false}
        onRegenerate={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    const copy = screen.getByRole("button", { name: /^copy$/i });
    expect(copy.closest(".opacity-0")).not.toBeNull();
    expect(
      container
        .querySelector(".opacity-0")
        ?.className.includes("group-focus-within/message:opacity-100"),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("copies the whole answer once, not once per paragraph part", async () => {
    const onCopy = vi.fn().mockResolvedValue(true);
    render(
      <DefaultMessageItem
        message={{
          id: "msg-2",
          role: "assistant",
          parts: [
            { type: "text", text: "first" },
            { type: "text", text: "second" },
          ],
        }}
        isLast
        onCopy={onCopy}
      />,
    );

    expect(screen.getAllByRole("button", { name: /^copy$/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    await waitFor(() => expect(onCopy).toHaveBeenCalledWith("first\nsecond"));
  });
});

describe("DefaultMessageItem — KB grounding (K18)", () => {
  const searched: UIMessage = {
    id: "msg-kb",
    role: "assistant",
    timestamp: Date.now(),
    parts: [
      {
        type: "tool",
        toolName: "search_kb",
        toolCallId: "c1",
        state: "completed",
        input: { query: "banner" },
        output: {
          status: "ok",
          results: [
            {
              cite: "kb://101#L1",
              site: "fixture.atlassian.net",
              space: "FX",
              text: "- In Studio, turn on the FIXTURE Glowing Banner setting.",
            },
          ],
        },
      },
      {
        type: "text",
        text: "Turn on Glowing Banner (kb://101#L1), then open Widget Activation (kb://999#L2).",
      },
    ],
  };

  it("names and underlines a setting no returned card holds, and does not link a citation the turn did not return", async () => {
    render(<DefaultMessageItem message={searched} isLast />);
    expect(
      await screen.findByText(
        "Not found in the cited KB cards: Widget Activation",
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelector("[data-kb-ungrounded]")?.textContent).toBe(
        "Widget Activation",
      ),
    );
    expect(
      document.querySelector("[data-kb-ungrounded]")?.getAttribute("title"),
    ).toBe("Not found in the cited KB cards");
    expect(screen.getByText(/unknown citation/)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /999/ }) ??
        screen.queryByRole("button", { name: /999/ }),
    ).toBeNull();
  });

  it("checks nothing in a turn that did not search the KB", () => {
    render(
      <DefaultMessageItem
        message={assistantMessage("Open Widget Activation in Admin.")}
        isLast
      />,
    );
    expect(screen.queryByText(/Not found in the cited KB cards/)).toBeNull();
  });
});

describe("DefaultMessageItem — the turn's decision (KB-RAG K25, A2)", () => {
  const base = {
    version: "4.x" as const,
    versionSource: "user" as const,
    packs: [{ version: "4.x" as const, sha256: "0123456789ab" }],
  };
  const withDecision = (
    decision: NonNullable<UIMessage["metadata"]>["decision"],
  ) => ({
    ...assistantMessage("From the model"),
    metadata: { decision },
  });

  it.each([
    [
      {
        kind: "not_covered",
        reason: "low_coverage",
        coverage: 0.42,
        min: 0.5,
        version: "4.x",
      },
      "No KB card matched (coverage 0.42, needs 0.50). Asked the AI model.",
    ],
    [
      { kind: "no_pack", version: "4.x" },
      "No 4.x pack is loaded. Asked the AI model.",
    ],
    [
      { kind: "error", code: "pack_read_failed" },
      "The KB could not be searched (pack_read_failed). Asked the AI model.",
    ],
  ] as const)("the model's reply shows why the KB did not answer: %j", (kb, line) => {
    render(
      <DefaultMessageItem
        message={withDecision({ ...base, route: "model", kb })}
      />,
    );
    expect(screen.getByTestId("kb-decision-line")).toHaveTextContent(line);
  });

  it("a how-to shows no line, and a KB answer none either", () => {
    const { rerender } = render(
      <DefaultMessageItem
        message={withDecision({
          ...base,
          route: "model",
          kb: { kind: "how_to" },
        })}
      />,
    );
    expect(screen.queryByTestId("kb-decision-line")).toBeNull();
    rerender(
      <DefaultMessageItem
        message={withDecision({
          ...base,
          route: "kb",
          kb: { kind: "answer", status: "ok", pageIds: ["202"] },
        })}
      />,
    );
    expect(screen.queryByTestId("kb-decision-line")).toBeNull();
  });

  it("Why this answer is collapsed and lists the route, version, packs and KB outcome", () => {
    render(
      <DefaultMessageItem
        message={withDecision({
          ...base,
          route: "model",
          kb: {
            kind: "not_covered",
            reason: "low_coverage",
            coverage: 0.42,
            min: 0.5,
            topPageId: "202",
            version: "4.x",
          },
        })}
      />,
    );
    const details = screen.getByTestId("turn-decision");
    expect(details).not.toHaveAttribute("open");
    expect(within(details).getByText("Why this answer")).toBeInTheDocument();
    expect(details).toHaveTextContent("Answered by: the AI model");
    expect(details).toHaveTextContent("Apty version: 4.x (your choice)");
    expect(details).toHaveTextContent("Packs searched: 4.x 0123456789ab");
    expect(details).toHaveTextContent(
      "KB: not covered (low_coverage), coverage 0.42, needs 0.50, closest card 202",
    );
  });
});
