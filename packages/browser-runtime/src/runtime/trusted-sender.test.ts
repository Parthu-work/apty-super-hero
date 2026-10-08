import { beforeEach, describe, expect, it } from "vitest";
import { isOwnExtensionPage } from "./trusted-sender";

const OWN_ID = "bpiondflhhdplemamgggcdajclmoeple";
const tab = { id: 4 } as chrome.tabs.Tab;

beforeEach(() => {
  (global as any).chrome = { runtime: { id: OWN_ID } };
});

describe("isOwnExtensionPage", () => {
  it.each([
    [
      "the side panel",
      {
        id: OWN_ID,
        url: `chrome-extension://${OWN_ID}/src/entrypoints/sidepanel/index.html`,
      },
    ],
    [
      "the options page, which opens in a tab",
      {
        id: OWN_ID,
        tab,
        url: `chrome-extension://${OWN_ID}/src/entrypoints/options/index.html`,
      },
    ],
    [
      "the service worker",
      {
        id: OWN_ID,
        url: `chrome-extension://${OWN_ID}/service-worker-loader.js`,
      },
    ],
  ])("trusts %s", (_label, sender) => {
    expect(isOwnExtensionPage(sender)).toBe(true);
  });

  it.each([
    [
      "a content script",
      { id: OWN_ID, tab, url: "https://bank.example/account" },
    ],
    [
      "a content script in an about:blank frame",
      { id: OWN_ID, tab, url: "about:blank", origin: "https://bank.example" },
    ],
    [
      "another extension",
      {
        id: "a".repeat(32),
        url: `chrome-extension://${"a".repeat(32)}/page.html`,
      },
    ],
    [
      "a look-alike origin",
      { id: OWN_ID, url: `chrome-extension://${OWN_ID}.evil/page.html` },
    ],
    ["a sender without a url", { id: OWN_ID }],
  ])("rejects %s", (_label, sender) => {
    expect(isOwnExtensionPage(sender)).toBe(false);
  });
});
