# Check-pack fixtures

Synthetic Apty content files in the shapes the 5.x Client loads
(`tenant-<id>/app-<id>/env-<id>/<file>.json`), modelled on a real capture
with every name, ID, URL and person replaced. No customer data.

`content-5x` covers, among others: a visible workflow in an active segment,
one hidden from the widget, one in no segment, one linked only to a turned-off
segment, one whose segment's rule is missing, one with an empty feedback
message, one behind a visibility rule, a segment link to a workflow that is
not published, and a tooltip link to a tooltip that is not published. The
tooltip, launcher and validation carry stored elements (a picker, a CSS and
an XPath selector, and a disabled element), and
`workflow-0c000000-…-000000000002.json` holds "Take a tour"'s steps in the
shape the cards name, one of them with a generated-looking id.
`content-4x` holds synthetic files in the shapes the 4.x check packs read
(KB-RAG K14): `app-urls.json` (applications in file order, each with its
environments' URL patterns), `app-data.json` per environment
(`enablePlayer`, `widgetConfig.enabled`), `feature-flag.json` (the regex URL
flag), `flow.json` (a flow's `name` per locale and `hideInWidget`),
`segments.json` (`isActive`, `ruleId`, the `flows` each lists), `rules.json`
and `flow-18515.json` (one flow's steps). The shapes follow FIXES.md K14;
they are to be confirmed against apty-assist `player3.0`.
