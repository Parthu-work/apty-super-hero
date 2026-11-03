import { chromeVersionFrom } from "@apty/browser-runtime/apty/validation-bundle";

/** The running Agent's version and build commit, and the Chrome version, for an exported bundle. */
export function agentBuild(): {
  agent: string;
  commit: string | null;
  chrome: string | null;
} {
  let agent = "unknown";
  try {
    agent = chrome.runtime.getManifest().version;
  } catch {
    // Not running as an extension (tests, a preview).
  }
  return {
    agent,
    commit: import.meta.env.VITE_APTY_AGENT_COMMIT || null,
    chrome: chromeVersionFrom(navigator.userAgent),
  };
}
