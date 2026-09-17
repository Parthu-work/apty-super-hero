/** Keyboard command handling (Ctrl/Cmd+M -> open the Apty Agent command menu). */

export function registerCommandHandlers(): void {
  chrome.commands.onCommand.addListener((command) => {
    if (command === "open-apty-agent") {
      // Get the active tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          // Send message to content script to open omni
          chrome.tabs
            .sendMessage(tabs[0].id, { request: "open-apty-agent" })
            .catch((error) => {
              console.error("Failed to send message to content script:", error);
            });
        }
      });
    }
  });
}
