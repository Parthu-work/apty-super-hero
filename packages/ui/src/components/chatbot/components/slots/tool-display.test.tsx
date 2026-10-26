import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { UIToolPart } from "../../../../types";
import { DefaultToolDisplay } from "./tool-display";

function tool(overrides: Partial<UIToolPart>): UIToolPart {
  return {
    type: "tool",
    toolName: "get_page_info",
    toolCallId: "call-1",
    input: { tabId: 7 },
    state: "completed",
    ...overrides,
  } as UIToolPart;
}

const header = () => screen.getByRole("button", { expanded: false });

describe("DefaultToolDisplay", () => {
  it.each<[UIToolPart["state"], string, string]>([
    ["pending", "Pending", "dot"],
    ["executing", "Running", "spinner"],
    ["completed", "Completed", "icon"],
    ["error", "Error", "icon"],
  ])("shows a %s call collapsed, its status as a word beside an indicator", (state, word, indicator) => {
    const { container } = render(
      <DefaultToolDisplay tool={tool({ state, errorText: "boom" })} />,
    );

    expect(header()).toHaveTextContent(word);
    expect(
      container.querySelector(`[data-indicator="${indicator}"]`),
    ).not.toBeNull();
    expect(screen.queryByText("Parameters")).toBeNull();
  });

  it("opens to the parameters and the result, each in its own block with its own Copy", () => {
    render(
      <DefaultToolDisplay
        tool={tool({ output: { title: "Orders", count: 3 } })}
      />,
    );
    fireEvent.click(header());

    expect(screen.getByText("Parameters")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
    const blocks = document.querySelectorAll("pre");
    expect(blocks[0]).toHaveTextContent('"tabId": 7');
    expect(blocks[1]).toHaveTextContent('"title": "Orders"');
    expect(
      screen.getByRole("button", { name: "Copy parameters" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy result" }),
    ).toBeInTheDocument();
  });

  it("shows a failed call's error in an error notice inside the card", () => {
    render(
      <DefaultToolDisplay
        tool={tool({ state: "error", errorText: "Tab 7 was closed" })}
      />,
    );
    fireEvent.click(header());

    expect(screen.getByRole("alert")).toHaveTextContent("Tab 7 was closed");
    expect(screen.queryByText("Result")).toBeNull();
  });

  it("does not repeat an error as the result when a reopened chat stored it as both", () => {
    render(
      <DefaultToolDisplay
        tool={tool({
          state: "error",
          errorText: "Tab 7 was closed",
          output: "Tab 7 was closed",
        })}
      />,
    );
    fireEvent.click(header());

    expect(screen.getAllByText("Tab 7 was closed")).toHaveLength(1);
    expect(screen.queryByText("Result")).toBeNull();
  });

  it("shows a text result as it is, not as JSON", () => {
    render(<DefaultToolDisplay tool={tool({ output: "plain answer" })} />);
    fireEvent.click(header());

    const result = screen.getByText("Result").closest("div")?.parentElement;
    expect(
      within(result as HTMLElement).getByText("plain answer").tagName,
    ).toBe("PRE");
  });
});
