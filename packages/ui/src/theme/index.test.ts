import { afterEach, describe, expect, it, vi } from "vitest";
import { applyRememberedTheme, applyTheme } from "./index";

function prefersDark(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches }),
  });
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
  vi.restoreAllMocks();
});

describe("applyRememberedTheme", () => {
  it("paints the theme the page last showed before the saved setting loads", () => {
    applyTheme("dark");
    document.documentElement.classList.remove("dark");

    applyRememberedTheme();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("follows the system until a theme has been shown", () => {
    prefersDark(true);

    applyRememberedTheme();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("still applies a theme when storage can't be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    prefersDark(false);

    applyRememberedTheme();

    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});
