#!/usr/bin/env node
/**
 * Prints the size of each named request scenario, raw and as sent (system prompt, tool
 * schemas, history, tool results, total) in estimated tokens (chars / 4).
 * Runs apps/browser-extension's request-anatomy.scenarios.test.ts, which
 * writes the numbers as JSON, and renders them as a table. Pass `--json` for
 * the raw JSON.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const out = join(
  mkdtempSync(join(tmpdir(), "request-anatomy-")),
  "anatomy.json",
);

const run = spawnSync(
  "pnpm",
  [
    "--filter",
    "@apty/browser-extension",
    "exec",
    "vitest",
    "run",
    "src/hooks/request-anatomy.scenarios.test.ts",
  ],
  {
    cwd: ROOT,
    env: { ...process.env, REQUEST_ANATOMY_OUT: out },
    encoding: "utf8",
  },
);
if (run.status !== 0) {
  console.error(run.stdout, run.stderr);
  process.exit(run.status ?? 1);
}

const data = JSON.parse(readFileSync(out, "utf8"));
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

const cols = [
  ["scenario", "scenario"],
  ["tools", "toolCount"],
  ["system", "systemPromptTokens"],
  ["schemas", "toolSchemaTokens"],
  ["history", "historyTokens"],
  ["results", "toolResultTokens"],
  ["total", "totalTokens"],
];
function render(rows) {
  const table = rows.map((r) => cols.map(([, key]) => String(r[key])));
  const widths = cols.map(([label], i) =>
    Math.max(label.length, ...table.map((row) => row[i].length)),
  );
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [line(cols.map(([label]) => label)), ...table.map(line)].join("\n");
}

console.log("As built, before the outbound filters (raw):\n");
console.log(render(data.raw));
console.log("\nAs sent, after the outbound filters:\n");
console.log(render(data.sent));
if (data.budgeted) {
  const budgets = Object.keys(data.budgeted[0] ?? {}).filter((k) =>
    k.startsWith("budget"),
  );
  const head = ["scenario", "sent", ...budgets.map((k) => `at ${k.slice(6)}`)];
  const table = data.budgeted.map((row) => [
    row.scenario,
    String(data.sent.find((s) => s.scenario === row.scenario)?.totalTokens),
    ...budgets.map((k) => String(row[k])),
  ]);
  const widths = head.map((h, i) =>
    Math.max(h.length, ...table.map((r) => r[i].length)),
  );
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(
    "\nWith a request budget (Settings → AI), total sent or stopped:\n",
  );
  console.log([line(head), ...table.map(line)].join("\n"));
}
if (data.summaries) {
  console.log(
    "\nWith summaries of earlier turns (Settings → AI), as sent: the long chat after a summary at its length limit, and the summary request itself:\n",
  );
  console.log(render(data.summaries));
}
console.log(
  `\nregistry: ${data.registry.toolCount} tools, ${data.registry.toolSchemaTokens} schema tokens, system prompt ${data.registry.systemPromptTokens} tokens`,
);
