// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScriptingWidgetDiagnosticsProvider } from "./widget-diagnostics.js";

/** Runs the injected probe against this jsdom page, as chrome.scripting would. */
function stubScripting() {
  vi.stubGlobal("chrome", {
    scripting: {
      executeScript: vi.fn(
        async (injection: {
          func: (...args: unknown[]) => unknown;
          args?: unknown[];
        }) => [{ result: injection.func(...(injection.args ?? [])) }],
      ),
    },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("ScriptingWidgetDiagnosticsProvider DOM probe", () => {
  it("doesn't take the Agent's own injected nodes for the Apty Widget", async () => {
    stubScripting();
    document.body.innerHTML =
      '<div id="apty-agent-content-root"></div><div id="apty-agent-border-overlay"></div>';

    const status = await new ScriptingWidgetDiagnosticsProvider(
      async () => 1,
    ).getStatus();

    expect(status).toMatchObject({ domPresent: false });
  });

  it("still finds Widget markup by id or class", async () => {
    stubScripting();
    for (const html of [
      '<div id="apty-launcher"></div>',
      '<div class="apty-widget-root"></div>',
    ]) {
      document.body.innerHTML = html;

      const status = await new ScriptingWidgetDiagnosticsProvider(
        async () => 1,
      ).getStatus();

      expect(status, html).toMatchObject({ domPresent: true });
    }
  });
});
