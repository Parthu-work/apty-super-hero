export type OptionsTab = "general" | "ai" | "skills" | "connection";

/** Section anchors on the Options page, keyed by the tab that shows them. */
export const OPTIONS_SECTIONS = {
  "data-handling": "general",
  troubleshooting: "general",
  "ai-provider": "ai",
  "apty-client": "connection",
  "mcp-bridge": "connection",
  permissions: "general",
  approvals: "general",
  "stored-data": "general",
} as const satisfies Record<string, OptionsTab>;

export type OptionsSection = keyof typeof OPTIONS_SECTIONS;

const OPTIONS_PATH = "src/entrypoints/options/index.html";

export const OPTIONS_NAVIGATE_MESSAGE = "apty-options-navigate";

export interface OptionsNavigateMessage {
  type: typeof OPTIONS_NAVIGATE_MESSAGE;
  tab?: OptionsTab;
  section?: OptionsSection;
}

export function isOptionsNavigateMessage(
  message: unknown,
): message is OptionsNavigateMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === OPTIONS_NAVIGATE_MESSAGE
  );
}

export function optionsUrl(
  target: { tab?: OptionsTab; section?: OptionsSection } = {},
): string {
  const tab =
    target.tab ??
    (target.section ? OPTIONS_SECTIONS[target.section] : undefined);
  const query = tab ? `?tab=${tab}` : "";
  const hash = target.section ? `#${target.section}` : "";
  return chrome.runtime.getURL(`${OPTIONS_PATH}${query}${hash}`);
}

/**
 * Open the Options page at a tab and section. An Options tab that is
 * already open is focused and navigated in place, without a reload, so
 * unsaved edits on it survive.
 */
export async function openOptions(
  target: { tab?: OptionsTab; section?: OptionsSection } = {},
): Promise<void> {
  const url = optionsUrl(target);
  const base = chrome.runtime.getURL(OPTIONS_PATH);
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.url?.startsWith(base));
  if (existing?.id === undefined) {
    await chrome.tabs.create({ url });
    return;
  }
  await chrome.tabs.update(existing.id, { active: true });
  if (existing.windowId !== undefined) {
    await chrome.windows.update(existing.windowId, { focused: true });
  }
  const tab =
    target.tab ??
    (target.section ? OPTIONS_SECTIONS[target.section] : undefined);
  const handled = await chrome.runtime
    .sendMessage({
      type: OPTIONS_NAVIGATE_MESSAGE,
      tab,
      section: target.section,
    } satisfies OptionsNavigateMessage)
    .catch(() => false);
  if (handled !== true) await chrome.tabs.update(existing.id, { url });
}
