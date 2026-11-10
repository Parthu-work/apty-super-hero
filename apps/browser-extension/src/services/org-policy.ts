/**
 * The organization policy in the extension (KB-RAG K22, S1): IT deploys it
 * to Chrome's managed storage (docs/security/ORG_POLICY.md), and
 * `@apty/browser-runtime/runtime/org-policy` reads and parses it.
 *
 * Playwright cannot set managed storage, so an E2E build (and only an E2E
 * build: `VITE_APTY_E2E_POLICY_SEAM`, set by tooling/e2e/policy-build.mjs)
 * reads the policy from a chrome.storage.local key the test writes. In a
 * production build the condition is the literal `"" === "1"` and the whole
 * branch, key included, is dropped; org-policy-seam.test.ts checks dist/.
 */
import {
  loadOrgPolicy,
  setOrgPolicySource,
  watchOrgPolicy,
} from "@apty/browser-runtime/runtime/org-policy";

export { loadOrgPolicy, watchOrgPolicy };

/** Call once at the start of each extension page and the service worker. */
export function installOrgPolicySource(): void {
  if (import.meta.env.VITE_APTY_E2E_POLICY_SEAM === "1") {
    const key = "apty-e2e-org-policy";
    setOrgPolicySource({
      async read() {
        const stored = await chrome.storage.local.get(key);
        return stored[key] ?? {};
      },
      watch(onChange) {
        const listener = (changes: object, area: string) => {
          if (area === "local" && key in changes) onChange();
        };
        chrome.storage.onChanged.addListener(listener);
        return () => chrome.storage.onChanged.removeListener(listener);
      },
    });
  }
}
