import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { STORAGE_KEYS } from "@apty/agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ChangeListener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => void;

const mockGet = vi.fn();
let changeListeners: ChangeListener[] = [];

(global as any).chrome = {
  storage: {
    local: { get: mockGet },
    onChanged: {
      addListener: (listener: ChangeListener) => changeListeners.push(listener),
    },
  },
};

import {
  currentRedactionMode,
  getRedactionMode,
  parseRedactionMode,
  previewRedaction,
  redactLogEntries,
  redactText,
  resetRedactionModeForTests,
} from "./redaction-mode";

const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const SAMPLE = JSON.stringify({
  page_title: "Chart for Jane Testpatient",
  username: "jtestpatient",
  segment: "sales",
  authorization: `Bearer ${JWT}`,
});

function storeMode(mode: unknown) {
  mockGet.mockResolvedValue({
    [STORAGE_KEYS.SETTINGS]: { redactionMode: mode },
  });
}

function emitChange(
  newValue: unknown,
  areaName = "local",
  key: string = STORAGE_KEYS.SETTINGS,
) {
  for (const listener of changeListeners) {
    listener({ [key]: { newValue } }, areaName);
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  changeListeners = [];
  resetRedactionModeForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getRedactionMode", () => {
  it.each([
    ["strict", "strict"],
    ["standard", "standard"],
    ["off", "off"],
    [undefined, "strict"],
    ["loose", "strict"],
  ])("reads %s from settings as %s", async (stored, expected) => {
    storeMode(stored);
    await expect(getRedactionMode()).resolves.toBe(expected);
  });

  it("is strict when settings cannot be read", async () => {
    mockGet.mockRejectedValue(new Error("Access to storage is not allowed"));
    await expect(getRedactionMode()).resolves.toBe("strict");
  });

  it("reads storage once and serves the cache after", async () => {
    storeMode("standard");
    await Promise.all([getRedactionMode(), getRedactionMode()]);
    await getRedactionMode();
    expect(currentRedactionMode()).toBe("standard");
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("is strict until the first read completes, which the sync accessor starts", async () => {
    storeMode("off");
    expect(currentRedactionMode()).toBe("strict");
    expect(mockGet).toHaveBeenCalledTimes(1);
    await getRedactionMode();
    expect(currentRedactionMode()).toBe("off");
  });

  it("follows a settings change without reading storage again", async () => {
    storeMode("strict");
    await getRedactionMode();

    emitChange({ redactionMode: "standard" });
    expect(currentRedactionMode()).toBe("standard");
    emitChange({});
    expect(currentRedactionMode()).toBe("strict");
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("ignores changes to other storage areas and keys", async () => {
    storeMode("standard");
    await getRedactionMode();

    emitChange({ redactionMode: "off" }, "session");
    emitChange({ redactionMode: "off" }, "local", "unrelated_key");
    expect(currentRedactionMode()).toBe("standard");
  });

  it("parses only the three known modes", () => {
    expect(parseRedactionMode("standard")).toBe("standard");
    expect(parseRedactionMode(42)).toBe("strict");
  });
});

describe("redactText and redactLogEntries", () => {
  it("mask page context in strict mode and keep it in standard", async () => {
    storeMode("strict");
    await getRedactionMode();
    const strict = redactText(SAMPLE);

    emitChange({ redactionMode: "standard" });
    const standard = redactText(SAMPLE);

    expect(strict).not.toContain("Jane Testpatient");
    expect(standard).toContain("Jane Testpatient");
    expect(standard).not.toContain("jtestpatient");
    expect(standard).toContain("sales");
  });

  it("keeps a JWT redacted in off mode", async () => {
    storeMode("off");
    await getRedactionMode();

    const off = redactText(SAMPLE);

    expect(off).toContain("jtestpatient");
    expect(off).not.toContain(JWT);
  });

  it("redact every log message in the current mode", async () => {
    storeMode("standard");
    await getRedactionMode();

    const [entry] = redactLogEntries([
      { level: "log", message: SAMPLE, timestamp: 1 },
    ]);

    expect(entry?.message).toContain("Jane Testpatient");
    expect(entry?.message).not.toContain(JWT);
    expect(entry?.level).toBe("log");
  });

  it("preview uses the mode it is given, not the stored one", async () => {
    storeMode("strict");
    await getRedactionMode();
    expect(previewRedaction(SAMPLE, "standard")).toContain("Jane Testpatient");
  });
});

describe("every redaction goes through this module", () => {
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const roots = [
    "packages/browser-runtime/src",
    "apps/browser-extension/src",
    "packages/ui/src",
    "packages/agent-core/src",
    "packages/dom-snapshot/src",
  ];
  const DIRECT_CALL =
    /\b(redactSensitiveText|redactLogs?|redactJsonAware|redactJsonValue|redactKnownKeysInText)\s*\(/;

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        return name === "node_modules" || name === "dist"
          ? []
          : sourceFiles(path);
      }
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)
        ? [path]
        : [];
    });
  }

  it("no source file calls the redaction library directly", () => {
    const offenders = roots
      .flatMap((root) => sourceFiles(join(repoRoot, root)))
      .filter((file) => !file.endsWith("runtime/redaction-mode.ts"))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .map((line, i) => ({
            line,
            at: `${relative(repoRoot, file)}:${i + 1}`,
          }))
          .filter(({ line }) => !/^\s*(\*|\/\/)/.test(line))
          .filter(({ line }) => DIRECT_CALL.test(line))
          .map(({ at, line }) => `${at}: ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });
});
