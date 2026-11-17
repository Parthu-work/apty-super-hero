import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatStatus, UIMessage } from "../../../types";
import { DefaultMessageList } from "./message-list";

const messages: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Why?" }] },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: "Because" }] },
];

const running = () =>
  screen.getByText("Processing...").closest('[role="status"]');

describe("DefaultMessageList — running state", () => {
  it.each<ChatStatus>([
    "submitted",
    "streaming",
    "executing_tools",
  ])("shows Processing after the last message while %s", (status) => {
    render(<DefaultMessageList messages={messages} status={status} />);

    const indicator = running();
    expect(indicator).toHaveTextContent("Processing...");
    expect(
      screen
        .getByText("Because")
        .compareDocumentPosition(indicator as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each<ChatStatus>([
    "idle",
    "error",
  ])("shows nothing running once the turn is %s", (status) => {
    render(<DefaultMessageList messages={messages} status={status} />);

    expect(screen.queryByText("Processing...")).toBeNull();
  });
});

describe("DefaultMessageList — the running answer's actions", () => {
  it("holds them until the turn ends", () => {
    const props = { messages, onCopy: () => {}, onRegenerate: () => {} };
    const { rerender } = render(
      <DefaultMessageList {...props} status="streaming" />,
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

    rerender(<DefaultMessageList {...props} status="idle" />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("a long chat (KB-RAG K27, U1)", () => {
  const chat = (turns: number): UIMessage[] =>
    Array.from({ length: turns }, (_, n) => [
      {
        id: `u-${n}`,
        role: "user" as const,
        timestamp: n,
        parts: [{ type: "text" as const, text: `FIXTURE question ${n}` }],
      },
      {
        id: `a-${n}`,
        role: "assistant" as const,
        timestamp: n,
        parts: [{ type: "text" as const, text: `FIXTURE answer ${n}` }],
      },
    ]).flat();

  it("renders the newest 60 turns above 100, and Show earlier messages adds 60 more", () => {
    render(<DefaultMessageList messages={chat(150)} status="idle" />);
    expect(screen.queryByText("FIXTURE answer 89")).toBeNull();
    expect(screen.getByText("FIXTURE answer 90")).toBeInTheDocument();
    expect(screen.getByText("FIXTURE answer 149")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Show earlier messages" }),
    );
    expect(screen.getByText("FIXTURE answer 30")).toBeInTheDocument();
    expect(screen.queryByText("FIXTURE answer 29")).toBeNull();
  });

  it("renders every turn of a chat of 100 turns or fewer", () => {
    render(<DefaultMessageList messages={chat(100)} status="idle" />);
    expect(screen.getByText("FIXTURE answer 0")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show earlier messages" }),
    ).toBeNull();
  });
});
