# KB card drafts for the KB owner (KB-RAG K26)

Cards the check packs need and that are not published yet. Each draft, once
written, follows the card format: a symptom title, four layers of 600 to 750
characters each (under 3,000 in all), a Send-support list, and "Verified on:
5.x code at 4c406d5, not runtime-verified". When the KB owner publishes one,
the only code change is its page id in the card map (`cards-items.ts` for
Part T, `cards-4x.ts` for Part E).

**Status: partial.** The drafts are written from the player code, which was
not available (see [item-display-rules.md](../development/item-display-rules.md)
and `docs/development/4x-element-rules.md` on the Part E branch), so none is
written yet. This file lists what was searched and what each needs.

## Published cards that already cover a rule (searched 13 Nov 2026)

A Confluence search of space JA for tooltip cards found these. They are named
here by page id and a description in our own words; their titles and text
stay in Confluence. The search for launcher and validation cards could not be
completed (the Confluence API answered 503); run it again before writing a
draft:

```text
space = JA AND type = page AND title ~ "RAG Card" AND (title ~ "launcher" OR title ~ "validation")
```

| Page id | What it covers, in our words | Use for |
| --- | --- | --- |
| 1496907796 | The item's selector is valid in Studio, yet the launcher or tooltip never shows | The element rule (the resolver element-not-found runs) |
| 1496612940 | A tooltip is missing in one part of the application while the widget shows | The page or URL scope rule |
| 1496286257 | What to copy for support for these item kinds | The verdict's Send-support step |
| 1496875063 | The item shows for one person and not another, with an older extension | "Not checked here" (the other person's extension) |
| 1496351633 | Every tooltip stops after a browser update or policy change | "Not checked here" (the browser) |
| 1496253406 | A routing page for these kinds | Never cited by a verdict (routing only) |
| 1496842241 | The workflow missing from the widget list | content-not-visible cites it today for every kind; D-CHK1 stops that for these three kinds |

## Drafts still needed

| Draft | Kind | Needs first |
| --- | --- | --- |
| `draft:tooltip-does-not-appear` | Symptom card | T0's trigger and per-user rows |
| `draft:launcher-does-not-appear` | Symptom card | T0's launcher rows, and the launcher card search above |
| `draft:validation-does-not-fire` | Symptom card | T0's validation rows, and the validation card search above |
| `draft:mirror-tooltip-json` | Mirror card for `tooltip.json` | T0's field list |
| `draft:mirror-launcher-json` | Mirror card for `launcher.json` | T0's field list |
| `draft:mirror-validation-json` | Mirror card for `validation.json` | T0's field list |

What the KB owner does for each draft: review it, publish it in JA with the
`rag-card` conventions, and send its page id so it replaces `draft:<slug>` in
the card map; until then a rule citing it is capped at "possible" and shows
"No KB card yet" (D-CHK2).
