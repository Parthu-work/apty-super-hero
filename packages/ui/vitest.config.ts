import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resolvePath = (...parts: string[]) => resolve(__dirname, ...parts);

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
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
        statements: 43,
        branches: 32,
        functions: 41,
        lines: 43,
      },
    },
  },
  resolve: {
    alias: {
      "@apty/agent-core": resolvePath("../agent-core/src/index.ts"),
    },
  },
});
