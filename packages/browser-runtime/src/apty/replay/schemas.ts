/**
 * The least of each file's shape the checks rely on, written in the Agent
 * (never imported from Apty). Loose objects: a field Apty adds later is
 * kept, not a mismatch. A file with no schema here is not checked.
 */
import type { AptyVersion } from "@apty/agent-core";
import { z } from "zod";

const id = z.string().min(1);
const nullableNumber = z.number().nullable().optional();

const items = z.array(z.looseObject({ id, sourceId: id }));

const SCHEMAS_5X: Record<string, z.ZodType> = {
  "app-urls.json": z.array(
    z.looseObject({
      id,
      environments: z.array(
        z.looseObject({
          id,
          order: nullableNumber,
          urls: z.array(z.string()),
        }),
      ),
    }),
  ),
  "content-config.json": z.looseObject({}),
  "app-data.json": z.looseObject({
    id,
    config: z.looseObject({}).optional(),
  }),
  "tooltip.json": items,
  "workflow.json": items,
  "launcher.json": items,
  "announcement.json": items,
  "validation.json": items,
  "checklist.json": items,
  "knowledge-content.json": items,
  "segment.json": z.array(z.looseObject({ id, isActive: z.boolean() })),
  "rule.json": z.array(z.looseObject({ id })),
  "users/{userId}/widget-chat/chat-list.json": z.looseObject({
    chats: z.array(z.looseObject({ id })),
  }),
};

const SCHEMAS_4X: Record<string, z.ZodType> = {
  "content-config.json": z.looseObject({}),
  "app-urls.json": z.array(
    z.looseObject({
      id: z.union([z.string(), z.number()]),
      environments: z.record(z.string(), z.looseObject({ url: z.string() })),
    }),
  ),
  "app-data.json": z.looseObject({}),
  "segments.json": z.array(z.looseObject({})),
  "tooltip.json": z.array(z.looseObject({})),
  "flow.json": z.array(z.looseObject({})),
};

export type SchemaCheck =
  | { checked: false }
  | { checked: true; ok: true }
  | { checked: true; ok: false; issue: string };

/** Whether `json` has the shape the checks read from `specName` (the catalogue name). */
export function checkSchema(
  version: AptyVersion,
  specName: string,
  json: unknown,
): SchemaCheck {
  const schema = (version === "4.x" ? SCHEMAS_4X : SCHEMAS_5X)[specName];
  if (!schema) return { checked: false };
  const parsed = schema.safeParse(json);
  if (parsed.success) return { checked: true, ok: true };
  const first = parsed.error.issues[0];
  const where = first?.path.length ? first.path.join(".") : "(root)";
  return {
    checked: true,
    ok: false,
    issue: `${where}: ${first?.message ?? "unexpected shape"}`,
  };
}
