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
    // `npm run test:coverage` gates the modules that enforce trust
    // boundaries: approvals, sender checks, cross-extension messages and
    // what network capture may record.
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      include: [
        "src/tools/approval.ts",
        "src/runtime/trusted-sender.ts",
        "src/apty/external-messaging.ts",
        "src/apty/network-capture-session.ts",
        "src/apty/session-snapshot.ts",
        "src/tools/network-capture.ts",
      ],
      thresholds: { statements: 88, branches: 78, functions: 85, lines: 90 },
    },
  },
});
