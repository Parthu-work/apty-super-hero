# KB card drafts for the KB owner (KB-RAG K26)

Cards the check packs need and that are not published yet. Each draft, once
written, follows the card format: a symptom title, four layers of 600 to 750
characters each (under 3,000 in all), a Send-support list, and "Verified on:
5.x code at 4c406d5, not runtime-verified". When the KB owner publishes one,
the only code change is its page id in the card map (`cards-items.ts` for
Part T, `cards-4x.ts` for Part E).

**Status: partial.** The drafts are written from the player code, which was
not available (see [item-display-rules.md](../development/item-display-rules.md)
and [4x-element-rules.md](../development/4x-element-rules.md)), so none is
written yet. This file lists what was searched and what each needs.

## Published cards that already cover a rule (searched 13 and 15 Nov 2026)

Confluence searches of space JA by title (`tooltip` on 13 Nov; `launcher`
and `validation` on 15 Nov, after the first try answered 503) found these
answer cards. They are named here by page id and a description in our own
words; their titles and text stay in Confluence. Group pages ("RAG Cards:
…", 1496318526 for launchers, 1496645655 for validations), routing pages,
"KB:" and Code Info pages and 4.x reference pages are left out: a verdict
cites none of them.

```text
space = JA AND type = page AND title ~ "launcher"
space = JA AND type = page AND title ~ "validation"
```

| Page id | What it covers, in our words | Use for |
| --- | --- | --- |
| 1496907796 | The item's selector is valid in Studio, yet the launcher or tooltip never shows | The element rule (the resolver element-not-found runs) |
| 1496612940 | A tooltip is missing in one part of the application while the widget shows | The page or URL scope rule |
| 1496286257 | What to copy for support for these item kinds | The verdict's Send-support step |
| 1496875063 | The item shows for one person and not another, with an older extension | "Not checked here" (the other person's extension) |
| 1496351633 | Every tooltip stops after a browser update or policy change | "Not checked here" (the browser) |
| 1496776771 | A published launcher is missing, or clicking it does nothing, because the content it opens is unpublished | The launcher's linked-content rule (publication of what it opens) |
| 1496286153 | A launcher is missing for some users, or does not start its content, because its segments and its content's differ | The segments rule, for launchers |
| 1496973411 | A validation on a field in a dynamic table does not update when the table's value changes | A validation-evaluation rule (when the rule is evaluated) |
| 1496645763 | Custom validations or scripts fail inside a cross-origin iframe | The validation's frame rule, or "not checked here" where the Agent cannot read the frame |
| 1496318576 | Launchers for two page languages both show, and only one per language is wanted | Not a "does not appear" cause: a configuration question, not cited by item-not-showing |
| 1496253406 | A routing page for tooltips, launchers and announcements | Never cited by a verdict (routing only) |
| 1496776891 | A routing page for validations and custom scripts | Never cited by a verdict (routing only) |
| 1496842241 | The workflow missing from the widget list | content-not-visible cites it today for every kind; D-CHK1 stops that for these three kinds |

## Drafts still needed

| Draft | Kind | Needs first |
| --- | --- | --- |
| `draft:tooltip-does-not-appear` | Symptom card | T0's trigger and per-user rows |
| `draft:launcher-does-not-appear` | Symptom card, for the causes no card above covers (the element, linked content and segments have cards) | T0's launcher rows (placement, anything that hides the icon) |
| `draft:validation-does-not-fire` | Symptom card, for the causes no card above covers (dynamic tables and cross-origin iframes have cards) | T0's validation rows (the field rule, when it is evaluated, what stops it) |
| `draft:mirror-tooltip-json` | Mirror card for `tooltip.json` | T0's field list |
| `draft:mirror-launcher-json` | Mirror card for `launcher.json` | T0's field list |
| `draft:mirror-validation-json` | Mirror card for `validation.json` | T0's field list |

What the KB owner does for each draft: review it, publish it in JA with the
`rag-card` conventions, and send its page id so it replaces `draft:<slug>` in
the card map; until then a rule citing it is capped at "possible" and shows
"No KB card yet" (D-CHK2).
