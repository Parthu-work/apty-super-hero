# WP3. Privacy and data handling

**Status: item 1 partially done this round, as a WP1 dependency — the rest not started.**

Item 1's core fix (narrowing `PII_KEY_NAMES` so a bare `name` key is no
longer treated as PII) was pulled into this round because WP1's own
acceptance test depends on it (see `wp1-apty-integration.md`). The rest of
item 1 (a per-session "configuration endpoints: show raw" allow-list) and
items 2-5 below are not started.

1. **Fix the `name` over-redaction.** In `@apty/debug-contract` the PII
   profile must cover person keys only (`firstName`, `lastName`,
   `fullName`, `patientName`, `userName`, `displayName`, `email`, `phone`,
   `address`, `dob`, `ssn`, `mrn`, `patient*`), not a bare `name`. Add a
   per-session "configuration endpoints: show raw" allow-list (default:
   `client.app.apty.ai` configuration files) so configuration JSON is
   returned intact, while secrets stay redacted. Regression tests: the
   segments payload keeps every `name`; `{"username":"jane.doe"}` stays
   redacted; `user_id` becomes a stable pseudonym; page title, search and
   path are masked in `strict`.
2. **Bodies are opt-in everywhere.** Page-level body capture and Client
   bodies are off by default and enabled per session in Options with a URL
   deny-list (default: user-preference and identity endpoints). Resource
   names that look like IDs are pseudonymised.
3. **Options "Data handling" section:** mode (`strict` default,
   `standard`, `off` for development with confirmation and a persistent
   banner), bodies on/off, allow-list and deny-list editors, a "what will
   be sent" preview of the next LLM request (redacted), and exports (Copy,
   Download) that honour the mode and start with a header stating mode,
   time and coverage.
4. **Retention:** add a TTL for screenshots and conversations, a "Purge
   all local data" action, and a statement of exactly what is stored and
   what is sent to the LLM.
5. Keep JSON-aware redaction (valid JSON in, valid JSON out), ReDoS caps,
   the secret corpus tests, and apply redaction at the producer, on
   receipt, and at evidence write time.

**Gate:** segments, 403 and PII regression tests pass; nothing leaks in
`strict` mode; Data handling UI tests pass.
