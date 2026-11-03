const script = document.createElement("script");
script.src = chrome.runtime.getURL("window-script.js");
(document.head ?? document.documentElement).appendChild(script);
