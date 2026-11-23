import type { UIToolPart } from "@apty/ui/types";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const localKbMatches = vi.hoisted(() => vi.fn());
const site = vi.hoisted(() => ({ host: undefined as string | undefined }));
vi.mock("./kb-version-control", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useActiveSiteHost: () => site.host,
}));
vi.mock("@apty/browser-runtime/kb/kb-matches", () => ({
  localKbMatches,
  kbAnswerOf: (outcome: { kind: string; result?: unknown }) =>
    outcome.kind === "answer" ? outcome.result : undefined,
}));

import {
  forgetKbVersions,
  kbVersionForHost,
} from "@apty/browser-runtime/kb/kb-version";
import { AptyToolDisplay } from "./apty-tool-display";
import { KbVersionChip } from "./kb-version-chip";

beforeEach(() => {
  localKbMatches.mockReset();
  forgetKbVersions();
  site.host = undefined;
});

function tool(output: unknown): UIToolPart {
  return {
    type: "tool",
    toolName: "search_kb",
    toolCallId: "call-1",
    input: { query: "the tooltip opens twice", topK: 3 },
    output,
    state: "completed",
  };
}

const hit = (
  pageId: string,
  layer: number,
  text: string,
  notVerified = false,
  aptyVersion = "5.x",
) => ({
  cite: `kb://${pageId}#L${layer}`,
  title: `FIXTURE card ${pageId}`,
  site: "fixture.atlassian.net",
  space: aptyVersion === "4.x" ? "A4X" : "JX",
  aptyVersion,
  layer,
  heading: `Layer ${layer}: FIXTURE`,
  verifiedOn: "Verified on: FIXTURE code, 2026-01-01.",
  notVerified,
  score: 2,
  text,
});

const threeCards = () =>
  tool({
    status: "ok",
    results: [
      hit("601", 1, "- FIXTURE first step.\n- FIXTURE second step."),
      hit("602", 2, "- FIXTURE console step."),
      hit("603", 1, "- FIXTURE other step."),
    ],
  });

/** The elements Tab reaches, in order. */
function tabStops(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>("a[href], button, input, select"),
  ].filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled);
}

describe("one best card, the others folded (KB-RAG K29, D1)", () => {
  it("shows one open card and one fold line for a three-card answer", () => {
    render(<AptyToolDisplay tool={threeCards()} />);
    const card = screen.getByRole("region", { name: "KB cards that match" });
    expect(within(card).getAllByRole("article")).toHaveLength(1);
    expect(
      within(within(card).getByRole("article")).getByRole("link", {
        name: /FIXTURE card 601/,
      }),
    ).toBeInTheDocument();
    const fold = within(card).getByRole("button", {
      name: "2 other possible cards",
    });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(within(card).queryByText(/FIXTURE card 602/)).toBeNull();
  });

  it("reaches every card in one click and opens a folded card in place of the first", () => {
    render(<AptyToolDisplay tool={threeCards()} />);
    const card = screen.getByRole("region", { name: "KB cards that match" });
    fireEvent.click(
      within(card).getByRole("button", { name: "2 other possible cards" }),
    );
    const lines = within(card).getByRole("list", {
      name: "2 other possible cards",
    });
    expect(
      within(lines)
        .getAllByRole("button")
        .map((line) => line.textContent),
    ).toEqual(["FIXTURE card 6025.x", "FIXTURE card 6035.x"]);
    fireEvent.click(
      within(lines).getByRole("button", { name: "FIXTURE card 602, 5.x" }),
    );
    const open = within(card).getByRole("article");
    expect(
      within(open).getByRole("link", { name: /FIXTURE card 602/ }),
    ).toBeInTheDocument();
    expect(within(open).getByText("FIXTURE console step.")).toBeInTheDocument();
    fireEvent.click(
      within(card).getByRole("button", { name: "2 other possible cards" }),
    );
    expect(
      within(card)
        .getAllByRole("button", { name: /^FIXTURE card 60[13], 5\.x$/ })
        .map((line) => line.textContent),
    ).toEqual(["FIXTURE card 6015.x", "FIXTURE card 6035.x"]);
  });

  it("takes the open card first, then the fold, then the actions, by keyboard", () => {
    render(<AptyToolDisplay tool={threeCards()} />);
    const card = screen.getByRole("region", { name: "KB cards that match" });
    const stops = tabStops(card);
    const at = (el: HTMLElement) => stops.indexOf(el);
    const open = within(card).getByRole("article");
    const link = within(open).getByRole("link", { name: /FIXTURE card 601/ });
    const tab = within(open).getByRole("tab", { name: "Settings" });
    const next = within(open).getByRole("button", { name: "Next: Console" });
    const fold = within(card).getByRole("button", {
      name: "2 other possible cards",
    });
    const helped = within(card).getByRole("button", { name: /^Helpful/ });
    const wrong = within(card).getByRole("button", { name: /^Wrong card/ });
    expect(at(link)).toBe(0);
    expect(at(tab)).toBe(1);
    expect(at(next)).toBeGreaterThan(at(tab));
    expect(at(fold)).toBeGreaterThan(at(next));
    expect(at(helped)).toBeGreaterThan(at(fold));
    expect(at(wrong)).toBeGreaterThan(at(helped));
  });
});

describe("a named file of the other version (KB-RAG K29, B3)", () => {
  it("says what the site's version calls the file, above the cards", () => {
    render(
      <AptyToolDisplay
        tool={tool({
          status: "ok",
          results: [
            hit("4401", 3, "- FIXTURE flow file.", false, "4.x"),
            hit("5501", 3, "- FIXTURE workflow file.", false, "5.x"),
          ],
          fileVersion: {
            file: "flow.json",
            version: "4.x",
            siteVersion: "5.x",
            counterpart: "workflow.json",
            kind: "workflows",
          },
        })}
      />,
    );
    expect(screen.getByTestId("kb-file-version")).toHaveTextContent(
      "flow.json is a 4.x file. On Apty 5.x the workflow list is workflow.json.",
    );
  });

  it("shows no line without one", () => {
    render(
      <AptyToolDisplay
        tool={tool({
          status: "ok",
          results: [hit("4401", 3, "- FIXTURE flow file.", false, "4.x")],
        })}
      />,
    );
    expect(screen.queryByTestId("kb-file-version")).toBeNull();
  });
});

describe("KbMatchesCard", () => {
  it("labels the open card and each folded card with its version (K12)", () => {
    render(
      <AptyToolDisplay
        tool={tool({
          status: "ok",
          mixedVersions: true,
          results: [
            hit("401", 1, "- FIXTURE 4.x setting.", false, "4.x"),
            hit("501", 1, "- FIXTURE 5.x setting.", false, "5.x"),
          ],
        })}
      />,
    );
    const card = screen.getByRole("region", { name: "KB cards that match" });
    const open = within(card).getByRole("article");
    expect(within(open).getByText("4.x")).toBeInTheDocument();
    expect(
      within(open).getByRole("link", { name: /FIXTURE card 401/ }),
    ).toHaveAttribute(
      "href",
      "https://fixture.atlassian.net/wiki/spaces/A4X/pages/401",
    );
    fireEvent.click(
      within(card).getByRole("button", { name: "1 other possible card" }),
    );
    expect(
      within(card).getByRole("button", { name: "FIXTURE card 501, 5.x" }),
    ).toBeInTheDocument();
  });

  it("searches again when the version the SE picks has no card in this answer", async () => {
    site.host = "acc.tenant.example";
    localKbMatches.mockResolvedValue({
      kind: "answer",
      packs: [],
      result: {
        status: "ok",
        mixedVersions: false,
        results: [hit("401", 1, "- FIXTURE 4.x setting.", false, "4.x")],
      },
    });
    render(
      <>
        <KbVersionChip host="acc.tenant.example" />
        <AptyToolDisplay
          tool={tool({
            status: "ok",
            results: [hit("501", 1, "- FIXTURE 5.x setting.", false, "5.x")],
          })}
        />
      </>,
    );
    // K29, D3: the header's version chip changes the version at any time.
    fireEvent.keyDown(screen.getByTestId("kb-version-chip"), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "4.x" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: /FIXTURE card 501/ }),
      ).toBeNull(),
    );
    screen.getByRole("link", { name: /FIXTURE card 401/ });
    expect(localKbMatches).toHaveBeenCalledWith(
      "the tooltip opens twice",
      undefined,
      { version: "4.x", modelAvailable: true },
    );
    expect(screen.queryByText(/different Apty versions/)).toBeNull();
  });

  it("tells the user the cards are in English when the question is not", () => {
    render(
      <AptyToolDisplay tool={tool({ status: "non_english", results: [] })} />,
    );
    expect(
      screen.getByText(
        "The KB cards are in English. Ask in English, or send the question to the model.",
      ),
    ).toBeInTheDocument();
  });

  it("says the KB has a card whose text is not written yet, with its link", () => {
    render(
      <AptyToolDisplay
        tool={tool({
          status: "stub",
          stub: {
            cite: "kb://303",
            title: "FIXTURE gadget export never finishes",
            site: "fixture.atlassian.net",
            space: "A4X",
            aptyVersion: "4.x",
          },
          results: [],
        })}
      />,
    );
    const card = screen.getByRole("region", { name: "KB cards that match" });
    expect(
      within(card).getByText(
        "The KB has a card for this, but its 4.x text is not written yet.",
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: /FIXTURE gadget export/ }),
    ).toHaveAttribute(
      "href",
      "https://fixture.atlassian.net/wiki/spaces/A4X/pages/303",
    );
  });

  it("opens the best card at its layer as numbered steps, with its link, Verified on line and Not verified badge", () => {
    render(
      <AptyToolDisplay
        tool={tool({
          status: "ok",
          results: [
            hit(
              "202",
              1,
              "- In Studio, clear the FIXTURE Double Trigger setting.\n- Publish.",
            ),
            hit("101", 3, "- NOT VERIFIED: FIXTURE glow.json.", true),
          ],
        })}
      />,
    );
    const card = screen.getByRole("region", { name: "KB cards that match" });
    const open = within(card).getByRole("article");
    expect(
      within(open).getByRole("link", { name: /FIXTURE card 202/ }),
    ).toHaveAttribute(
      "href",
      "https://fixture.atlassian.net/wiki/spaces/JX/pages/202",
    );
    expect(within(open).getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      within(within(open).getByTestId("kb-layer-text"))
        .getAllByRole("listitem")
        .map((step) => step.textContent),
    ).toEqual([
      "In Studio, clear the FIXTURE Double Trigger setting.",
      "Publish.",
    ]);
    expect(within(open).queryByText("Not verified")).toBeNull();
    fireEvent.click(
      within(card).getByRole("button", { name: "1 other possible card" }),
    );
    fireEvent.click(
      within(card).getByRole("button", { name: "FIXTURE card 101, 5.x" }),
    );
    const next = within(card).getByRole("article");
    expect(
      within(next).getByRole("link", { name: /FIXTURE card 101/ }),
    ).toBeInTheDocument();
    expect(within(next).getByRole("tab", { name: "Network" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(next).getByText("Not verified")).toBeInTheDocument();
  });

  it("keeps the default display for not covered, no pack, or anything malformed", () => {
    for (const output of [
      { status: "not_covered", results: [] },
      { status: "no_pack", results: [] },
      {
        status: "ok",
        results: [{ ...hit("1", 1, "x"), cite: "https://x.test" }],
      },
    ]) {
      const { unmount } = render(<AptyToolDisplay tool={tool(output)} />);
      expect(
        screen.queryByRole("region", { name: "KB cards that match" }),
      ).toBeNull();
      unmount();
    }
  });
});

describe("KB matches card for a pack that is not used (KB-RAG K23 P5)", () => {
  it("shows one line with the reason and the date, and no card", () => {
    render(
      <AptyToolDisplay
        tool={tool({
          status: "pack_unusable",
          unusable: {
            reason: "expired",
            aptyVersion: "4.x",
            date: "2027-01-10T00:00:00.000Z",
          },
          results: [],
        })}
      />,
    );
    expect(screen.getByTestId("kb-pack-unusable")).toHaveTextContent(
      "The 4.x pack expired on 2027-01-10. Ask the KB owner for a new one.",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("KB matches card for a feature not in this version (KB-RAG K25, A4)", () => {
  it("says it does not exist in that version, with the reason and the card's link, and no other card", () => {
    render(
      <AptyToolDisplay
        tool={tool({
          status: "not_in_version",
          absent: {
            cite: "kb://909",
            title: "FIXTURE drop-off funnel chart",
            site: "fixture.atlassian.invalid",
            space: "FX",
            aptyVersion: "4.x",
            absentReason: "FIXTURE: the funnel chart arrived with 5.x.",
          },
          results: [],
        })}
      />,
    );
    const block = screen.getByTestId("kb-not-in-version");
    expect(block).toHaveTextContent("This does not exist in Apty 4.x.");
    expect(block).toHaveTextContent(
      "FIXTURE: the funnel chart arrived with 5.x.",
    );
    expect(
      screen.getByRole("link", { name: /FIXTURE drop-off funnel chart/ }),
    ).toHaveAttribute(
      "href",
      "https://fixture.atlassian.invalid/wiki/spaces/FX/pages/909",
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});

describe("a setting no KB card has (K27, F2)", () => {
  const unknownSetting = {
    status: "not_covered",
    source: "kb",
    cards: [],
    reason: "unknown_setting",
    missingPhrases: ["FIXTURE Glow Pulse Switch"],
    closest: [
      {
        cite: "kb://202",
        title: "FIXTURE tooltip opens twice",
        site: "fixture.atlassian.net",
        space: "JX",
        aptyVersion: "5.x",
      },
    ],
    results: [],
  };

  it("names the missing setting, lists the closest cards as such and says where to look", () => {
    render(<AptyToolDisplay tool={tool(unknownSetting)} />);
    const card = screen.getByTestId("kb-unknown-setting");
    expect(
      within(card).getByText(
        'The KB has no setting called "FIXTURE Glow Pulse Switch".',
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByText("Closest cards, they may not mention it:"),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: /FIXTURE tooltip opens twice/ }),
    ).toHaveAttribute(
      "href",
      "https://fixture.atlassian.net/wiki/spaces/JX/pages/202",
    );
    expect(
      within(card).getByText("Check Studio or Admin, or ask the KB owner."),
    ).toBeInTheDocument();
    expect(
      within(card).queryByRole("button", { name: "Ask the AI anyway" }),
    ).toBeNull();
  });

  it("Ask the AI anyway sends the question past the KB with the fixed instruction and the KB's outcome as a fact (K29, B6)", async () => {
    const { ChatContext } = await import("@apty/ui/components/chatbot");
    const { KB_NO_CARD_INSTRUCTION } = await import("@apty/agent-core");
    const sendMessage = vi.fn(async () => {});
    render(
      <ChatContext.Provider value={{ status: "idle", sendMessage } as never}>
        <AptyToolDisplay tool={tool(unknownSetting)} />
      </ChatContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask the AI anyway" }));
    expect(sendMessage).toHaveBeenCalledWith(
      "the tooltip opens twice",
      undefined,
      undefined,
      {
        skipLocalResponder: true,
        turnInstruction: expect.stringContaining(
          KB_NO_CARD_INSTRUCTION.split(" Say you do not know")[0] ?? "",
        ),
        followsKb: {
          kind: "unknown_setting",
          phrases: ["FIXTURE Glow Pulse Switch"],
        },
      },
    );
    const [, , , options] = sendMessage.mock.calls[0] as unknown as [
      string,
      undefined,
      undefined,
      { turnInstruction: string },
    ];
    expect(options.turnInstruction).toContain(
      "The Apty KB has no setting named 'FIXTURE Glow Pulse Switch'.",
    );
    expect(options.turnInstruction).toContain(
      "Do not say where a setting with that name might be.",
    );
  });
});

describe("one source line, one action row (KB-RAG K29, D2)", () => {
  const decision = {
    route: "kb" as const,
    version: "5.x" as const,
    versionSource: "user" as const,
    packs: [
      {
        version: "5.x" as const,
        sha256: "0123456789ab",
        expiresAt: new Date(Date.now() + 55.5 * 86_400_000).toISOString(),
      },
    ],
    kb: { kind: "answer" as const, status: "ok", pageIds: ["601"] },
  };

  async function renderAnswer() {
    const { ChatContext, TurnContext } = await import(
      "@apty/ui/components/chatbot"
    );
    render(
      <ChatContext.Provider
        value={
          { status: "idle", sessionId: "s-1", sendMessage: vi.fn() } as never
        }
      >
        <TurnContext.Provider value={{ decision, message: {} as never }}>
          <AptyToolDisplay tool={threeCards()} />
        </TurnContext.Provider>
      </ChatContext.Provider>,
    );
    return screen.getByRole("region", { name: "KB cards that match" });
  }

  const openMenu = (card: HTMLElement) => {
    fireEvent.keyDown(
      within(card).getByRole("button", {
        name: "More actions for this answer",
      }),
      { key: "Enter" },
    );
    return screen.getByRole("menu");
  };

  it("replaces the chips and boilerplate with one source line whose (i) holds the rest and the pack's expiry", async () => {
    const card = await renderAnswer();
    expect(within(card).getByTestId("kb-source-line")).toHaveTextContent(
      "From the KB · 5.x · verified on FIXTURE code, 2026-01-01",
    );
    expect(within(card).queryByTestId("kb-egress-note")).toBeNull();
    expect(
      within(card).queryByText(/From the KB pack loaded in Options/),
    ).toBeNull();
    const info = within(card).getByRole("button", {
      name: "About this source",
    });
    expect(info).toHaveAccessibleDescription(
      "Each title opens its card in Confluence. Shown here only; not sent to the AI model. Pack expires in 56 days",
    );
    fireEvent.click(info);
    expect(info).toHaveAttribute("aria-expanded", "true");
    expect(
      within(card).getByText("Each title opens its card in Confluence."),
    ).toBeVisible();
  });

  it("shows at most 8 controls before anything is opened: Helpful, Wrong card and ⋯ in one row", async () => {
    const card = await renderAnswer();
    expect(tabStops(card).length).toBeLessThanOrEqual(8);
    const row = within(card).getByTestId("kb-action-row");
    expect(
      within(row)
        .getAllByRole("button")
        .map(
          (button) => button.textContent || button.getAttribute("aria-label"),
        ),
    ).toEqual(["Helpful", "Wrong card", "More actions for this answer"]);
  });

  it("keeps every action it moved out of view one click away, in the ⋯ menu", async () => {
    const card = await renderAnswer();
    const menu = openMenu(card);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Copy answer",
      "Why this answer",
      "Prepare support bundle",
      "Open in Confluence",
    ]);
    expect(
      within(menu).getByRole("menuitem", { name: "Open in Confluence" }),
    ).toHaveAttribute(
      "href",
      "https://fixture.atlassian.net/wiki/spaces/JX/pages/601",
    );
  });

  it("opens Why this answer as a small panel with its own Copy", async () => {
    const card = await renderAnswer();
    fireEvent.click(
      within(openMenu(card)).getByRole("menuitem", {
        name: "Why this answer",
      }),
    );
    const panel = await screen.findByRole("region", {
      name: "Why this answer",
    });
    expect(panel).toHaveTextContent("Answered by: the KB cards");
    expect(
      within(panel).getByRole("button", { name: "Copy why this answer" }),
    ).toBeInTheDocument();
  });

  it("copies the open card's steps, link and record with Copy answer", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const card = await renderAnswer();
    fireEvent.click(
      within(openMenu(card)).getByRole("menuitem", { name: "Copy answer" }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = String((writeText.mock.calls as unknown[][])[0]?.[0]);
    expect(text).toContain("FIXTURE card 601 (5.x)");
    expect(text).toContain("1. FIXTURE first step.\n2. FIXTURE second step.");
    expect(text).toContain(
      "https://fixture.atlassian.net/wiki/spaces/JX/pages/601",
    );
    expect(text).toContain("Why this answer\n- ");
  });
});

describe("nothing the SE could need is removed, only moved (KB-RAG K29, hard rule 3)", () => {
  beforeEach(() => {
    site.host = "acc.tenant.example";
  });

  it("finds every line, badge and action the answer showed before in the open card, its source line, its (i) or its ⋯ menu", async () => {
    const { ChatContext, TurnContext } = await import(
      "@apty/ui/components/chatbot"
    );
    render(
      <ChatContext.Provider
        value={
          { status: "idle", sessionId: "s-1", sendMessage: vi.fn() } as never
        }
      >
        <TurnContext.Provider
          value={{
            decision: {
              route: "kb",
              version: "5.x",
              versionSource: "user",
              packs: [
                {
                  version: "5.x",
                  sha256: "0123456789ab",
                  expiresAt: new Date(
                    Date.now() + 9.5 * 86_400_000,
                  ).toISOString(),
                },
              ],
              kb: { kind: "answer", status: "ok", pageIds: ["601"] },
            },
            message: {} as never,
          }}
        >
          <KbVersionChip host="acc.tenant.example" />
          <AptyToolDisplay tool={threeCards()} />
        </TurnContext.Provider>
      </ChatContext.Provider>,
    );
    const card = screen.getByRole("region", { name: "KB cards that match" });
    const moved: Array<[string, () => HTMLElement]> = [
      [
        "the card's title link",
        () => within(card).getByRole("link", { name: /FIXTURE card 601/ }),
      ],
      ["its version badge", () => within(card).getByText("5.x")],
      [
        "the layer label (L1)",
        () => within(card).getByRole("tab", { name: "Settings" }),
      ],
      ["Next", () => within(card).getByRole("button", { name: /^Next:/ })],
      ["the KB card chip", () => within(card).getByText(/^From the KB/)],
      [
        "the Verified on line",
        () => within(card).getByText(/verified on FIXTURE code/),
      ],
      [
        "This helped",
        () => within(card).getByRole("button", { name: /^Helpful/ }),
      ],
      [
        "Wrong card",
        () => within(card).getByRole("button", { name: /^Wrong card/ }),
      ],
    ];
    for (const [what, find] of moved) {
      expect(find, what).not.toThrow();
    }
    fireEvent.click(
      within(card).getByRole("button", { name: "About this source" }),
    );
    for (const line of [
      "Each title opens its card in Confluence.",
      "Shown here only; not sent to the AI model.",
      "Pack expires in 10 days",
    ]) {
      expect(within(card).getByText(line)).toBeVisible();
    }
    fireEvent.keyDown(
      within(card).getByRole("button", {
        name: "More actions for this answer",
      }),
      { key: "Enter" },
    );
    const menu = screen.getByRole("menu");
    for (const action of [
      "Copy answer",
      "Why this answer",
      "Prepare support bundle",
      "Open in Confluence",
    ]) {
      expect(
        within(menu).getByRole("menuitem", { name: action }),
      ).toBeInTheDocument();
    }
    fireEvent.keyDown(menu, { key: "Escape" });
    // K29, D3: the version picker moved to the header's version chip.
    fireEvent.keyDown(screen.getByTestId("kb-version-chip"), { key: "Enter" });
    for (const version of ["4.x", "5.x", "Not sure"]) {
      expect(
        screen.getByRole("menuitemradio", { name: version }),
      ).toBeInTheDocument();
    }
  });
});

describe("ask the version once per site (KB-RAG K29, D3)", () => {
  const mixed = () =>
    tool({
      status: "ok",
      mixedVersions: true,
      results: [
        hit("401", 1, "- FIXTURE 4.x setting.", false, "4.x"),
        hit("501", 1, "- FIXTURE 5.x setting.", false, "5.x"),
        hit("402", 2, "- FIXTURE 4.x console.", false, "4.x"),
        hit("502", 2, "- FIXTURE 5.x console.", false, "5.x"),
      ],
    });
  const question = () =>
    screen.queryByRole("group", {
      name: "Which Apty version does acc.tenant.example run?",
    });

  beforeEach(() => {
    site.host = "acc.tenant.example";
  });

  it("asks above an answer with cards of both versions; 5.x hides the 4.x cards in it and in the next answer", () => {
    const first = render(<AptyToolDisplay tool={mixed()} />);
    const ask = question();
    expect(ask).not.toBeNull();
    expect(
      within(ask as HTMLElement)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["4.x", "5.x", "Not sure"]);
    expect(screen.queryByText(/different Apty versions/)).toBeNull();
    fireEvent.click(
      within(ask as HTMLElement).getByRole("button", { name: "5.x" }),
    );
    expect(kbVersionForHost("acc.tenant.example")).toBe("5.x");
    expect(question()).toBeNull();
    const card = screen.getByRole("region", { name: "KB cards that match" });
    expect(
      within(within(card).getByRole("article")).getByRole("link", {
        name: /FIXTURE card 501/,
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(card).getByRole("button", { name: "1 other possible card" }),
    );
    expect(within(card).queryByText(/FIXTURE card 40[12]/)).toBeNull();
    first.unmount();

    render(<AptyToolDisplay tool={mixed()} />);
    expect(question()).toBeNull();
    expect(screen.queryByRole("link", { name: /FIXTURE card 401/ })).toBeNull();
  });

  it("keeps both versions for Not sure, grouped under 4.x and 5.x headings in the fold, and does not ask again", () => {
    const first = render(<AptyToolDisplay tool={mixed()} />);
    fireEvent.click(
      within(question() as HTMLElement).getByRole("button", {
        name: "Not sure",
      }),
    );
    expect(question()).toBeNull();
    const card = screen.getByRole("region", { name: "KB cards that match" });
    fireEvent.click(
      within(card).getByRole("button", { name: "3 other possible cards" }),
    );
    const four = within(card).getByRole("list", { name: "4.x" });
    const five = within(card).getByRole("list", { name: "5.x" });
    expect(
      within(four)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["FIXTURE card 402, 4.x"]);
    expect(
      within(five)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["FIXTURE card 501, 5.x", "FIXTURE card 502, 5.x"]);
    expect(within(card).getByRole("heading", { name: "4.x" })).toBeVisible();
    first.unmount();
    render(<AptyToolDisplay tool={mixed()} />);
    expect(question()).toBeNull();
  });

  it("asks nothing for an answer of one version, and has no version picker of its own", () => {
    render(<AptyToolDisplay tool={threeCards()} />);
    expect(question()).toBeNull();
    fireEvent.keyDown(
      screen.getByRole("button", { name: "More actions for this answer" }),
      { key: "Enter" },
    );
    expect(screen.queryByRole("menuitemradio")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("lets the header chip change it back", () => {
    render(
      <>
        <KbVersionChip host="acc.tenant.example" />
        <AptyToolDisplay tool={mixed()} />
      </>,
    );
    fireEvent.click(
      within(question() as HTMLElement).getByRole("button", { name: "5.x" }),
    );
    expect(screen.queryByRole("link", { name: /FIXTURE card 401/ })).toBeNull();
    fireEvent.keyDown(screen.getByTestId("kb-version-chip"), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "4.x" }));
    expect(
      screen.getByRole("link", { name: /FIXTURE card 401/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /FIXTURE card 501/ })).toBeNull();
  });
});
