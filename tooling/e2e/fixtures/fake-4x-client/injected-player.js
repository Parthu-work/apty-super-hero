// A synthetic 4.x player in Injected mode (KB-RAG K15 A): the page itself
// fetches the tenant's content files, so the Agent's network capture of
// the tab sees them. The files are the synthetic ones in
// packages/browser-runtime/src/apty/diagnosis/fixtures/content-4x.
(async () => {
  const base = "/tenant-4x/app-301/env-3012";
  for (const name of [
    "app-urls.json",
    "app-data.json",
    "feature-flag.json",
    "flow.json",
    "segments.json",
    "rules.json",
  ]) {
    await fetch(`${base}/${name}`).catch(() => undefined);
  }
})();
