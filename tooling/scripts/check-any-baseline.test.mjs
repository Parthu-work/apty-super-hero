import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareToBaseline } from "./check-any-baseline.mjs";

describe("compareToBaseline", () => {
  it("allows equal or lower counts and flags a rise or a new file", () => {
    assert.deepEqual(
      compareToBaseline(
        { "a.ts": 2, "b.ts": 1, "c.ts": 4, "new.ts": 1 },
        { "a.ts": 2, "b.ts": 3, "c.ts": 3 },
      ),
      [
        { file: "c.ts", count: 4, allowed: 3 },
        { file: "new.ts", count: 1, allowed: 0 },
      ],
    );
  });
});
