import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    passWithNoTests: true,
    silent: true,
    css: {
      modules: {
        classNameStrategy: "non-scoped",
      },
    },
    sequence: {
      concurrent: false,
    },
    server: {
      deps: {
        inline: [/katex/, /streamdown/],
      },
    },
    exclude: ["**/node_modules/**", "**/dist/**"],
    // `npm run test:coverage`: package-wide thresholds are a ratchet, set
    // one point below the measured value. They may only go up
    // (docs/development/coverage.md).
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/__tests__/**", "**/*.d.ts"],
      thresholds: {
        statements: 42,
        branches: 43,
        functions: 40,
        lines: 42,
      },
    },
  },
  resolve: {
    alias: [
      { find: "~", replacement: path.resolve(__dirname, "./src") },
      { find: "@", replacement: path.resolve(__dirname, "./") },
      {
        find: "@apty/agent-core",
        replacement: path.resolve(
          __dirname,
          "../../packages/agent-core/src/index.ts",
        ),
      },
      // Mirrors vite.config.ts: ai-provider.ts imports the pure SSRF-range
      // helpers from this subpath specifically to avoid pulling in the full
      // browser-runtime barrel (which has module-scope side effects, e.g.
      // ConversationStorage touching IndexedDB, unavailable in this test
      // environment). Tests need the same subpath resolution the real
      // build uses, not the barrel.
      {
        find: /^@apty\/browser-runtime\/(.*)$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/browser-runtime/src/$1",
        ),
      },
      // Mirrors vite.config.ts: ui's package.json exports map only
      // covers a subset of its subpaths (e.g. no "./lib/*"), but the real
      // extension build resolves straight to source via this same alias —
      // tests need the same resolution, not a narrower one, to match what
      // actually ships.
      {
        find: /^@apty\/dom-snapshot\/(.*)$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/dom-snapshot/src/$1",
        ),
      },
      {
        find: "@apty/dom-snapshot",
        replacement: path.resolve(
          __dirname,
          "../../packages/dom-snapshot/src/index.ts",
        ),
      },
      {
        find: /^@apty\/ui\/(.*)$/,
        replacement: path.resolve(__dirname, "../../packages/ui/src/$1"),
      },
      {
        find: "@apty/ui",
        replacement: path.resolve(__dirname, "../../packages/ui/src/index.ts"),
      },
    ],
  },
});
