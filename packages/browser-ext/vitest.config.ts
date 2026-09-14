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
  },
  resolve: {
    alias: [
      { find: "~", replacement: path.resolve(__dirname, "./src") },
      { find: "@", replacement: path.resolve(__dirname, "./") },
      {
        find: "@aipexstudio/aipex-core",
        replacement: path.resolve(__dirname, "../core/src/index.ts"),
      },
      // Mirrors vite.config.ts: aipex-react's package.json exports map only
      // covers a subset of its subpaths (e.g. no "./lib/*"), but the real
      // extension build resolves straight to source via this same alias —
      // tests need the same resolution, not a narrower one, to match what
      // actually ships.
      {
        find: /^@aipexstudio\/aipex-react\/(.*)$/,
        replacement: path.resolve(__dirname, "../aipex-react/src/$1"),
      },
      {
        find: "@aipexstudio/aipex-react",
        replacement: path.resolve(__dirname, "../aipex-react/src/index.ts"),
      },
    ],
  },
});
