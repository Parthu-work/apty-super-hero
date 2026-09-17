import { zenfs } from "@apty/browser-runtime";
import { quickjs } from "@apty/browser-runtime/vm/quickjs-manager";
import { renderChatApp } from "../../components/app-root";

// Pre-initialize QuickJS and ZenFS on sidepanel startup so that
// the first skill execution doesn't incur a cold-start WASM load.
const initializeVM = async () => {
  try {
    await Promise.all([zenfs.initialize(), quickjs.initialize()]);
    console.log("[Sidepanel] QuickJS and ZenFS initialized");
  } catch (error) {
    console.error("[Sidepanel] Failed to initialize VM:", error);
  }
};

initializeVM();

renderChatApp();
