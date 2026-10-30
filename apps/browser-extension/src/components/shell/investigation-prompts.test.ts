import { routeSymptom } from "@apty/browser-runtime/apty/diagnosis/router";
import { createTranslationFunction } from "@apty/ui/i18n/index";
import { describe, expect, it } from "vitest";
import { INVESTIGATION_PROMPTS } from "./investigation-prompts";

describe("INVESTIGATION_PROMPTS", () => {
  it("routes each preset the same in English and Chinese, so the language never decides whether a check or the model answers (6)", () => {
    const en = createTranslationFunction("en");
    const zh = createTranslationFunction("zh");

    for (const prompt of INVESTIGATION_PROMPTS) {
      expect([prompt.id, routeSymptom(zh(prompt.text))?.packId]).toEqual([
        prompt.id,
        routeSymptom(en(prompt.text))?.packId,
      ]);
    }
    expect(routeSymptom(en("investigation.welcome.widgetPrompt"))).toEqual({
      packId: "widget-not-visible",
    });
  });
});
