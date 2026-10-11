import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30000,
    pool: "threads",
    sequence: {
      concurrent: false,
    },
    silent: true,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // Puppeteer tests require Chrome browser installation - run separately with: vitest run --config vitest.puppeteer.config.ts
      "**/*.puppeteer.test.ts",
    ],
    // `npm run test:coverage`: package-wide thresholds are a ratchet, set
    // one point below the measured value; they may only go up
    // (docs/development/coverage.md). The modules that enforce trust
    // boundaries (approvals, sender checks, cross-extension messages and
    // what network capture may record) keep their own stricter gate.
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/__tests__/**", "**/*.d.ts"],
      thresholds: {
        statements: 48,
        branches: 44,
        functions: 52,
        lines: 48,
        "src/{tools/approval,runtime/trusted-sender,apty/external-messaging,apty/network-capture-session,apty/session-snapshot,tools/network-capture}.ts":
          { statements: 88, branches: 78, functions: 85, lines: 90 },
      },
    },
  },
});
