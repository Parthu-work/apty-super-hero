/**
 * KB-RAG K29, L1 to L4: the panel at the side panel's real sizes (320, 400
 * and 480 px wide; 600 and 900 px tall) with the real header, a case open
 * (by a visibility check answered without the model) and three KB answers
 * of three cards each. Everything above the chat is at most 96 px, the
 * chat is at least 65% of the panel, the document never scrolls and only
 * the message list can. The Close case dialog leaves the chat as it was,
 * a layer switch or a disclosure moves nothing, a new answer moves the
 * view only for an SE at the bottom, and the scroll button covers no text.
 * No model call; synthetic data only.
 *
 * Two files run it, each in its own browser so each passes inside the
 * suite's 180 s limit: panel-layout.e2e.test.mjs (L1 and L2) and
 * panel-scroll.e2e.test.mjs (L3 and L4). This module is not a test file
 * itself.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { kbAnswers } from "./fixtures/kb-answers.mjs";
import {
  axeInBothThemes,
  caseChip,
  describeViolations,
  launchBrowser,
  openSidePanel,
  openStoredConversation,
  sendChat,
  startMockModel,
  startPageServer,
} from "./harness.mjs";

const SYMPTOM = "My workflow 'Take a tour' is not visible in the widget";
const WIDTHS = [320, 400, 480];
const HEIGHTS = [600, 900];

let browser;
let model;
let site;
let app;
let panel;

/** What the layout tests measure, in the panel itself. */
function measure() {
  const log = document.querySelector('[role="log"]');
  const box = log.getBoundingClientRect();
  const doc = document.scrollingElement;
  doc.scrollTop = 120;
  const documentScrolled = doc.scrollTop;
  doc.scrollTop = 0;
  const scrollers = [...document.querySelectorAll("body *")].filter((el) => {
    const style = getComputedStyle(el);
    return (
      ["auto", "scroll"].includes(style.overflowY) &&
      el.scrollHeight > el.clientHeight + 1 &&
      el.getClientRects().length > 0 &&
      style.visibility !== "hidden"
    );
  });
  return {
    above: box.top,
    chat: box.height,
    panel: window.innerHeight,
    documentScrolled,
    documentOverflow: doc.scrollHeight - doc.clientHeight,
    scrollers: scrollers.map((el) =>
      `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 120),
    ),
    scrollerInLog: scrollers.length === 1 && log.contains(scrollers[0]),
  };
}

/** The text of the focused element. */
const focused = () =>
  panel.evaluate(() => document.activeElement?.textContent?.trim());

/** Presses ArrowDown until the open menu's item `name` has focus. */
async function arrowTo(name) {
  for (let i = 0; i < 10; i++) {
    if ((await focused()) === name) return;
    await panel.keyboard.press("ArrowDown");
    await panel.waitForTimeout(150);
  }
  assert.equal(await focused(), name);
}

/** Opens the case menu from the focused chip by keyboard. */
async function openMenuByKeyboard() {
  await caseChip(panel).focus();
  await panel.keyboard.press("Enter");
  const menu = panel.getByRole("menu");
  await menu.waitFor();
  const deadline = Date.now() + 5_000;
  while (
    !(await panel.evaluate(
      () => document.activeElement?.getAttribute("role") === "menuitem",
    ))
  ) {
    assert.ok(Date.now() < deadline, "focus moves into the menu");
    await panel.waitForTimeout(50);
  }
  return menu;
}

async function atSize(width, height) {
  await panel.setViewportSize({ width, height });
  await panel.waitForFunction(
    ([w, h]) => window.innerWidth === w && window.innerHeight === h,
    [width, height],
  );
  await panel.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50))),
  );
}

/** The message list's height and its scroller's scrollTop. */
function chatBox() {
  const log = document.querySelector('[role="log"]');
  const scroller = [...log.querySelectorAll("*")].find((el) =>
    ["auto", "scroll"].includes(getComputedStyle(el).overflowY),
  );
  return {
    height: log.getBoundingClientRect().height,
    scrollTop: scroller.scrollTop,
  };
}

/** Scrolls the chat so `selector`'s nth match ends `gap` px above the view's bottom. */
async function bringNearBottom(locator, gap) {
  await locator.evaluate((el, gap) => {
    const scroller = window.__chatScroller();
    const view = scroller.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    scroller.scrollTop += box.bottom - (view.bottom - gap);
  }, gap);
  await panel.waitForTimeout(150);
}

const scrollerTop = () =>
  panel.evaluate(() => window.__chatScroller().scrollTop);

async function settled() {
  await panel.evaluate(
    () =>
      new Promise((r) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(r, 300)),
        ),
      ),
  );
}

/** The scroll button's box and every text box in the chat it overlaps. */
function scrollButtonOverlaps() {
  const button = document.querySelector('[data-testid="scroll-to-bottom"]');
  if (!button) return null;
  const b = button.getBoundingClientRect();
  const log = document.querySelector('[role="log"]');
  const walker = document.createTreeWalker(log, NodeFilter.SHOW_TEXT);
  const hits = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim() || button.contains(node)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (
        r.width > 0 &&
        r.left < b.right &&
        r.right > b.left &&
        r.top < b.bottom &&
        r.bottom > b.top
      ) {
        hits.push(node.textContent.trim().slice(0, 40));
      }
    }
  }
  const view = log.getBoundingClientRect();
  return {
    hits,
    right: view.right - b.right,
    bottom: view.bottom - b.bottom,
    text: button.textContent.trim(),
    name: button.getAttribute("aria-label"),
  };
}

const toFromBottom = (screens) =>
  panel.evaluate((screens) => {
    const el = window.__chatScroller();
    el.scrollTop = el.scrollHeight - el.clientHeight * (1 + screens);
  }, screens);

/**
 * The panel scene and the named parts of the suite: "header" (L1),
 * "dialog" (L2), "anchoring" (L3) and "scroll-button" (L4).
 */
export function panelLayoutSuite(names) {
  before(async () => {
    model = await startMockModel();
    model.script(() => ({ text: "MODEL WAS CALLED" }));
    site = await startPageServer({
      "/app.html": "<!doctype html><title>CRM</title><h1>Leads</h1>",
    });
    browser = await launchBrowser();
    app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    panel = await openSidePanel(browser, model, app, { aiToken: "" });
    await openStoredConversation(panel, kbAnswers(3));
    await panel.getByText("ANSWER 2:").waitFor({ timeout: 30_000 });
    await sendChat(panel, SYMPTOM);
    await panel
      .getByRole("region", { name: "Why “Take a tour” may not be visible" })
      .waitFor({ timeout: 60_000 });
    await caseChip(panel).waitFor({ timeout: 30_000 });
    await panel.evaluate(() => {
      window.__chatScroller = () =>
        [...document.querySelectorAll('[role="log"] *')].find((el) =>
          ["auto", "scroll"].includes(getComputedStyle(el).overflowY),
        );
    });
  });

  after(async () => {
    await browser?.close();
    model?.close();
    site?.close();
  });

  if (names.includes("header")) {
    describe("one small header and one scroll area (KB-RAG K29, L1)", () => {
      for (const width of WIDTHS) {
        for (const height of HEIGHTS) {
          it(`at ${width}x${height} with a case open`, async () => {
            await atSize(width, height);
            const m = await panel.evaluate(measure);
            const why = JSON.stringify(m);
            assert.ok(m.above <= 96, `the header is ${m.above} px: ${why}`);
            assert.ok(
              m.chat >= 0.65 * m.panel,
              `the chat is ${m.chat} of ${m.panel} px: ${why}`,
            );
            assert.equal(m.documentScrolled, 0, `the document scrolls: ${why}`);
            assert.ok(
              m.documentOverflow <= 0,
              `the document overflows: ${why}`,
            );
            assert.equal(m.scrollers.length, 1, `scroll areas: ${why}`);
            assert.ok(m.scrollerInLog, `the scroll area is the chat: ${why}`);
            assert.equal(model.requests.length, 0);
          });
        }
      }
    });
  }

  if (names.includes("header")) {
    describe("the header by keyboard, light and dark (KB-RAG K29, L1)", () => {
      it("the pack icon names every pack, and the case menu opens, moves and closes by keyboard", async () => {
        await atSize(400, 900);
        const packs = panel
          .getByTestId("kb-pack-status")
          .filter({ visible: true });
        assert.match(await packs.getAttribute("data-tone"), /^(none|ok)$/);
        await packs.focus();
        const tooltip = panel.getByTestId("kb-pack-status-tooltip").first();
        await tooltip.waitFor();
        assert.match(await tooltip.innerText(), /none loaded/);
        let violations = await axeInBothThemes(panel);
        assert.deepEqual(violations, [], describeViolations(violations));

        const chip = caseChip(panel);
        const menu = await openMenuByKeyboard();
        assert.deepEqual(
          (await menu.getByRole("menuitem").allInnerTexts()).map((t) =>
            t.trim(),
          ),
          ["Copy case id", "New case", "Close case…", "Open in Cases"],
        );
        assert.equal(await focused(), "Copy case id");
        await arrowTo("New case");
        violations = await axeInBothThemes(panel);
        assert.deepEqual(violations, [], describeViolations(violations));
        await panel.keyboard.press("Escape");
        await menu.waitFor({ state: "hidden" });
        assert.equal(
          await chip.evaluate((el) => el === document.activeElement),
          true,
        );
      });
    });
  }

  if (names.includes("delivery")) {
    describe("one clear answer at a glance (KB-RAG K29, D1, D2)", () => {
      for (const width of WIDTHS) {
        it(`each three-card answer shows one open card, one fold line, one source line and at most 8 controls at ${width} px`, async () => {
          await atSize(width, 900);
          const answers = panel.getByRole("region", {
            name: "KB cards that match",
          });
          assert.equal(await answers.count(), 3);
          for (const answer of await answers.all()) {
            assert.equal(await answer.getByRole("article").count(), 1);
            assert.equal(
              await answer
                .getByRole("button", { name: /other possible cards?$/ })
                .count(),
              1,
            );
            assert.equal(await answer.getByTestId("kb-source-line").count(), 1);
            const stops = await answer.evaluate(
              (root) =>
                [
                  ...root.querySelectorAll("a[href], button, input, select"),
                ].filter((el) => el.tabIndex >= 0 && !el.disabled).length,
            );
            assert.ok(stops <= 8, `${stops} controls`);
          }
        });
      }

      it("the folded answer and its ⋯ menu pass axe in light and dark, by keyboard", async () => {
        await atSize(400, 900);
        const answer = panel
          .getByRole("region", { name: "KB cards that match" })
          .first();
        let violations = await axeInBothThemes(panel);
        assert.deepEqual(violations, [], describeViolations(violations));
        await answer
          .getByRole("button", { name: "More actions for this answer" })
          .focus();
        await panel.keyboard.press("Enter");
        const menu = panel.getByRole("menu");
        await menu.waitFor();
        assert.deepEqual(
          (await menu.getByRole("menuitem").allInnerTexts()).map((t) =>
            t.trim(),
          ),
          [
            "Copy answer",
            "Why this answer",
            "Prepare support bundle",
            "Open in Confluence",
          ],
        );
        violations = await axeInBothThemes(panel);
        assert.deepEqual(violations, [], describeViolations(violations));
        await panel.keyboard.press("Escape");
        await menu.waitFor({ state: "hidden" });
        assert.equal(model.requests.length, 0);
      });
    });
  }

  if (names.includes("dialog")) {
    describe("Close case as a dialog (KB-RAG K29, L2)", () => {
      for (const width of WIDTHS) {
        for (const height of HEIGHTS) {
          it(`at ${width}x${height}, by keyboard, the chat keeps its height and place`, async () => {
            await atSize(width, height);
            await panel.evaluate(() => {
              const log = document.querySelector('[role="log"]');
              const scroller = [...log.querySelectorAll("*")].find((el) =>
                ["auto", "scroll"].includes(getComputedStyle(el).overflowY),
              );
              scroller.scrollTop = Math.floor(scroller.scrollHeight / 3);
            });
            await panel.waitForTimeout(100);
            const before = await panel.evaluate(chatBox);

            const chip = caseChip(panel);
            await openMenuByKeyboard();
            await arrowTo("Close case…");
            await panel.keyboard.press("Enter");
            const dialog = panel.getByRole("dialog", { name: /^Close CASE-/ });
            await dialog.waitFor();
            assert.equal(
              await dialog.evaluate((el) =>
                el.contains(document.activeElement),
              ),
              true,
              "focus moves into the dialog",
            );
            await dialog.getByTestId("close-case-form").waitFor();
            assert.equal(
              await dialog.getByRole("radio", { name: "Resolved" }).isChecked(),
              true,
            );
            await dialog
              .getByRole("group", { name: "Was the finding right?" })
              .waitFor();
            const open = await panel.evaluate(chatBox);
            assert.deepEqual(open, before, "the chat while the dialog is open");
            const m = await panel.evaluate(measure);
            assert.ok(m.above <= 96, JSON.stringify(m));
            assert.ok(m.chat >= 0.65 * m.panel, JSON.stringify(m));

            if (width === 400 && height === 900) {
              const violations = await axeInBothThemes(panel);
              assert.deepEqual(violations, [], describeViolations(violations));
            }

            await panel.keyboard.press("Escape");
            await dialog.waitFor({ state: "hidden" });
            assert.equal(
              await chip.evaluate((el) => el === document.activeElement),
              true,
              "focus returns to the case chip",
            );
            assert.deepEqual(await panel.evaluate(chatBox), before);
            assert.equal(model.requests.length, 0);
          });
        }
      }
    });
  }

  if (names.includes("anchoring")) {
    describe("nothing jumps when a card changes height (KB-RAG K29, L3)", () => {
      for (const [width, height] of [
        [320, 600],
        [400, 900],
      ]) {
        it(`switching L1 to L4 on the second of three cards keeps that card in place at ${width}x${height}`, async () => {
          await atSize(width, height);
          const answer = panel
            .getByRole("region", { name: "KB cards that match" })
            .nth(1);
          // K29, D1: the second card opens from the fold, in place of the first.
          const second = /^FIXTURE banner glows for some users/;
          if (
            (await answer.getByRole("link", { name: second }).count()) === 0
          ) {
            await answer
              .getByRole("button", { name: "2 other possible cards" })
              .click();
            await answer.getByRole("button", { name: second }).click();
          }
          const layers = answer
            .getByRole("article")
            .getByRole("tablist", { name: "Card layers" });
          await bringNearBottom(layers, 12);
          const before = await layers.boundingBox();
          const support = layers.getByRole("tab", { name: "Support" });
          await support.focus();
          await panel.keyboard.press("Enter");
          await panel.waitForFunction(
            (el) => el.getAttribute("aria-selected") === "true",
            await support.elementHandle(),
          );
          await settled();
          const after = await layers.boundingBox();
          assert.ok(
            Math.abs(after.y - before.y) <= 2,
            `the card moved from ${before.y} to ${after.y}`,
          );
          await layers.getByRole("tab", { name: "Settings" }).click();
          await settled();
        });
      }

      it('opening "Why this answer" on a middle turn does not scroll', async () => {
        await atSize(400, 900);
        // K29, D2: "Why this answer" opens from the answer's ⋯ menu.
        const answer = panel
          .getByRole("region", { name: "KB cards that match" })
          .nth(1);
        const more = answer.getByRole("button", {
          name: "More actions for this answer",
        });
        await bringNearBottom(more, 8);
        const top = await scrollerTop();
        const before = await more.boundingBox();
        await more.click();
        await panel.getByRole("menuitem", { name: "Why this answer" }).click();
        const why = answer.getByRole("region", { name: "Why this answer" });
        await why.waitFor();
        await settled();
        assert.equal(await scrollerTop(), top);
        const after = await more.boundingBox();
        assert.ok(
          Math.abs(after.y - before.y) <= 2,
          `${before.y} → ${after.y}`,
        );
        await why.getByRole("button", { name: "Close" }).click();
        await settled();
      });

      it("a new answer while the SE reads higher up does not move the view; at the bottom it is followed", async () => {
        await atSize(400, 900);
        const checks = panel.getByRole("region", {
          name: "Why “Take a tour” may not be visible",
        });
        const reading = panel.getByText("ANSWER 1:");
        await bringNearBottom(reading, 200);
        const top = await scrollerTop();
        const before = await reading.boundingBox();
        const count = await checks.count();
        await sendChat(panel, SYMPTOM);
        await checks.nth(count).waitFor({ timeout: 60_000 });
        await settled();
        assert.equal(await scrollerTop(), top, "the view moved");
        assert.ok(Math.abs((await reading.boundingBox()).y - before.y) <= 2);

        await panel.evaluate(() => {
          const scroller = window.__chatScroller();
          scroller.scrollTop = scroller.scrollHeight;
        });
        await settled();
        await sendChat(panel, SYMPTOM);
        await checks.nth(count + 1).waitFor({ timeout: 60_000 });
        await settled();
        const gap = await panel.evaluate(() => {
          const el = window.__chatScroller();
          return el.scrollHeight - el.scrollTop - el.clientHeight;
        });
        assert.ok(gap <= 2, `${gap} px from the bottom after a new answer`);
        assert.equal(model.requests.length, 0);
      });
    });
  }

  if (names.includes("scroll-button")) {
    describe("a scroll button that never covers text (KB-RAG K29, L4)", () => {
      for (const width of WIDTHS) {
        it(`at ${width} px it shows only more than a screen up, in the corner, over no text`, async () => {
          await atSize(width, 600);
          await toFromBottom(0.5);
          await settled();
          assert.equal(await panel.evaluate(scrollButtonOverlaps), null);

          for (const screens of [1.2, 2.5, 4]) {
            await toFromBottom(screens);
            await settled();
            const found = await panel.evaluate(scrollButtonOverlaps);
            assert.ok(found, `no scroll button ${screens} screens up`);
            assert.deepEqual(found.hits, [], JSON.stringify(found));
            assert.ok(
              found.right <= 24 && found.bottom <= 16,
              JSON.stringify(found),
            );
          }
        });
      }

      it('counts the answers that arrived below ("1 new") and scrolls down', async () => {
        await atSize(400, 900);
        await toFromBottom(2);
        await settled();
        const checks = panel.getByRole("region", {
          name: "Why “Take a tour” may not be visible",
        });
        const count = await checks.count();
        await sendChat(panel, SYMPTOM);
        await checks.nth(count).waitFor({ timeout: 60_000 });
        await settled();
        const found = await panel.evaluate(scrollButtonOverlaps);
        assert.equal(found?.text, "1 new", JSON.stringify(found));
        assert.match(found.name, /Scroll to the latest message.*1 new/);
        assert.deepEqual(found.hits, []);
        await panel.getByTestId("scroll-to-bottom").click();
        await settled();
        assert.equal(await panel.evaluate(scrollButtonOverlaps), null);
        assert.equal(model.requests.length, 0);
      });
    });
  }
}
