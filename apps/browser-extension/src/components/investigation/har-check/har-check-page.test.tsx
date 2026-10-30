import {
  capture,
  harEntriesOf,
  harOf,
} from "@apty/browser-runtime/apty/diagnosis/diagnosis-test-utils";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatHandoff } from "../../../state/chat-handoff";
import { HarCheckPage } from "./har-check-page";

// The shell's header and context bar are tested on their own.
vi.mock("../../shell/tool-page-shell", () => ({
  ToolPageShell: ({
    title,
    children,
    footer,
    hint,
  }: {
    title: string;
    children: ReactNode;
    footer?: ReactNode;
    hint?: string;
  }) => (
    <section aria-label={title}>
      {children}
      {footer}
      {hint && <p>{hint}</p>}
    </section>
  ),
}));

function choose(file: File) {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

const harFile = (har: unknown, name = "customer-tenant.har") =>
  new File([JSON.stringify(har)], name, { type: "application/json" });

beforeEach(() => {
  (
    chrome.storage as unknown as { onChanged: { addListener: () => void } }
  ).onChanged = { addListener: vi.fn() };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HarCheckPage", () => {
  it("summarizes the file, runs the visibility check on it and shows the card", async () => {
    render(<HarCheckPage />);
    expect(screen.getByRole("button", { name: "Check" })).toBeDisabled();

    choose(harFile(harOf(harEntriesOf(capture()))));

    expect(
      await screen.findByText(
        "customer-tenant.har: 12 calls, 11 Apty content files",
      ),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name or sourceId (optional)"), {
      target: { value: "Take a tour" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));

    const card = await screen.findByRole("region", {
      name: "Why “Take a tour” may not be visible",
    });
    expect(card).toHaveTextContent("Cause found");
  });

  it("runs the widget check without a name, and says when the HAR has no page", async () => {
    const har = harOf(harEntriesOf(capture()));
    har.log.entries.shift();
    render(<HarCheckPage />);
    choose(harFile(har));
    await screen.findByText(/Apty content files/);

    fireEvent.change(screen.getByLabelText("What is missing?"), {
      target: { value: "widget" },
    });

    expect(screen.queryByLabelText("Name or sourceId (optional)")).toBeNull();
    expect(
      screen.getByText(
        "This HAR has no page request, so the widget check cannot match the page to an environment.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(
      await screen.findByRole("region", {
        name: "Why the widget may not be visible",
      }),
    ).toBeInTheDocument();
  });

  it("names a file that is not a HAR, and one with no Apty files", async () => {
    render(<HarCheckPage />);

    choose(new File(['{"log":{}}'], "notes.json"));
    expect(
      await screen.findByText(
        "This JSON file has no log entries, so it is not a HAR file.",
      ),
    ).toBeInTheDocument();

    choose(harFile(harOf([{ name: "app.js", body: "" }])));
    expect(
      await screen.findByText("No Apty content files in this HAR"),
    ).toBeInTheDocument();
  });

  it("hands the check's transcript to a new chat, never the file or its name", async () => {
    const request = vi.spyOn(chatHandoff, "request");
    render(<HarCheckPage />);
    choose(harFile(harOf(harEntriesOf(capture()))));
    await screen.findByText(/Apty content files/);
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await screen.findByRole("region", {
      name: "Visibility check: every workflow",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Ask about this result" }),
    );

    const draft = request.mock.calls[0]?.[0];
    expect(draft?.contexts?.[0]?.label).toBe("HAR file check");
    expect(draft?.contexts?.[0]?.value).toMatch(
      /^Checked from a HAR file, not the live Apty Client\.\nVisibility check of workflows/,
    );
    expect(JSON.stringify(draft)).not.toMatch(/customer-tenant|https?:/);
  });

  it("forgets the file when cleared", async () => {
    render(<HarCheckPage />);
    choose(harFile(harOf(harEntriesOf(capture()))));
    await screen.findByText(/Apty content files/);

    fireEvent.click(screen.getByRole("button", { name: "Clear file" }));

    await waitFor(() =>
      expect(screen.queryByText(/Apty content files/)).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Check" })).toBeDisabled();
  });
});
