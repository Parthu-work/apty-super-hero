/**
 * Emit JSON Schema for the contract's zod schemas, so a producer team that
 * doesn't use TypeScript/zod can still validate against the exact same
 * shapes. Uses zod v4's own built-in `z.toJSONSchema` — no extra dependency.
 *
 * Run with `pnpm gen:contract-schemas` from this package.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  clearResponseSchema,
  getLogsParamsSchema,
  getLogsResponseSchema,
  getNetworkParamsSchema,
  getNetworkResponseSchema,
  getResourceBodyParamsSchema,
  getResourceBodyResponseSchema,
  pingDataSchema,
  requestEnvelopeSchema,
  responseEnvelopeSchema,
  setCaptureParamsSchema,
  setCaptureResponseSchema,
} from "../src/contract.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(
  HERE,
  "..",
  "..",
  "..",
  "docs",
  "integrations",
  "apty",
  "schemas",
);

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  "request-envelope": requestEnvelopeSchema,
  "response-envelope": responseEnvelopeSchema,
  "ping-data": pingDataSchema,
  "get-logs-params": getLogsParamsSchema,
  "get-logs-response": getLogsResponseSchema,
  "get-network-params": getNetworkParamsSchema,
  "get-network-response": getNetworkResponseSchema,
  "get-resource-body-params": getResourceBodyParamsSchema,
  "get-resource-body-response": getResourceBodyResponseSchema,
  "set-capture-params": setCaptureParamsSchema,
  "set-capture-response": setCaptureResponseSchema,
  "clear-response": clearResponseSchema,
};

mkdirSync(OUT_DIR, { recursive: true });

for (const [name, schema] of Object.entries(SCHEMAS)) {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" });
  const outPath = join(OUT_DIR, `${name}.schema.json`);
  writeFileSync(outPath, `${JSON.stringify(jsonSchema, null, 2)}\n`, "utf8");
  console.log(`wrote ${outPath}`);
}
