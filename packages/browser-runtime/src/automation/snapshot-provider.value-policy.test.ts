import { describe, expect, it } from "vitest";
import { formatSnapshot, type UnifiedSnapshot } from "./snapshot-provider";
import type { TextSnapshotNode } from "./types";

const node = (
  id: string,
  role: string,
  extra: Partial<TextSnapshotNode> = {},
): TextSnapshotNode => ({ id, role, name: "", children: [], ...extra });

function page(): UnifiedSnapshot {
  const children = [
    node("name", "textbox", {
      name: "Patient name",
      value: "Jane Testpatient",
      children: [
        node("t1", "StaticText", { name: "Jane Testpatient" }),
        node("clear", "button", { name: "Clear" }),
      ],
    }),
    node("status", "combobox", {
      name: "Resolved",
      nameIsValue: true,
      value: "resolved",
    }),
    node("referral", "combobox", {
      name: "Referral",
      children: [
        node("list", "none", {
          children: [
            node("o1", "option", { name: "Active" }),
            node("o2", "option", { name: "Referral-Cardio", selected: true }),
          ],
        }),
      ],
    }),
    node("empty", "textbox", { name: "Middle name" }),
    node("heading", "heading", { name: "Chart summary" }),
    node("go", "button", { name: "Open chart" }),
  ];
  const root = node("root", "RootWebArea", { name: "Chart", children });
  const idToNode = new Map<string, TextSnapshotNode>();
  const all = (n: TextSnapshotNode): TextSnapshotNode[] => [
    n,
    ...n.children.flatMap(all),
  ];
  for (const n of all(root)) idToNode.set(n.id, n);
  return { root, idToNode, tabId: 1 };
}

describe("formatting a snapshot under a value policy", () => {
  it("shows what the page has when showing", () => {
    const text = formatSnapshot(page(), "show");
    expect(text).toContain('value="Jane Testpatient"');
    expect(text).toContain('value="resolved"');
    expect(text).toContain("Resolved");
    expect(text).toContain('StaticText "Jane Testpatient"');
    expect(text).toContain("Referral-Cardio");
  });

  it("masks entered values and keeps everything else when masking", () => {
    const text = formatSnapshot(page(), "mask");
    expect(text).not.toContain("Jane Testpatient");
    expect(text).not.toContain("resolved");
    expect(text).not.toContain("Resolved");
    expect(text).toContain('value="[masked]"');
    expect(text).toContain("Patient name");
    expect(text).toContain("Chart summary");
    expect(text).toContain("Active");
    expect(text).not.toContain("Referral-Cardio");
    expect(text).toContain("Clear");
    expect(text).toContain("Open chart");
  });

  it("leaves no value at all when withholding", () => {
    const text = formatSnapshot(page(), "withhold");
    expect(text).not.toContain("Jane Testpatient");
    expect(text).not.toContain("[masked]");
    expect(text).not.toMatch(/value="/);
    expect(text).not.toContain("Referral-Cardio");
    expect(text).toContain("Active");
    expect(text).toContain("Patient name");
    expect(text).toContain("Middle name");
  });

  it("does not alter the snapshot it formats", () => {
    const snapshot = page();
    formatSnapshot(snapshot, "withhold");
    expect(snapshot.root.children[0]?.value).toBe("Jane Testpatient");
    expect(snapshot.root.children[0]?.children).toHaveLength(2);
  });

  it("defaults to the current redaction mode, which is Strict until settings are read", () => {
    const text = formatSnapshot(page());
    expect(text).not.toContain("Jane Testpatient");
  });
});
