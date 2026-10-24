# DOM Config: SE runbook

A short guide for generating an application's Apty DOM settings with the
DOM Config card. How it works is in [`dom-config.md`](dom-config.md).
Everything stays in the side panel's memory: export before you close it.

## 1. Generate

1. Open the application on its usual start page, signed in as a user who
   sees the screens the guides will cover.
2. In the side panel, choose **Generate DOM config** (the start screen's
   tile or the card under DOM Health).
3. Pick a scope:
   - **This page only** for one screen;
   - **Whole application: safe** to follow the application's links;
   - **Whole application: deep** to also click menus, tabs and tree items.
     It clicks on the live application, so use it on a test tenant.
4. Keep two runs per page unless values change only now and then; then
   use three or four. Leave the behavior probe on.
5. Start. The tab navigates and loads pages more than once: unsaved input
   can be lost. Stop builds a report from what was captured so far.

## 2. Add what the crawl cannot reach

The crawl never opens modals, fills forms or picks a record. For each such
state:

1. Open it on the page yourself.
2. In **Capture current state**, type a name for it (for example "Patient
   chart, allergies modal") and choose **Capture now**. The panel never
   clicks, navigates or reloads.
3. For a second run, reload the page yourself (or reopen the state), choose
   the run kind **after reload**, keep the same name and capture again.

A warning that the state looks the same as another page usually means the
modal had not opened yet, or that you captured the same screen twice.

Results of the console script can be added with **Import console script
results**: copy the script from there, run it in the page's console, and
paste each run's result (or choose the saved files). Each run that cannot
be read is listed with what is missing and what to do.

## 3. Review

- **Ignore conditions.** Rules proven by observation or pattern are
  included. Tick the rules that need review only after checking them on the
  application. Turn on **Guides target a specific record** only when the
  guides are written for one record.
- **Settings.** Each value says whether it was measured, derived or is
  Apty's default. Defaults are not findings.
- **Pages.** Open a page to see its runs and what changed between them.
- **Warnings.** Act on the warn-severity ones first. A page with one run
  cannot show a value changing: use **Capture another run**, which opens
  manual capture with that page's name.

## 4. Copy into Apty

Copy each value, each section as a table, or every section at once, and
enter them in Apty's DOM Settings screen. Export Markdown for the handover
and JSON to keep the engine report. Excluded rules are in no copy and no
export.

## Pages not captured

The **Coverage** tab lists the kinds of state SEs most often miss: entry
forms, detail pages, list and grid pages, modals and dialogs, pop-ups,
dropdown panels, tooltips, side panels, print and report views, embedded
documents and states reached only by clicking. For each one:

- capture it by hand (step 2) and mark it **captured**;
- mark it **not applicable** when the application has no such state;
- mark it **planned** when it will be captured later.

The marks are your statement; the engine does not check them. They appear
in the Markdown, and anything not captured or planned is listed at its
end.

## Iframes

The **Iframes** tab groups frames by kind. **Application iframes** that
need handling come first: they are part of the application and need
handling in Apty. A frame that was not analyzed says why; for an
application frame, open its page in a tab of its own and capture it there
(step 2) so its markup reaches the analysis. Extension and overlay frames
come from the capturing machine or a vendor, not the application.
