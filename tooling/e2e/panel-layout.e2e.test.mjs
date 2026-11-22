/**
 * KB-RAG K29, L1 to L4: the panel at the side panel's real sizes (320, 400
 * and 480 px wide; 600 and 900 px tall) with the real header, a case open
 * (by a visibility check answered without the model) and three KB answers
 * of three cards each. Everything above the chat is at most 96 px, the
 * chat is at least 65% of the panel, the document never scrolls and only
 * the message list can. No model call; synthetic data only.
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
        assert.ok(m.documentOverflow <= 0, `the document overflows: ${why}`);
        assert.equal(m.scrollers.length, 1, `scroll areas: ${why}`);
        assert.ok(m.scrollerInLog, `the scroll area is the chat: ${why}`);
        assert.equal(model.requests.length, 0);
      });
    }
  }
});

describe("the header by keyboard, light and dark (KB-RAG K29, L1)", () => {
  it("the pack icon names every pack, and the case menu opens, moves and closes by keyboard", async () => {
    await atSize(400, 900);
    const packs = panel.getByTestId("kb-pack-status").filter({ visible: true });
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
      (await menu.getByRole("menuitem").allInnerTexts()).map((t) => t.trim()),
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
          await dialog.evaluate((el) => el.contains(document.activeElement)),
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
