var background = (() => {
  chrome.runtime.onMessageExternal.addListener(() => true);
  chrome.runtime.onMessage.addListener(() => true);
  return {};
})();
