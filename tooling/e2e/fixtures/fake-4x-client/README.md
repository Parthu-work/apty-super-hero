# Fake 4.x Client (Injected mode)

`injected-player.js` stands in for a 4.x player injected into the page: it
fetches the synthetic 4.x content files (`app-urls.json`, `app-data.json`,
`feature-flag.json`, `flow.json`, `segments.json`, `rules.json`) from a
`tenant-…` path on the test page's own server, so the Agent's page network
capture sees them (KB-RAG K15 A). The files are the check-pack fixtures in
`packages/browser-runtime/src/apty/diagnosis/fixtures/content-4x`, with the
UAT environment's pattern pointed at the test server. No real content.

`four-x-evidence.e2e.test.mjs` inlines the script into its test page.
