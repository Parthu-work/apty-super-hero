import type { KbImportResult, KbPackInfo } from "@apty/agent-core";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeBaseCard } from "./knowledge-base-card";
import type { KnowledgeBaseAdapter } from "./types";

const INFO: KbPackInfo = {
  aptyVersion: "5.x",
  site: "fixture.atlassian.net",
  space: "FX",
  label: "rag-card",
  cardCount: 12,
  stubCount: 0,
  chunkCount: 48,
  builtAt: "2026-03-01T00:00:00.000Z",
  importedAt: "2026-03-02T09:00:00.000Z",
  mode: "bm25",
  calibrated: false,
  sha256: "a".repeat(64),
};
const NOW = () => new Date("2026-03-10T00:00:00.000Z");

/** An adapter over an in-memory list of packs, one per version, as the store keeps them. */
function adapter(
  loaded: KbPackInfo | KbPackInfo[] | null,
  importResult?: KbImportResult,
): KnowledgeBaseAdapter & {
  importPack: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  let packs = loaded === null ? [] : Array.isArray(loaded) ? loaded : [loaded];
  return {
    info: vi.fn(async () => packs),
    importPack: vi.fn(async (): Promise<KbImportResult> => {
      const result = importResult ?? { ok: true, info: INFO };
      if (result.ok) {
        packs = [
          ...packs.filter((p) => p.aptyVersion !== result.info.aptyVersion),
          result.info,
        ];
      }
      return result;
    }),
    remove: vi.fn(async (version: string) => {
      packs = packs.filter((p) => p.aptyVersion !== version);
    }),
  };
}

function pick(name: string, body = "{}", size?: number) {
  const file = new File([body], name, { type: "application/json" });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  fireEvent.change(screen.getByTestId("knowledge-base-file"), {
    target: { files: [file] },
  });
}

describe("KnowledgeBaseCard", () => {
  it("says nothing is loaded and imports the picked file", async () => {
    const kb = adapter(null);
    render(<KnowledgeBaseCard adapter={kb} now={NOW} />);
    expect(
      await screen.findByText(/No knowledge base loaded/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();

    pick("apty-kb-FX-20260301.kbpack.json", '{"FIXTURE":true}');
    expect(
      await screen.findByText("Imported 12 cards for Apty 5.x from space FX."),
    ).toBeInTheDocument();
    expect(kb.importPack).toHaveBeenCalledWith('{"FIXTURE":true}');
    const details = await screen.findByRole("region", {
      name: "Loaded knowledge base (5.x)",
    });
    expect(
      within(details).getByText("FX · fixture.atlassian.net"),
    ).toBeInTheDocument();
    expect(within(details).getByText("12")).toBeInTheDocument();
    expect(
      within(details).getByRole("button", { name: "Replace 5.x pack…" }),
    ).toBeInTheDocument();
  });

  it("shows the loaded pack's space, cards, dates and retrieval mode", async () => {
    render(
      <KnowledgeBaseCard
        adapter={adapter({ ...INFO, mode: "hybrid", calibrated: true })}
        now={NOW}
      />,
    );
    const list = await screen.findByRole("region", {
      name: "Loaded knowledge base (5.x)",
    });
    expect(within(list).getByText("2026-03-01")).toBeInTheDocument();
    expect(within(list).getByText("2026-03-02")).toBeInTheDocument();
    expect(
      within(list).getByText("Keyword and vectors · calibrated"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/days ago/)).toBeNull();
  });

  it("counts the cards whose text is not written yet", async () => {
    render(
      <KnowledgeBaseCard
        adapter={adapter({ ...INFO, stubCount: 3 })}
        now={NOW}
      />,
    );
    const list = await screen.findByRole("region", {
      name: "Loaded knowledge base (5.x)",
    });
    expect(within(list).getByText("12, 3 not yet written")).toBeInTheDocument();
  });

  it("warns when the pack is older than 30 days", async () => {
    render(
      <KnowledgeBaseCard
        adapter={adapter(INFO)}
        now={() => new Date("2026-04-15T00:00:00.000Z")}
      />,
    );
    expect(await screen.findByText(/built 45 days ago/)).toBeInTheDocument();
  });

  it("names why a file was refused and keeps what was loaded", async () => {
    const kb = adapter(INFO, { ok: false, code: "checksum_mismatch" });
    render(<KnowledgeBaseCard adapter={kb} now={NOW} />);
    await screen.findByText("FX · fixture.atlassian.net");
    pick("pack.json");
    expect(
      await screen.findByText(/checksum does not match its contents/),
    ).toBeInTheDocument();
    expect(screen.getByText("FX · fixture.atlassian.net")).toBeInTheDocument();
  });

  it("refuses a file over 25 MB without reading it", async () => {
    const kb = adapter(null);
    render(<KnowledgeBaseCard adapter={kb} now={NOW} />);
    await screen.findByText(/No knowledge base loaded/);
    pick("big.json", "{}", 26 * 1024 * 1024);
    expect(
      await screen.findByText(/too large for a KB pack/),
    ).toBeInTheDocument();
    expect(kb.importPack).not.toHaveBeenCalled();
  });

  it("removes the pack only after confirmation", async () => {
    const kb = adapter(INFO);
    render(<KnowledgeBaseCard adapter={kb} now={NOW} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove 5.x pack" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("Remove the 5.x knowledge base?"),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(kb.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove 5.x pack" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Remove",
      }),
    );
    await waitFor(() => expect(kb.remove).toHaveBeenCalledWith("5.x"));
    expect(
      await screen.findByText("The 5.x knowledge base was removed."),
    ).toBeInTheDocument();
    expect(screen.getByText(/No knowledge base loaded/)).toBeInTheDocument();
  });

  it("lists a 4.x and a 5.x pack side by side, and removing 4.x leaves 5.x", async () => {
    const four: KbPackInfo = {
      ...INFO,
      aptyVersion: "4.x",
      space: "A4PKH",
      stubCount: 23,
    };
    const kb = adapter([four, INFO]);
    render(<KnowledgeBaseCard adapter={kb} now={NOW} />);
    const fourRow = await screen.findByRole("region", {
      name: "Loaded knowledge base (4.x)",
    });
    expect(
      within(fourRow).getByText("A4PKH · fixture.atlassian.net"),
    ).toBeInTheDocument();
    expect(
      within(fourRow).getByText("12, 23 not yet written"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Loaded knowledge base (5.x)" }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(fourRow).getByRole("button", { name: "Remove 4.x pack" }),
    );
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Remove",
      }),
    );
    await waitFor(() => expect(kb.remove).toHaveBeenCalledWith("4.x"));
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Loaded knowledge base (4.x)" }),
      ).toBeNull(),
    );
    expect(
      screen.getByRole("region", { name: "Loaded knowledge base (5.x)" }),
    ).toBeInTheDocument();
  });
});

describe("KnowledgeBaseCard: who signed each pack and whether it is used (KB-RAG K23 P5)", () => {
  const trusted = {
    status: "trusted" as const,
    keyId: "0123456789abcdef",
    name: "Apty KB owner",
    demo: false,
  };
  const withState = (
    usability: NonNullable<Parameters<typeof Object>[0]>,
    extra: Partial<KbPackInfo> = {},
  ) =>
    ({
      ...INFO,
      expiresAt: "2026-05-01T00:00:00.000Z",
      ...extra,
      usability,
    }) as KbPackInfo;

  it.each([
    [
      {
        trust: trusted,
        validity: {
          state: "current",
          date: "2026-05-01T00:00:00.000Z",
          daysLeft: 52,
        },
        usable: true,
      },
      "Signed by Apty KB owner (key 0123456789abcdef)",
      "Current",
      false,
    ],
    [
      {
        trust: trusted,
        validity: {
          state: "expiring",
          date: "2026-03-15T00:00:00.000Z",
          daysLeft: 5,
        },
        usable: true,
      },
      "Signed by Apty KB owner (key 0123456789abcdef)",
      "Expires in 5 days",
      false,
    ],
    [
      {
        trust: trusted,
        validity: { state: "expired", date: "2026-03-01T00:00:00.000Z" },
        usable: false,
        reason: "expired",
      },
      "Signed by Apty KB owner (key 0123456789abcdef)",
      "Expired on 2026-03-01",
      true,
    ],
    [
      {
        trust: { status: "unsigned" },
        validity: { state: "current", date: null },
        usable: false,
        reason: "unsigned",
      },
      "Not signed",
      "Not signed",
      true,
    ],
    [
      {
        trust: { status: "revoked_key", keyId: "fedcba9876543210" },
        validity: { state: "current", date: null },
        usable: false,
        reason: "revoked",
      },
      "Signed by key fedcba9876543210, which this extension does not trust",
      "Signed by a revoked key",
      true,
    ],
  ])("shows the signer, expiry and state (%#)", async (usability, signer, state, notUsed) => {
    render(
      <KnowledgeBaseCard adapter={adapter(withState(usability))} now={NOW} />,
    );
    const row = await screen.findByRole("region", {
      name: "Loaded knowledge base (5.x)",
    });
    expect(within(row).getAllByText(signer)[0]).toBeInTheDocument();
    expect(within(row).getByTestId("kb-pack-state")).toHaveTextContent(state);
    expect(within(row).getByText("2026-05-01")).toBeInTheDocument();
    expect(
      within(row).queryByText(
        "This pack is not used. Ask the KB owner for a new pack.",
      ) !== null,
    ).toBe(notUsed);
  });

  it.each([
    [
      { ok: false, code: "untrusted_key" },
      "This pack is not signed by a key this extension trusts.",
    ],
    [
      { ok: false, code: "unsigned" },
      "This pack is not signed by a key this extension trusts.",
    ],
    [
      { ok: false, code: "bad_signature" },
      "This pack's signature does not match its content.",
    ],
    [
      { ok: false, code: "revoked_key" },
      "This pack is signed by a key your organization revoked.",
    ],
    [
      { ok: false, code: "expired", date: "2026-03-01T00:00:00.000Z" },
      "This pack expired on 2026-03-01.",
    ],
  ] as const)("names a refused import in plain words: %j", async (result, message) => {
    render(<KnowledgeBaseCard adapter={adapter(null, result)} now={NOW} />);
    pick("pack.kbpack.json");
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});

describe("KnowledgeBaseCard: cards not in this version (KB-RAG K25, A4)", () => {
  it('shows "N not in this version" on the pack row', async () => {
    render(
      <KnowledgeBaseCard
        adapter={adapter({ ...INFO, absentCount: 5 } as KbPackInfo)}
        now={NOW}
      />,
    );
    expect(
      await screen.findByText(/5 not in this version/),
    ).toBeInTheDocument();
  });
});
