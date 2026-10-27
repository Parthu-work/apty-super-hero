import { render, screen } from "@testing-library/react";
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
