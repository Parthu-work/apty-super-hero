import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolScreenshot } from "./tool";

describe("ToolScreenshot", () => {
  it("never loads a remote URL passed as the screenshot", () => {
    const { container } = render(
      <ToolScreenshot screenshot="https://evil.test/x.png?d=SECRET" />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("evil.test");
  });

  it("renders a data: screenshot", () => {
    const url = "data:image/png;base64,AAAA";
    const { container } = render(<ToolScreenshot screenshot={url} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(url);
  });
});
