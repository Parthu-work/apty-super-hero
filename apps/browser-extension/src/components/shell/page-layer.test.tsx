import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { navigationStore } from "../../state/navigation-store";
import { PageLayer } from "./page-layer";

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((n) => n + 1)}>
      clicked {count}
    </button>
  );
}

function Panel() {
  return (
    <div>
      <main data-testid="chat">chat</main>
      <form data-testid="composer">composer</form>
      <PageLayer
        pages={[
          { id: "dom-health", label: "DOM health", content: <Counter /> },
          { id: "dom-config", label: "DOM config", content: <p>config</p> },
        ]}
      />
    </div>
  );
}

beforeEach(() => {
  act(() => navigationStore.back());
});

describe("PageLayer", () => {
  it("makes the chat under an open page inert and hidden from screen readers", () => {
    render(<Panel />);
    const chat = screen.getByTestId("chat");
    expect(chat.inert).toBe(false);

    act(() => navigationStore.openPage("dom-health"));
    expect(chat.inert).toBe(true);
    expect(chat).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("composer").inert).toBe(true);

    act(() => navigationStore.back());
    expect(chat.inert).toBe(false);
    expect(chat).not.toHaveAttribute("aria-hidden");
  });

  it("shows only the open page; the others stay mounted, hidden and inert", () => {
    render(<Panel />);
    act(() => navigationStore.openPage("dom-config"));
    const health = screen.getByLabelText("DOM health", { selector: "section" });
    const config = screen.getByLabelText("DOM config", { selector: "section" });
    expect(config).toBeVisible();
    expect(health).not.toBeVisible();
    expect(health).toHaveAttribute("inert");
  });

  it("keeps a page's state when it is left and reopened", () => {
    render(<Panel />);
    act(() => navigationStore.openPage("dom-health"));
    act(() => screen.getByRole("button", { name: "clicked 0" }).click());
    act(() => navigationStore.back());
    act(() => navigationStore.openPage("dom-health"));
    expect(screen.getByRole("button", { name: "clicked 1" })).toBeVisible();
  });
});
