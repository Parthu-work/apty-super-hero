import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareToBaseline,
  countHardcodedStrings,
} from "./check-i18n-baseline.mjs";

describe("check-i18n-baseline", () => {
  it("counts JSX text, string children and user-visible attribute strings", () => {
    const source = `
      export function Card({ t }) {
        return (
          <section aria-label="Results" title={t("x")} className="p-2">
            <h2>DOM Health</h2>
            <p>{"Not run yet"}</p>
            <input placeholder="Search…" alt="" />
            <span>{t("card.ready")}</span>
            <Icon label="Copy" data-testid="copy-button" />
            <b> · </b>
          </section>
        );
      }`;

    assert.equal(countHardcodedStrings(source, "card.tsx"), 5);
  });

  it("does not count translated text, class names, ids or punctuation", () => {
    const source = `
      const A = ({ t }) => (
        <div className="flex gap-2" id="root" data-state="open">
          {t("a.title")} {count} / {total} — :
        </div>
      );`;

    assert.equal(countHardcodedStrings(source, "a.tsx"), 0);
  });

  it("flags files that rose above the baseline, or are new with strings", () => {
    assert.deepEqual(
      compareToBaseline(
        { "a.tsx": 3, "b.tsx": 2, "c.tsx": 1 },
        { "a.tsx": 3, "b.tsx": 1 },
      ),
      [
        { file: "b.tsx", count: 2, allowed: 1 },
        { file: "c.tsx", count: 1, allowed: 0 },
      ],
    );
  });
});
