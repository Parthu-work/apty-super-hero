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
`content-4x` holds the 4.x file names the version check recognises.
