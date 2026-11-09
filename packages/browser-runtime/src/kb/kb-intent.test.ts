import { describe, expect, it } from "vitest";
import { hasSymptomWord, isBareHowTo, isMostlyNonLatin } from "./kb-intent.js";

describe("hasSymptomWord", () => {
  it.each([
    "the banner doesn't glow",
    "the tooltip flickers on hover",
    "the tour jumps to step 4",
    "the widget is slower since Monday",
    "the page lags when the launcher opens",
    "the browser freezes on save",
    "the tab hangs after login",
    "the survey repeats every day",
    "it shows again and again",
    "the beacon is invisible on dark pages",
    "the text is unreadable",
    "the image is cropped",
    "the checklist duplicates items",
    "clicking next does nothing",
    "nothing happens when I click the launcher",
    "the old title still shows",
    "no balloon appears on the field",
    "the announcement arrives late",
    "the results are inconsistent",
    "the panels differ between users",
    "the form was rejected",
    "the workflow skips step 2",
    "every user sees the panel",
    "the banner shows for everyone",
    "only some users get the tour",
    "横幅不发光",
    "the survey is blank for French users",
    "the launcher stopped working after the release",
    "the tooltip opens twice",
  ])("finds a symptom in %j", (text) => {
    expect(hasSymptomWord(text)).toBe(true);
  });

  it.each([
    "how do I configure the banner glow",
    "what is a segment",
  ])("finds none in %j", (text) => {
    expect(hasSymptomWord(text)).toBe(false);
  });
});

describe("isBareHowTo", () => {
  it.each([
    "how do I configure the banner glow",
    "How to set up a tooltip",
    "how can I change the launcher icon",
    "can I limit the panel to one group",
    "where is the setting for the survey locale",
    "where do I configure the environments",
    "what is the setting for tooltip triggers",
    "please, how do I publish a tour",
  ])("is a bare how-to: %j", (text) => {
    expect(isBareHowTo(text)).toBe(true);
  });

  it.each([
    "how do I stop the tooltip flickering",
    "how can I fix the tour that skips step 2",
    "the tooltip opens twice",
    "what does flow.json mean",
  ])("is not: %j", (text) => {
    expect(isBareHowTo(text)).toBe(false);
  });
});

describe("isMostlyNonLatin", () => {
  it("is true when more than half the letters are not Latin", () => {
    expect(isMostlyNonLatin("小部件没有显示")).toBe(true);
    expect(isMostlyNonLatin("widget 没有显示出来在页面上")).toBe(true);
    expect(isMostlyNonLatin("the widget is not showing 没有")).toBe(false);
    expect(isMostlyNonLatin("le widget ne s'affiche pas")).toBe(false);
    expect(isMostlyNonLatin("403")).toBe(false);
  });
});
