/**
 * KB-RAG K22: the E2E-only build that can take a test organization policy.
 * Playwright cannot set Chrome's managed storage, so this build (and only
 * this build, VITE_APTY_E2E_POLICY_SEAM=1) reads the policy from a
 * chrome.storage.local key the test writes. The production dist/ never holds
 * it (tooling/scripts/check-dist-policy.mjs, run by npm run build).
 *
 * The build lands in apps/browser-extension/dist-e2e and is redone when the
 * production build is newer; E2E_POLICY_EXTENSION_DIR points at another.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { extensionPage, ROOT } from "./harness.mjs";

/** The chrome.storage.local key the E2E build reads its policy from. */
export const E2E_POLICY_KEY = "apty-e2e-org-policy";

const OUT_DIR = "dist-e2e";

/** The E2E policy build's directory, built first if missing or older than dist/. */
export function ensurePolicyBuild() {
  if (process.env.E2E_POLICY_EXTENSION_DIR) {
    return process.env.E2E_POLICY_EXTENSION_DIR;
  }
  const dir = join(ROOT, "apps/browser-extension", OUT_DIR);
  const built = join(dir, "manifest.json");
  const production = join(ROOT, "apps/browser-extension/dist/manifest.json");
  const fresh =
    existsSync(built) &&
    (!existsSync(production) ||
      statSync(built).mtimeMs >= statSync(production).mtimeMs);
  if (!fresh) {
    execFileSync(
      "pnpm",
      [
        "--filter",
        "@apty/browser-extension",
        "exec",
        "vite",
        "build",
        "--outDir",
        OUT_DIR,
        "--emptyOutDir",
        "--logLevel",
        "warn",
      ],
      {
        cwd: ROOT,
        env: { ...process.env, VITE_APTY_E2E_POLICY_SEAM: "1" },
        stdio: "inherit",
      },
    );
  }
  return dir;
}

/** Sets the test policy (an object, or {} for none) as IT would deploy it. */
export async function setTestPolicy(browser, policy) {
  const page = await extensionPage(browser);
  await page.evaluate(
    ([key, value]) => chrome.storage.local.set({ [key]: value }),
    [E2E_POLICY_KEY, policy],
  );
  await page.close();
}
