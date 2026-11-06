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
  site: "fixture.atlassian.net",
  space: "FX",
  label: "rag-card",
  cardCount: 12,
  chunkCount: 48,
  builtAt: "2026-03-01T00:00:00.000Z",
  importedAt: "2026-03-02T09:00:00.000Z",
  mode: "bm25",
  calibrated: false,
  sha256: "a".repeat(64),
};
const NOW = () => new Date("2026-03-10T00:00:00.000Z");

function adapter(
  loaded: KbPackInfo | null,
  importResult?: KbImportResult,
): KnowledgeBaseAdapter & {
  importPack: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    info: vi.fn(async () => loaded),
    importPack: vi.fn(
      async (): Promise<KbImportResult> =>
        importResult ?? { ok: true, info: INFO },
    ),
    remove: vi.fn(async () => {}),
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
      await screen.findByText("Imported 12 cards from space FX."),
    ).toBeInTheDocument();
    expect(kb.importPack).toHaveBeenCalledWith('{"FIXTURE":true}');
    const details = screen.getByLabelText("Loaded knowledge base");
    expect(
      within(details).getByText("FX · fixture.atlassian.net"),
    ).toBeInTheDocument();
    expect(within(details).getByText("12")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Replace pack/ }),
    ).toBeInTheDocument();
  });

  it("shows the loaded pack's space, cards, dates and retrieval mode", async () => {
    render(
      <KnowledgeBaseCard
        adapter={adapter({ ...INFO, mode: "hybrid", calibrated: true })}
        now={NOW}
      />,
    );
    const list = await screen.findByLabelText("Loaded knowledge base");
    expect(within(list).getByText("2026-03-01")).toBeInTheDocument();
    expect(within(list).getByText("2026-03-02")).toBeInTheDocument();
    expect(
      within(list).getByText("Keyword and vectors · calibrated threshold"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/days ago/)).toBeNull();
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
    fireEvent.click(await screen.findByRole("button", { name: /Remove/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("Remove the knowledge base?"),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(kb.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Remove",
      }),
    );
    await waitFor(() => expect(kb.remove).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("Knowledge base removed."),
    ).toBeInTheDocument();
    expect(screen.getByText(/No knowledge base loaded/)).toBeInTheDocument();
  });
});
