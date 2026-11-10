import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatErrorNotice } from "./chat-error-notice";

describe("ChatErrorNotice", () => {
  it("shows the organization's refusal as it is, naming what is allowed (KB-RAG K22)", () => {
    render(
      <ChatErrorNotice
        error={{
          kind: "destinationRefused",
          message:
            "This AI provider is not allowed by your organization. Allowed: azure.",
        }}
      />,
    );
    expect(
      screen.getByText(
        "This AI provider is not allowed by your organization. Allowed: azure.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Details")).toBeNull();
  });

  it("keeps the fixed sentence and the Details for other failures", () => {
    render(
      <ChatErrorNotice error={{ kind: "unknown", message: "boom 500" }} />,
    );
    expect(
      screen.getByText("Something went wrong with the request."),
    ).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
  });
});
