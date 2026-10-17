import { beforeEach, describe, expect, it } from "vitest";
import { collectDomSnapshot } from "../collector";
import type { DomSnapshotNode } from "../types";

function nodeFor(html: string, selector: string): DomSnapshotNode {
  document.body.innerHTML = html;
  const snapshot = collectDomSnapshot(document);
  const uid = document
    .querySelector(selector)
    ?.getAttribute("data-apty-nodeid") as string;
  return snapshot.idToNode[uid] as DomSnapshotNode;
}

describe("a name that is really a value", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("flags a select whose name is the selected option's text", () => {
    const node = nodeFor(
      `<select id="s"><option value="a">Alpha</option><option value="b" selected>Bravo</option></select>`,
      "#s",
    );
    expect(node.name).toBe("Bravo");
    expect(node.nameIsValue).toBe(true);
  });

  it("flags a textarea named by its own text", () => {
    const node = nodeFor(`<textarea id="t">Jane Testpatient</textarea>`, "#t");
    expect(node.name).toBe("Jane Testpatient");
    expect(node.nameIsValue).toBe(true);
  });

  it("does not flag a labelled textarea", () => {
    const node = nodeFor(
      `<textarea id="t" aria-label="Notes">Jane Testpatient</textarea>`,
      "#t",
    );
    expect(node.name).toBe("Notes");
    expect(node.nameIsValue).toBeUndefined();
  });

  it("flags a select even when it has a label, because the chosen option replaces that name", () => {
    const node = nodeFor(
      `<select id="s" aria-label="Status"><option selected>Open</option></select>`,
      "#s",
    );
    expect(node.name).toBe("Open");
    expect(node.nameIsValue).toBe(true);
  });

  it("does not flag a select with nothing chosen, a text input or a button", () => {
    expect(
      nodeFor(`<select id="s" aria-label="Status"></select>`, "#s").nameIsValue,
    ).toBeUndefined();
    expect(
      nodeFor(`<input id="i" placeholder="Name" value="Jane">`, "#i")
        .nameIsValue,
    ).toBeUndefined();
    expect(
      nodeFor(`<button id="b">Save</button>`, "#b").nameIsValue,
    ).toBeUndefined();
  });
});
