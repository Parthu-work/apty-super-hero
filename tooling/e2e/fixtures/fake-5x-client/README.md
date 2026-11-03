# Fake 5.x Apty Client

A tiny stand-in for the 5.x Client's WXT Chrome build, with only what
`tooling/scripts/build-client-test-recorder.mjs` checks and changes: a
manifest with `player-config.json` and `window-script.js` web-accessible, a
classic background script whose IPC receiver takes every message and
answers none (like `chrome-background-transport.ts`), and a content script
that injects `window-script.js`. Synthetic ids and local URLs only.
