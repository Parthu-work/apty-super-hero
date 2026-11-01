import { diagnoseDaptyConversation } from "@apty/browser-runtime/apty/diagnosis/dapty-conversation";
import {
  daptyEvidenceFromCalls,
  daptyEvidenceFromDom,
} from "@apty/browser-runtime/apty/diagnosis/dapty-parse";
import {
  capture,
  evidenceFrom,
} from "@apty/browser-runtime/apty/diagnosis/diagnosis-test-utils";
import { I18nProvider } from "@apty/ui/i18n/context";
import type { UIToolPart } from "@apty/ui/types";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const recordDaptyChat = vi.hoisted(() => vi.fn());
vi.mock("@apty/browser-runtime/apty/dapty-page-capture", () => ({
  recordDaptyChat,
}));

import { CheckResultCard } from "./check-result-card";

const CHAT =
  "https://api.app.apty.ai/ai-service/api/v1/ai/t-1/widget/chat?applicationId=0a000000-0000-7000-8000-000000000001";

function tool(output: unknown): UIToolPart {
  return {
    type: "tool",
    toolName: "run_diagnosis",
    toolCallId: "call-1",
    input: { kind: "dapty" },
    output,
    state: "completed",
  };
}

function checked(responseBody: string, failed = false) {
  const chat = daptyEvidenceFromCalls(
    [
      {
        source: "page",
        kind: "chat",
        url: CHAT,
        method: "POST",
        ...(failed ? { failed: true } : { status: 200 }),
        requestBody: JSON.stringify({
          message: "Which workflow exports a report?",
          context: [],
        }),
        responseBody,
        timestamp: 1,
      },
    ],
    "page",
  );
  return diagnoseDaptyConversation(
    chat,
    evidenceFrom(capture()),
    "https://intranet.example.org/crm",
  );
}

const SUGGESTED = JSON.stringify({
  reply: "Try these.",
  suggestions: [
    {
      id: "0c000000-0000-7000-8000-000000000008",
      name: "Qualify a lead",
      type: "workflow",
    },
    {
      id: "0c000000-0000-7000-8000-0000000000ff",
      name: "Retired flow",
      type: "workflow",
    },
  ],
});

describe("CheckResultCard for the Ask Dapty check", () => {
  it("shows each suggestion's outcome, the cause with no KB link, and the last question", () => {
    render(<CheckResultCard tool={tool(checked(SUGGESTED))} />);

    const card = screen.getByRole("region", { name: "Ask Dapty chat check" });
    expect(within(card).getByText("Cause found")).toBeInTheDocument();
    expect(
      within(card).getAllByText(
        "Dapty suggested “Retired flow”, which this environment does not publish, so clicking it opens nothing.",
      ).length,
    ).toBeGreaterThan(0);
    expect(within(card).getByText("Rule DAP-06")).toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: /KB card/ })).toBeNull();
    expect(
      within(card).getByText(
        "Opens only if visibility rule “On a lead page” passes",
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByText("Not published here: opens nothing"),
    ).toBeInTheDocument();
    expect(
      within(card).getByText("The user's last question"),
    ).toBeInTheDocument();
    expect(
      within(card).getByText("Which workflow exports a report?"),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        "From Apty's widget chat and ai-service code (apty-dap development), not runtime-verified. Confidence: likely.",
      ),
    ).toBeInTheDocument();
  });

  it("names a failed call and the origin ai-service's CORS check rejects", () => {
    render(<CheckResultCard tool={tool(checked("", true))} />);

    const card = screen.getByRole("region", { name: "Ask Dapty chat check" });
    expect(
      within(card).getAllByText(
        "The page's origin is not among the origins the application's 2 environment URL(s) allow, so in Injected mode ai-service's CORS check rejects the chat call.",
      ).length,
    ).toBeGreaterThan(0);
    expect(within(card).getByText("Rule DAP-04")).toBeInTheDocument();
    expect(within(card).getByText("Rule DAP-02")).toBeInTheDocument();
  });

  it("says suggestions from the chat panel were matched by name", () => {
    const result = diagnoseDaptyConversation(
      daptyEvidenceFromDom([
        { role: "assistant", text: "Here", suggestionNames: ["Create a lead"] },
      ]),
      evidenceFrom(capture()),
    );
    render(<CheckResultCard tool={tool(result)} />);

    expect(
      screen.getByText(
        "Matched by name: the chat panel does not show the suggestions' ids.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("From the widget's chat panel: 1 turn(s)."),
    ).toBeInTheDocument();
  });

  it("says why the stored chat with ids was not read, and that the files came from the CDN", () => {
    const result = diagnoseDaptyConversation(
      {
        ...daptyEvidenceFromDom([
          {
            role: "assistant",
            text: "Here",
            suggestionNames: ["Create a lead"],
          },
        ]),
        storedChatUnread: "apty-id",
      },
      { ...evidenceFrom(capture()), fromCdn: true },
    );
    render(<CheckResultCard tool={tool(result)} />);

    expect(
      screen.getByText(
        "The stored chat, which has the ids, was not read: this application identifies its users by an Apty ID that only the Apty Client can read.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Content files read from Apty's content CDN, as the Apty Client does not report its calls.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the Ask Dapty card in Chinese", async () => {
    const languageStorage = {
      load: vi.fn().mockResolvedValue("zh"),
      save: vi.fn(),
      watch: vi.fn(() => () => {}),
    };
    render(
      <I18nProvider storageAdapter={languageStorage as never}>
        <CheckResultCard tool={tool(checked(SUGGESTED))} />
      </I18nProvider>,
    );

    expect(
      await screen.findByRole("region", { name: "Ask Dapty 聊天检查" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("未在此发布：点击后什么也不会打开"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Not published here: opens nothing")).toBeNull();
  });
  it("records the next chat in this tab when no answer was captured", async () => {
    recordDaptyChat.mockResolvedValue({ ok: true, until: 1 });
    (chrome.tabs as unknown as { query: unknown }).query = vi.fn(async () => [
      { id: 12 },
    ]);
    const unanswered = diagnoseDaptyConversation(
      daptyEvidenceFromCalls(
        [
          {
            source: "page",
            kind: "chat",
            url: CHAT,
            method: "POST",
            status: 200,
            requestBody: JSON.stringify({ message: "help", context: [] }),
            timestamp: 1,
          },
        ],
        "page",
      ),
      evidenceFrom(capture()),
    );
    render(<CheckResultCard tool={tool(unanswered)} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Record the next Ask Dapty chat (2 minutes)",
      }),
    );

    expect(
      await screen.findByText(
        "Recording this tab: ask Dapty the question again on the page, then ask me to check again.",
      ),
    ).toBeInTheDocument();
    expect(recordDaptyChat).toHaveBeenCalledWith(12, { maxMs: 120_000 });
  });

  it("offers no recording when the chat already has its answer", () => {
    render(<CheckResultCard tool={tool(checked(SUGGESTED))} />);

    expect(
      screen.queryByRole("button", { name: /Record the next Ask Dapty chat/ }),
    ).toBeNull();
  });
});
