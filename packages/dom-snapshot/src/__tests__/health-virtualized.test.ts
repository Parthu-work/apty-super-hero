import { beforeEach, describe, expect, it } from "vitest";
import {
  detectVirtualizedLists,
  mergeVirtualizedLists,
  SPACER_MIN_PX,
} from "../health-virtualized";

beforeEach(() => {
  document.body.innerHTML = "";
});

function rows(n: number, from = 0, attr = "") {
  return Array.from(
    { length: n },
    (_, i) =>
      `<div role="row" ${attr.replace("$i", String(from + i))}>r${from + i}</div>`,
  ).join("");
}

describe("detectVirtualizedLists", () => {
  it("finds a grid whose aria-rowcount exceeds its rendered rows", () => {
    document.body.innerHTML = `<div role="grid" aria-rowcount="1000">${rows(20)}</div>`;

    expect(detectVirtualizedLists(document)).toEqual({
      containers: 1,
      observedItems: 20,
      declaredTotal: 1000,
      samples: [
        {
          role: "grid",
          signals: ["aria-count"],
          observedItems: 20,
          declaredTotal: 1000,
        },
      ],
    });
  });

  it("treats aria-rowcount=-1 as an unknown total", () => {
    document.body.innerHTML = `<div role="grid" aria-rowcount="-1">${rows(5)}</div>`;
    const result = detectVirtualizedLists(document);
    expect(result.containers).toBe(1);
    expect(result.declaredTotal).toBeNull();
  });

  it("finds columns hidden by aria-colcount", () => {
    document.body.innerHTML = `<div role="grid" aria-colcount="40">
      <div role="row"><div role="gridcell">a</div><div role="gridcell">b</div></div></div>`;
    expect(detectVirtualizedLists(document).samples[0]).toMatchObject({
      signals: ["aria-count"],
      observedItems: 2,
      declaredTotal: 40,
    });
  });

  it("finds a list whose items declare a larger aria-setsize", () => {
    const items = Array.from(
      { length: 10 },
      (_, i) =>
        `<div role="option" aria-setsize="250" aria-posinset="${i + 1}">o${i}</div>`,
    ).join("");
    document.body.innerHTML = `<div role="listbox">${items}</div>`;

    expect(detectVirtualizedLists(document).samples).toEqual([
      {
        role: "listbox",
        signals: ["aria-count"],
        observedItems: 10,
        declaredTotal: 250,
      },
    ]);
  });

  it("finds data-index values that skip the rows scrolled away", () => {
    document.body.innerHTML = `<div class="rows">${rows(10, 40, 'data-index="$i"')}</div>`;

    expect(detectVirtualizedLists(document).samples).toEqual([
      {
        role: "div",
        signals: ["index-gap"],
        observedItems: 10,
        declaredTotal: 50,
      },
    ]);
  });

  it("finds an empty spacer standing in for unrendered rows", () => {
    document.body.innerHTML = `<div role="list">
      <div style="height: ${SPACER_MIN_PX * 4}px"></div>
      <div role="listitem">a</div><div role="listitem">b</div><div role="listitem">c</div>
    </div>`;

    expect(detectVirtualizedLists(document).samples[0]).toMatchObject({
      role: "list",
      signals: ["spacer"],
      observedItems: 3,
      declaredTotal: null,
    });
  });

  it("finds a list that scrolls far beyond its rendered rows", () => {
    document.body.innerHTML = `<div role="list">${Array.from(
      { length: 5 },
      () => `<div role="listitem">x</div>`,
    ).join("")}</div>`;
    const list = document.querySelector('[role="list"]') as HTMLElement;
    Object.defineProperty(list, "scrollHeight", { value: 20_000 });
    for (const item of list.children) {
      (item as HTMLElement).getBoundingClientRect = () =>
        ({ height: 30 }) as DOMRect;
    }

    expect(detectVirtualizedLists(document).samples[0]).toMatchObject({
      signals: ["scroll-height"],
      observedItems: 5,
    });
  });

  it("counts a grid and its row wrapper as one list", () => {
    const placed = Array.from(
      { length: 15 },
      (_, i) =>
        `<div role="row" data-index="${100 + i}" style="position:absolute;top:${(100 + i) * 30}px">r</div>`,
    ).join("");
    document.body.innerHTML = `<div role="grid" aria-rowcount="1000"><div style="position:relative;height:30000px">${placed}</div></div>`;

    expect(detectVirtualizedLists(document)).toEqual({
      containers: 1,
      observedItems: 15,
      declaredTotal: 1000,
      samples: [
        {
          role: "grid",
          signals: ["aria-count", "index-gap"],
          observedItems: 15,
          declaredTotal: 1000,
        },
      ],
    });
  });

  it("finds a virtualized grid inside a shadow root", () => {
    const host = document.createElement("div");
    document.body.append(host);
    host.attachShadow({
      mode: "open",
    }).innerHTML = `<div role="grid" aria-rowcount="300">${rows(12)}</div>`;

    expect(detectVirtualizedLists(document)).toMatchObject({
      containers: 1,
      observedItems: 12,
      declaredTotal: 300,
    });
  });

  it("does not flag a long list that is fully rendered", () => {
    const items = Array.from(
      { length: 300 },
      (_, i) =>
        `<li data-index="${i}" aria-setsize="300" aria-posinset="${i + 1}">item ${i}</li>`,
    ).join("");
    document.body.innerHTML = `<ul role="list">${items}</ul>
      <div role="grid" aria-rowcount="3">${rows(3)}</div>
      <div><div style="height: 900px">tall content, not a spacer</div><p>a</p><p>b</p></div>`;

    expect(detectVirtualizedLists(document)).toEqual({
      containers: 0,
      observedItems: 0,
      declaredTotal: 0,
      samples: [],
    });
  });
});

describe("mergeVirtualizedLists", () => {
  const known = {
    containers: 1,
    observedItems: 20,
    declaredTotal: 1000,
    samples: [
      {
        role: "grid",
        signals: ["aria-count" as const],
        observedItems: 20,
        declaredTotal: 1000,
      },
    ],
  };

  it("sums frames and keeps the total while every frame knows it", () => {
    expect(mergeVirtualizedLists([known, undefined, known])).toMatchObject({
      containers: 2,
      observedItems: 40,
      declaredTotal: 2000,
    });
  });

  it("makes the total unknown when one frame's is", () => {
    expect(
      mergeVirtualizedLists([known, { ...known, declaredTotal: null }])
        .declaredTotal,
    ).toBeNull();
  });
});
