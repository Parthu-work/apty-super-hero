/**
 * The quick win end to end, in Chromium with the built Agent and a fake
 * Apty Client serving synthetic 5.x content files: the SE says a workflow is
 * not visible, and the side panel answers with the check's card from the
 * Client's files without a single request to the model. A follow-up
 * question then goes to the model with the check in its history. The
 * selector and page checks run the fixtures' stored selectors in a page
 * built to break each one, the same way, with no model request.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  AGENT_EXTENSION_ID,
  describeViolations,
  extensionPage,
  launchBrowser,
  openSidePanel,
  ROOT,
  runAxe,
  savedPeerId,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
  unpackedExtensionId,
  writeContentClient,
} from "./harness.mjs";

const FIXTURES = join(
  ROOT,
  "packages/browser-runtime/src/apty/diagnosis/fixtures/content-5x",
);
const files = Object.fromEntries(
  readdirSync(FIXTURES).map((name) => [
    name,
    readFileSync(join(FIXTURES, name), "utf8"),
  ]),
);
const clientDir = join(tempDir("apty-e2e-content-"), "client");
const clientId = unpackedExtensionId(clientDir);

/** The fixture's environments, with UAT's pattern covering this server's /app pages only. */
function appUrlsFor(origin) {
  const apps = JSON.parse(files["app-urls.json"]);
  apps[0].environments[1].urls = [`${origin}/app`];
  return JSON.stringify(apps);
}

/** Each fixture selector broken a different way: the tooltip's only in a frame, the launcher's twice, the validation's submit button behind a shadow root, the tour's third step missing. */
const SELECTORS_PAGE = `<title>CRM</title>
<h1>Leads</h1>
<button class="new-lead" id="add">New lead</button>
<button class="new-lead" id="add">New lead (copy)</button>
<input type="email" aria-label="Email">
<a id="tour-start" href="#">Take the tour</a>
<x-form></x-form>
<iframe src="/lead-frame.html" title="Lead details"></iframe>
<script>
  document.querySelector("x-form").attachShadow({ mode: "open" }).innerHTML =
    '<button type="submit">Save</button>';
</script>`;

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: "MODEL WAS CALLED" }));
  site = await startPageServer({
    "/app.html": "<title>CRM</title><h1>Leads</h1>",
    "/other.html": "<title>CRM</title><h1>Accounts</h1>",
    "/app-logs.html":
      '<title>CRM</title><h1>Leads</h1><script>console.debug("[Apty] No matching version found for the current URL: x")</script>',
    "/app-selectors.html": SELECTORS_PAGE,
    "/lead-frame.html":
      '<title>Lead</title><select name="lead_source"><option>Web</option></select>',
  });
  writeContentClient(
    clientDir,
    AGENT_EXTENSION_ID,
    { ...files, "app-urls.json": appUrlsFor(site.origin) },
    {
      logs: [
        {
          level: "debug",
          message: "Error registering IoC: No active application found",
          timestamp: 1,
        },
      ],
    },
  );
  browser = await launchBrowser({ extraExtensions: [clientDir] });
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

/** Save the content Client in Options, as an SE would once; later calls find it saved. */
async function connectClient() {
  const options = await extensionPage(browser);
  if (!(await savedPeerId(options, "client"))) {
    await options.getByRole("tab", { name: "Connection" }).click();
    await options.getByLabel("Extension ID").fill(clientId);
    await options
      .getByLabel("Extension ID")
      .locator("..")
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await options.getByText("Answering").waitFor({ timeout: 30_000 });
  }
  await options.close();
}

async function panelOnApp(path = "/app.html") {
  const app = await browser.context.newPage();
  await app.goto(`${site.origin}${path}`);
  const panel = await openSidePanel(browser, model, app);
  return { app, panel };
}

describe("visibility check, end to end", () => {
  it("says no Client is saved, without asking the model", async () => {
    const { app, panel } = await panelOnApp();
    const before = model.requests.length;

    await sendChat(
      panel,
      "My workflow 'Take a tour' is not visible in the widget",
    );

    const card = panel.getByRole("region", {
      name: "Why “Take a tour” may not be visible",
    });
    await card.waitFor({ timeout: 30_000 });
    await card.getByText("No data to check").waitFor();
    await card
      .getByText(
        "Could not reach the Apty Client: No Apty Client extension ID is saved.",
      )
      .first()
      .waitFor();
    assert.equal(model.requests.length, before, "the model was not asked");
    await panel.close();
    await app.close();
  });

  it("finds the cause from the Client's files with no model request, then a follow-up reaches the model with the check in its history", async () => {
    await connectClient();
    const { app, panel } = await panelOnApp();
    model.script(() => ({ text: "RESULT: follow-up answered" }));

    await sendChat(
      panel,
      "My workflow 'Take a tour' is not visible in the widget",
    );

    const card = panel.getByRole("region", {
      name: "Why “Take a tour” may not be visible",
    });
    await card.waitFor({ timeout: 30_000 });
    await card.getByText("Cause found").waitFor();
    await card
      .getByText(
        "In Studio, clear “Hide from widget” in its settings and publish.",
      )
      .waitFor();
    await card.getByText("workflow.json: hideFromWidget = true").waitFor();
    await card
      .getByText("The Apty Client loaded UAT (order 2)", { exact: false })
      .waitFor();
    assert.equal(model.requests.length, 0, "the check made no model request");

    const violations = await runAxe(panel);
    assert.deepEqual(violations, [], describeViolations(violations));

    await sendChat(panel, "How do I fix that?");
    await panel
      .getByText("RESULT: follow-up answered")
      .waitFor({ timeout: 30_000 });
    assert.equal(model.requests.length, 1);
    const sent = JSON.stringify(model.requests[0].messages);
    assert.match(sent, /Take a tour/);
    assert.match(sent, /CNV-03/);
    assert.match(sent, /How do I fix that\?/);
    assert.ok(
      model.requests[0].messages.some((m) =>
        m.tool_calls?.some((c) => c.function?.name === "run_diagnosis"),
      ),
      "the check reaches the model as a tool call and its result",
    );
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });

  it("scans every workflow when none is named", async () => {
    await connectClient();
    const { app, panel } = await panelOnApp();
    const before = model.requests.length;

    await sendChat(panel, "my workflow is not visible in the widget");

    const card = panel.getByRole("region", {
      name: "Visibility check: every workflow",
    });
    await card.waitFor({ timeout: 30_000 });
    await card.getByText("2 of 9 have a blocker in the files").waitFor();
    await card.getByText("Only in turned-off segments").waitFor();
    assert.equal(model.requests.length, before);
    await panel.close();
    await app.close();
  });

  it("finds a segment that can never match, in dark mode too", async () => {
    await connectClient();
    const settings = await extensionPage(browser);
    await settings.evaluate(() =>
      chrome.storage.local.set({ apty_theme: "dark" }),
    );
    await settings.close();
    const { app, panel } = await panelOnApp();
    await panel.waitForFunction(() =>
      document.documentElement.classList.contains("dark"),
    );

    await sendChat(
      panel,
      "the Export a report workflow is missing from the widget",
    );

    const card = panel.getByRole("region", {
      name: "Why “Export a report” may not be visible",
    });
    await card.waitFor({ timeout: 30_000 });
    await card
      .getByText(
        "Every segment that lists it (Retired team) is turned off, so it is hidden from everyone.",
      )
      .first()
      .waitFor();
    const violations = await runAxe(panel);
    assert.deepEqual(violations, [], describeViolations(violations));
    await panel.close();
    await app.close();
  });
  it("checks the widget against the page in this tab: a pattern too specific for it, with no model request", async () => {
    await connectClient();
    const { app, panel } = await panelOnApp("/other.html");
    const before = model.requests.length;

    await sendChat(panel, "the Apty widget is not appearing on this page");

    const card = panel.getByRole("region", {
      name: "Why the widget may not be visible",
    });
    await card.waitFor({ timeout: 30_000 });
    await card.getByText("Cause found").waitFor();
    await card
      .getByText(
        "UAT (order 2) has a URL pattern for this site that does not cover this page, so no content runs here.",
      )
      .first()
      .waitFor();
    await card
      .getByRole("link", { name: /KB card 1497104451/ })
      .first()
      .waitFor();
    assert.equal(model.requests.length, before, "the model was not asked");
    const cardText = await card.textContent();
    assert.ok(
      !cardText.includes(site.origin),
      "the card shows no page URL or pattern",
    );
    const violations = await runAxe(panel);
    assert.deepEqual(violations, [], describeViolations(violations));
    await panel.close();
    await app.close();
  });

  it("names the environment a covered page belongs to and leaves the segments to the browser", async () => {
    await connectClient();
    const { app, panel } = await panelOnApp("/app.html");

    await sendChat(panel, "widget is missing for every user");

    const card = panel.getByRole("region", {
      name: "Why the widget may not be visible",
    });
    await card.waitFor({ timeout: 30_000 });
    await card.getByText("Needs a check in the browser").waitFor();
    await card
      .getByText("This page belongs to UAT (order 2)", { exact: false })
      .waitFor();
    await card
      .getByText("The widget is shown only to: Sales team, New hires", {
        exact: false,
      })
      .waitFor();
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });
  it("reads the Client's logs and the page's own console for a logs question, with no model request", async () => {
    await connectClient();
    const { app, panel } = await panelOnApp("/app-logs.html");
    const before = model.requests.length;

    await sendChat(panel, "any errors in the console?");

    const card = panel.getByRole("region", { name: "Errors and logs" });
    await card.waitFor({ timeout: 30_000 });
    await card.getByText("Cause found").waitFor();
    await card
      .getByText('Apty Client logs: "Error registering IoC" (1×)')
      .waitFor();
    await card
      .getByText(
        'page console: "No matching version found for the current URL" (1×)',
      )
      .waitFor();
    await card
      .getByRole("link", { name: /KB card 1496678479/ })
      .first()
      .waitFor();
    assert.equal(model.requests.length, before, "the model was not asked");
    const violations = await runAxe(panel);
    assert.deepEqual(violations, [], describeViolations(violations));
    await panel.close();
    await app.close();
  });
});

describe("selector and page checks, end to end", () => {
  async function ask(message) {
    await connectClient();
    const { app, panel } = await panelOnApp("/app-selectors.html");
    await app.locator("iframe").waitFor();
    const before = model.requests.length;
    await sendChat(panel, message);
    return { app, panel, before };
  }

  it("finds a launcher whose selector matches two elements, with no model request and no selector on the card", async () => {
    const { app, panel, before } = await ask(
      "the Start: Create a lead launcher is on the wrong element",
    );

    const card = panel.getByRole("region", {
      name: "Why Apty may not find the element of “Start: Create a lead”",
    });
    await card.waitFor({ timeout: 30_000 });
    await card.getByText("Cause found").waitFor();
    await card
      .getByText(
        "Its element: the selector matches 2 elements (2 rendered). Apty takes the first rendered one, which may not be yours.",
      )
      .first()
      .waitFor();
    await card
      .getByRole("link", { name: /KB card 1496907796/ })
      .first()
      .waitFor();
    assert.equal(model.requests.length, before, "the model was not asked");
    const cardText = await card.textContent();
    assert.ok(!cardText.includes("new-lead"), "the card shows no selector");
    const violations = await runAxe(panel);
    assert.deepEqual(violations, [], describeViolations(violations));
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });

  it("finds a tooltip's selector that only matches inside a frame, by asking every frame", async () => {
    const { app, panel, before } = await ask(
      "Apty cannot find the element for the 'Lead source help' tooltip",
    );

    const card = panel.getByRole("region", {
      name: "Why Apty may not find the element of “Lead source help”",
    });
    await card.waitFor({ timeout: 30_000 });
    await card
      .getByText(
        "Its element: the selector matches nothing in the page itself but 1 element(s) inside a frame, and its frame path is empty, as a hand-written selector's is.",
      )
      .first()
      .waitFor();
    await card
      .getByRole("link", { name: /KB card 1496612922/ })
      .first()
      .waitFor();
    assert.equal(model.requests.length, before);
    await panel.close();
    await app.close();
  });

  it("checks each element of a validation and finds the one behind a shadow root", async () => {
    const { app, panel } = await ask(
      "the Email format validation's selector stopped working",
    );

    const card = panel.getByRole("region", {
      name: "Why Apty may not find the element of “Email format”",
    });
    await card.waitFor({ timeout: 30_000 });
    await card
      .getByText("Its element: matches exactly one rendered element in view", {
        exact: false,
      })
      .waitFor();
    await card
      .getByText(
        "Disabled element 1: the selector matches 1 element(s) inside a shadow root, but no shadow host is stored, so a lookup in the document never reaches them.",
      )
      .first()
      .waitFor();
    await panel.close();
    await app.close();
  });

  it("reads a workflow's steps from its own file and names the step whose generated id matches nothing", async () => {
    const { app, panel, before } = await ask(
      "workflow 'Take a tour' step 3 fails",
    );

    const card = panel.getByRole("region", {
      name: "Why Apty may not find the element of “Take a tour”",
    });
    await card.waitFor({ timeout: 30_000 });
    await card
      .getByText(
        "Step 3: the selector holds 1 generated-looking value(s), which often change after a reload.",
      )
      .first()
      .waitFor();
    await card
      .getByText("Step 3: the stored selector matches nothing on this page.")
      .first()
      .waitFor();
    assert.equal(model.requests.length, before);
    await panel.close();
    await app.close();
  });

  it("reads DOM Health's audit of the page for a page where nothing can be selected", async () => {
    const { app, panel, before } = await ask(
      "Apty cannot select any elements on this page",
    );

    const card = panel.getByRole("region", {
      name: "Element selection on this page",
    });
    await card.waitFor({ timeout: 60_000 });
    await card
      .getByText(
        "2 element(s) share their id with another in the same document or shadow root, so a selector on that id matches more than one.",
      )
      .first()
      .waitFor();
    await card
      .getByText("1 open shadow roots hold", { exact: false })
      .waitFor();
    assert.equal(model.requests.length, before);
    const cardText = await card.textContent();
    assert.ok(!cardText.includes(site.origin), "the card shows no page URL");
    const violations = await runAxe(panel);
    assert.deepEqual(violations, [], describeViolations(violations));
    await panel.close();
    await app.close();
  });
});
