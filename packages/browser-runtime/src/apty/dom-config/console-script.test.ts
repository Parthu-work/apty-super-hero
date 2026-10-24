// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { DOM_CONFIG_CONSOLE_SCRIPT } from "./console-script";
import { parseDomProfile } from "./import-profile";

function runScript(): string {
  const copied: string[] = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  new Function("copy", DOM_CONFIG_CONSOLE_SCRIPT)((text: string) =>
    copied.push(text),
  );
  expect(copied).toHaveLength(1);
  return copied[0]!;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("DOM_CONFIG_CONSOLE_SCRIPT", () => {
  it("produces a profile the import accepts", () => {
    document.body.innerHTML = `
      <main id="ui-id-7" class="panel RptTable">
        <div id="toast" style="position: fixed; z-index: 9999">t</div>
        <x-card id="card"></x-card>
      </main>
      <apty-widget><div class="tip" data-apty-step="s1">tip</div></apty-widget>`;
    document.getElementById("card")!.attachShadow({ mode: "open" }).innerHTML =
      '<button class="card-action">Open</button>';

    const text = runScript();
    const raw = JSON.parse(text);
    expect(raw.attributes.id).toMatchObject({ "ui-id-7": 1, toast: 1 });
    expect(raw.maxZIndex).toBe(9999);
    expect(raw.shadowRoots["x-card"].attributes.class).toEqual({
      "card-action": 1,
    });

    const result = parseDomProfile(text);
    expect(result).toMatchObject({ ok: true, aptyPresent: true });
  });
});
