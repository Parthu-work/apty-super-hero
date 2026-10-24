# WP7. UI, navigation and DOM Health

**Status: not started this round.** This is where the "two audiences"
JSON tree viewer (WP1 item 4) would get its actual chat/evidence-panel UI
component — the backend split it depends on (bounded model summary, full
evidence, `get_evidence_json`) was built this round; the viewer itself was
not.

Covers: Settings/Setup rebuild (real inline form, centered layout, no
horizontal scroll, selected-tab highlight proven by a computed-style
test); in-panel hash router with shared header and Back/Undo; chat header
chips for Client connection state and bound-tab state; an Apty Integration
tab showing this extension's own ID, step-by-step Test connection with
remediation snippets; DOM Health per-frame diagnostics and actions; chat
surface polish (message actions, one status/error card component,
collapsed tool cards with a JSON viewer, log viewer, network table,
skeleton/empty/error states, reduced motion, long-chat virtualization); a
full UI audit sweep matrix (every screen/state × 6 viewport sizes × light/
dark) with CI gates (screenshot baselines, axe, console-error-fails,
no-horizontal-scroll).

**Gate:** matrix with zero fails; Back/router e2e; axe clean.
