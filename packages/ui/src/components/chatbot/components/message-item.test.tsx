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
