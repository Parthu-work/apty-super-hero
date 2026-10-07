import type { AppSettings } from "@apty/agent-core";
import { STORAGE_KEYS } from "@apty/agent-core";
import { ChromeStorageAdapter, zenfs } from "@apty/browser-runtime";
import { quickjs } from "@apty/browser-runtime/vm/quickjs-manager";
import { renderChatApp } from "../../components/app-root";

// Pre-initialize QuickJS and ZenFS on sidepanel startup so that the first
// skill execution doesn't incur a cold-start WASM load — but only when the
// skills feature is actually enabled (off by default, see
// packages/agent-core/src/config/settings.ts's skillExecutionEnabled doc
// comment for why). No point paying the WASM load cost, or even having the
// sandbox resident, for a feature that's off.
const initializeVM = async () => {
  try {
    const settings = await new ChromeStorageAdapter<AppSettings>().load(
      STORAGE_KEYS.SETTINGS,
    );
    if (settings?.skillExecutionEnabled !== true) {
      console.log("[Sidepanel] Skill execution disabled, skipping VM init");
      return;
    }
    await Promise.all([zenfs.initialize(), quickjs.initialize()]);
    console.log("[Sidepanel] QuickJS and ZenFS initialized");
  } catch (error) {
    console.error("[Sidepanel] Failed to initialize VM:", error);
  }
};

initializeVM();

renderChatApp();
