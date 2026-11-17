import { newCase } from "@apty/agent-core";
import {
  createCaseStore,
  memoryCaseRecords,
} from "@apty/browser-runtime/storage/case-store";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("../../services/cases", () => ({
  caseStore: () => store.current,
  caseRecorder: () => ({ subscribe: () => () => undefined }),
}));
vi.mock("@apty/browser-runtime/runtime/org-policy", () => ({
  loadOrgPolicy: async () => ({
    kind: "active",
    policy: { caseRetentionDays: 30 },
  }),
}));

import { CasesCard } from "./cases-card";

const NOW = new Date("2026-11-12T10:00:00.000Z");

beforeEach(async () => {
  const cases = createCaseStore({
    records: memoryCaseRecords(),
    now: () => NOW,
  });
  await cases.put({
    ...newCase("conv", NOW, { random: () => 0 }),
    symptom: "the FIXTURE tour is not visible",
    aptyVersion: "4.x",
    checks: [
      {
        packId: "content-not-visible",
        at: NOW.toISOString(),
        status: "cause_found",
        ruleIds: ["CNV-03"],
      },
    ],
  });
  store.current = cases;
});

describe("CasesCard (KB-RAG K25, L1)", () => {
  it("lists each case with its id, date, version, symptom and outcome, and the retention", async () => {
    render(<CasesCard />);
    const row = (await screen.findByText("CASE-20261112-0000")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("2026-11-12")).toBeInTheDocument();
    expect(within(row).getByText("4.x")).toBeInTheDocument();
    expect(
      within(row).getByText("the FIXTURE tour is not visible"),
    ).toBeInTheDocument();
    expect(
      within(row).getByText("Open", { selector: "td" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/for 30 days/)).toBeInTheDocument();
  });

  it("opens a case's record, and deletes all after confirmation", async () => {
    render(
      <CasesCard detailActions={() => <button type="button">Extra</button>} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open CASE-20261112-0000" }),
    );
    const details = screen.getByTestId("case-details");
    expect(details).toHaveTextContent(
      "content-not-visible: cause_found CNV-03",
    );
    expect(
      within(details).getByRole("button", { name: "Extra" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete all cases" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    expect(await screen.findByText("No cases yet.")).toBeInTheDocument();
  });
});

describe("the Site column (KB-RAG K27, F4)", () => {
  it("shows each case's site, and customer-a, customer-b once aliases are on", async () => {
    const cases = store.current as ReturnType<typeof createCaseStore>;
    await cases.put({
      ...newCase("conv-2", new Date(NOW.getTime() + 1000), {
        tabHost: "two.example.com",
        random: () => 0.5,
      }),
    });
    await cases.put({
      ...newCase("conv-3", new Date(NOW.getTime() + 2000), {
        tabHost: "three.example.com",
        random: () => 0.9,
      }),
    });
    render(<CasesCard />);
    expect(
      await screen.findByRole("columnheader", { name: "Site" }),
    ).toBeInTheDocument();
    await screen.findByText("two.example.com");
    expect(screen.getByText("three.example.com")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Show sites as customer-a, customer-b",
      }),
    );
    expect(await screen.findByText("customer-a")).toBeInTheDocument();
    expect(screen.getByText("customer-b")).toBeInTheDocument();
    expect(screen.queryByText("two.example.com")).toBeNull();
  });
});
