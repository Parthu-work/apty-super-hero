`tooling/e2e/a11y-suite.mjs` runs [axe-core](https://github.com/dequelabs/axe-core)
on the built extension in Chromium, in the light and the dark theme, and
fails on any violation of impact `serious` or `critical`. Its tests are
grouped by surface (`panel-home`, `panel-chat`, `dom-config-run`,
`dom-config-views`, `dom-health`, `options`; the module's header lists what
each one opens), and each `tooling/e2e/a11y-<surface>-<theme>.e2e.test.mjs`
runs one surface in one theme in its own browser, so every file stays well
under the 180 s limit of `npm run test:e2e`. They cover, among others:

- the side panel: empty; with an approval prompt; after a tool result
  (thinking details open); with the investigation summary expanded; with
  the full response viewer open;
- every tab of the Options page, with an Apty Client connected.

It is part of `npm run test:e2e`, so CI runs it. No axe rule is disabled.
`runAxe(page)` in `tooling/e2e/harness.mjs` waits for CSS transitions to
finish first, so contrast is measured on the final colours, and the
failure message lists each node's markup and axe's reason.

## What the first run found, and the fixes (C3)

| Finding | Fix |
|---|---|
| Light `--muted-foreground` (#737373) at 4.34:1 on `--muted`, 3.86:1 on tinted cards | `oklch(0.5 0 0)` (#636363): at least 4.9:1 on every muted background found |
| Light `--success` text at 2.87:1 on its own tint | Green-800 `oklch(0.448 0.119 151.328)` |
| Dark destructive alert text at 1.97:1 | `dark:text-red-400` in the destructive `Alert` variant |
| Dark "Built-in" skill badge (`text-blue-600`) | `dark:text-blue-400` |
| Icon-only buttons with no name: show/hide API key, delete model, export/delete skill, reload skills, automation mode, the header's Menu and New chat, a recent chat's delete, the input's "+" menu | `aria-label` (and `aria-pressed` on the show/hide toggles); the delete-model button also shows on keyboard focus |
| Selects with no name: default model, provider type, the input's model picker | `aria-label`, or a `Label` bound with `htmlFor` |
| The approval prompt's `alertdialog` had no name | `aria-labelledby` its title |
| Skill upload: a `role="button"` wrapper around a file input (nested interactive), the input named only by `title` | The file input is the control, with an `aria-label`; the wrapper only takes drops and shows focus with `focus-within` |

## Adding a screen

Add it to its surface in `a11y-suite.mjs` (or add a surface and its two
theme files), bring it to the state a user sees, then
`assertNoSeriousViolations(page, "<where>")`. If a rule must be disabled,
pass it to `runAxe(page, { disableRules: [...] })` with a comment in the
test saying why, and list it in `REVIEW.md`.
