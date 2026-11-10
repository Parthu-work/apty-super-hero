import { createLogger } from "@apty/agent-core";
import { zenfs } from "@apty/browser-runtime";
import { loadSettings } from "@apty/browser-runtime/runtime/effective-settings";
import { getRedactionMode } from "@apty/browser-runtime/runtime/redaction-mode";
import { quickjs } from "@apty/browser-runtime/vm/quickjs-manager";
import { applyRememberedTheme } from "@apty/ui/theme/index";
import { renderChatApp } from "../../components/app-root";
import { initLogging } from "../../lib/logging";
import { kbEgressLog } from "../../services/kb-egress-log";
import { installOrgPolicySource } from "../../services/org-policy";

const log = createLogger("Sidepanel");

installOrgPolicySource();
initLogging();
// The KB send record keeps only the policy's retention (D-SEC6).
void kbEgressLog()
  .prune()
  .catch(() => undefined);
applyRememberedTheme();
// Read the redaction mode now, so the first tool result is redacted in it.
void getRedactionMode();

// Pre-initialize QuickJS and ZenFS on sidepanel startup so that the first
// skill execution doesn't incur a cold-start WASM load — but only when the
// skills feature is actually enabled (off by default, see
// packages/agent-core/src/config/settings.ts's skillExecutionEnabled doc
// comment for why). No point paying the WASM load cost, or even having the
// sandbox resident, for a feature that's off.
const initializeVM = async () => {
  try {
    const settings = await loadSettings();
    if (settings?.skillExecutionEnabled !== true) {
      log.debug("Skill execution disabled, skipping VM init");
      return;
    }
    await Promise.all([zenfs.initialize(), quickjs.initialize()]);
    log.debug("QuickJS and ZenFS initialized");
  } catch (error) {
    console.error("[Sidepanel] Failed to initialize VM:", error);
  }
};

initializeVM();

renderChatApp();
