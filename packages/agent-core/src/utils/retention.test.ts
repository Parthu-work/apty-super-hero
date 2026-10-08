import { describe, expect, it } from "vitest";
import { selectForEviction } from "./retention.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

function evict(ages: number[], maxItems: number) {
  const items = ages.map((age, i) => ({ id: i, t: NOW - age * DAY }));
  return selectForEviction(items, {
    timeOf: (item) => item.t,
    maxItems,
    maxAgeMs: 7 * DAY,
    now: NOW,
  }).map((item) => item.id);
}

describe("selectForEviction", () => {
  it("evicts items past the retention age even under the count limit", () => {
    expect(evict([1, 8, 30], 50)).toEqual([1, 2]);
  });

  it("evicts the oldest fresh items beyond the count limit", () => {
    expect(evict([3, 1, 2, 0], 2)).toEqual([2, 0]);
  });

  it("keeps everything that is fresh and within the limit", () => {
    expect(evict([0, 6.9], 5)).toEqual([]);
  });
});
