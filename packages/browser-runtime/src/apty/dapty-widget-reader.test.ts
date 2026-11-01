// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleDaptyWidgetTurnsMessage,
  MAX_DOM_TEXT_CHARS,
  MAX_DOM_TURNS,
  readDaptyWidgetTurns,
} from "./dapty-widget-reader";

const executeScript = vi.fn(
  async (injection: {
    target: { tabId: number; frameIds?: number[] };
    func: (...args: unknown[]) => unknown;
    args?: unknown[];
  }) => [{ result: injection.func(...(injection.args ?? [])) }],
);

const AGENT_ID = "bpiondflhhdplemamgggcdajclmoeple";

function stubScripting() {
  vi.stubGlobal("chrome", {
    runtime: { id: AGENT_ID },
    scripting: { executeScript },
  });
}

const userTurn = (text: string) =>
  `<div class="MuiBox-root"><p class="MuiTypography-root MuiTypography-body2">${text}</p></div>`;

const assistantTurn = (reply: string, suggestions: string[] = []) => `
  <div class="MuiBox-root" data-chat-dialog="show.feedback">
    <div class="markdown"><p>${reply}</p></div>
    ${
      suggestions.length
        ? `<div class="MuiBox-root"><span class="MuiTypography-caption">Sources</span>${suggestions
            .map(
              (name) =>
                `<button class="MuiButtonBase-root MuiButton-root MuiButton-text">${name}</button>`,
            )
            .join("")}</div>`
        : ""
    }
    <button class="MuiButtonBase-root MuiIconButton-root" aria-label="like"></button>
  </div>`;

function mountWidget(chat: string | null, mode: ShadowRootMode = "open") {
  const host = document.createElement("apty-widget");
  document.body.appendChild(host);
  const root = host.attachShadow({ mode });
  root.innerHTML =
    chat === null
      ? `<div class="launcher"><p class="MuiTypography-body2">Need help?</p></div>`
      : `<div class="panel"><div class="scroll">${chat}</div></div>`;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  executeScript.mockClear();
});

describe("readDaptyWidgetTurns", () => {
  it("reads user, assistant and error turns in order, with suggestion names but no HTML", async () => {
    stubScripting();
    mountWidget(
      [
        userTurn("How do I create a vendor?"),
        assistantTurn("Use <b>Create vendor</b>.", [
          "Create vendor",
          "Vendor <i>policy</i>",
        ]),
        `<div role="progressbar"></div>`,
        userTurn("And approve it?"),
        `<div class="MuiBox-root"><p class="MuiTypography-body1" style="color: red">Something went wrong</p></div>`,
      ].join(""),
    );

    const read = await readDaptyWidgetTurns(5);

    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 5, frameIds: [0] } }),
    );
    expect(read).toEqual({
      ok: true,
      turns: [
        {
          role: "user",
          text: "How do I create a vendor?",
          suggestionNames: [],
        },
        {
          role: "assistant",
          text: "Use Create vendor.",
          suggestionNames: ["Create vendor", "Vendor policy"],
        },
        { role: "user", text: "And approve it?", suggestionNames: [] },
        { role: "error", text: "Something went wrong", suggestionNames: [] },
      ],
    });
  });

  it("keeps the last 50 turns and cuts each text at 4,000 characters", async () => {
    stubScripting();
    const turns = Array.from({ length: MAX_DOM_TURNS + 10 }, (_, i) =>
      i % 2 ? assistantTurn(`answer ${i}`) : userTurn(`question ${i}`),
    );
    turns.push(assistantTurn("y".repeat(MAX_DOM_TEXT_CHARS + 100)));
    mountWidget(turns.join(""));

    const read = await readDaptyWidgetTurns(1);

    if (!read.ok) throw new Error(read.reason);
    expect(read.turns).toHaveLength(MAX_DOM_TURNS);
    expect(read.turns[0]?.text).toBe("answer 11");
    expect(read.turns.at(-1)?.text).toHaveLength(MAX_DOM_TEXT_CHARS);
  });

  it("names why it read nothing", async () => {
    stubScripting();
    expect(await readDaptyWidgetTurns(1)).toEqual({
      ok: false,
      reason: "no-widget",
    });

    mountWidget(null);
    expect(await readDaptyWidgetTurns(1)).toEqual({
      ok: false,
      reason: "no-chat-open",
    });

    document.body.innerHTML = "";
    mountWidget(userTurn("hi"), "closed");
    expect(await readDaptyWidgetTurns(1)).toEqual({
      ok: false,
      reason: "not-readable",
    });

    executeScript.mockRejectedValueOnce(new Error("Cannot access chrome://"));
    expect(await readDaptyWidgetTurns(1)).toEqual({
      ok: false,
      reason: "not-readable",
    });

    executeScript.mockResolvedValueOnce([]);
    expect(await readDaptyWidgetTurns(1)).toEqual({
      ok: false,
      reason: "not-readable",
    });
  });
});

describe("handleDaptyWidgetTurnsMessage", () => {
  it("reads the tab for this extension's own pages only", async () => {
    stubScripting();
    mountWidget(userTurn("hi") + assistantTurn("hello"));
    const message = { type: "apty-agent:dapty-widget-turns", tabId: 3 };

    const answer = await new Promise((resolve) => {
      expect(
        handleDaptyWidgetTurnsMessage(
          message,
          { id: AGENT_ID, url: `chrome-extension://${AGENT_ID}/x.html` },
          resolve,
        ),
      ).toBe(true);
    });
    expect(answer).toMatchObject({
      ok: true,
      turns: [{ role: "user" }, { role: "assistant" }],
    });

    const refused = vi.fn();
    expect(
      handleDaptyWidgetTurnsMessage(
        message,
        { id: AGENT_ID, url: "https://page.example/" },
        refused,
      ),
    ).toBe(false);
    expect(refused).toHaveBeenCalledWith(undefined);
    expect(handleDaptyWidgetTurnsMessage({ type: "other" }, {}, refused)).toBe(
      false,
    );
  });
});
