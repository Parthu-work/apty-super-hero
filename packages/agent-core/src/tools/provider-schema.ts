/**
 * Tool input schemas as each AI provider accepts them (KB-RAG K25, A1).
 *
 * Providers accept different subsets of JSON Schema for strict tool use. The
 * rewrite only changes what is sent: every tool still validates its input
 * with its own Zod schema when it runs, so a limit removed here is still
 * enforced; it moves into the property's description so the model keeps
 * seeing it.
 */

type SchemaNode = Record<string, unknown>;

export type SchemaProvider =
  | "anthropic"
  | "groq"
  | "openai"
  | "google"
  | "openai-compatible";

export interface ProviderSchemaRules {
  /** Keywords removed from every schema node, their limit moved to the description. */
  readonly unsupportedKeywords: readonly string[];
  /** `minItems` above this value is removed (Anthropic accepts 0 and 1). */
  readonly maxSupportedMinItems?: number;
  /** A tool whose schema has no properties is sent without `strict`. */
  readonly noStrictWithoutProperties?: boolean;
  /** Strict needs `additionalProperties: false` (or absent) on every object. */
  readonly strictNeedsClosedObjects?: boolean;
}

/**
 * Anthropic strict tool use ("Structured outputs", JSON Schema limitations,
 * https://platform.claude.com/docs/en/build-with-claude/structured-outputs):
 * numerical constraints (`minimum`, `maximum`, `exclusiveMinimum`,
 * `exclusiveMaximum`, `multipleOf`), string constraints (`minLength`,
 * `maxLength`), complex array constraints (`maxItems`, `minItems` other than
 * 0 or 1) and `additionalProperties` other than `false` are not supported;
 * a request offering such a tool fails with a 400.
 */
const ANTHROPIC: ProviderSchemaRules = {
  unsupportedKeywords: [
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "maxItems",
  ],
  maxSupportedMinItems: 1,
  strictNeedsClosedObjects: true,
};

/**
 * Groq rejects a strict function whose parameters have no properties
 * ("'required' present but 'properties' is missing") and accepts the same
 * schema without `strict`.
 */
const GROQ: ProviderSchemaRules = {
  unsupportedKeywords: [],
  noStrictWithoutProperties: true,
};

/**
 * OpenAI's strict function calling ("Structured Outputs", supported schemas,
 * https://platform.openai.com/docs/guides/structured-outputs) supports the
 * numeric, string and array limits the tools use, and Google's function
 * declarations take an OpenAPI schema with the same limits
 * (https://ai.google.dev/api/caching#Schema). No documented limit applies.
 */
const NONE: ProviderSchemaRules = { unsupportedKeywords: [] };

export const PROVIDER_SCHEMA_RULES: Readonly<
  Record<SchemaProvider, ProviderSchemaRules>
> = {
  anthropic: ANTHROPIC,
  groq: GROQ,
  openai: NONE,
  google: NONE,
  "openai-compatible": NONE,
};

export interface RewrittenToolSchema {
  readonly schema: unknown;
  /** False when the schema still cannot be strict for this provider. */
  readonly strict: boolean;
  /** Paths whose keywords were removed, e.g. `$.properties.topK: minimum, maximum`. */
  readonly removed: readonly string[];
}

const UNBOUNDED = Number.MAX_SAFE_INTEGER;

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function itemNoun(node: SchemaNode, count: number): string {
  const items = node.items as SchemaNode | undefined;
  const type = items?.type;
  const noun =
    type === "number" || type === "integer"
      ? "number"
      : type === "string"
        ? "string"
        : "item";
  return count === 1 ? noun : `${noun}s`;
}

function range(
  min: number | undefined,
  max: number | undefined,
  unit: (n: number) => string,
): string | undefined {
  if (min !== undefined && max !== undefined) {
    return min === max
      ? `exactly ${min}${unit(min)}`
      : `${min} to ${max}${unit(max)}`;
  }
  if (min !== undefined) return `at least ${min}${unit(min)}`;
  if (max !== undefined) return `at most ${max}${unit(max)}`;
  return undefined;
}

/** The removed limits of one node, in plain words. */
function describeLimits(node: SchemaNode, removed: Set<string>): string[] {
  const words: string[] = [];
  const pick = (key: string): number | undefined => {
    const value = node[key];
    return removed.has(key) && isNumber(value) ? value : undefined;
  };
  const maxValue = pick("maximum");
  const numeric = range(
    pick("minimum"),
    maxValue === UNBOUNDED ? undefined : maxValue,
    () => "",
  );
  if (numeric) words.push(numeric);
  const exclusiveMin = pick("exclusiveMinimum");
  if (exclusiveMin !== undefined) words.push(`greater than ${exclusiveMin}`);
  const exclusiveMax = pick("exclusiveMaximum");
  if (exclusiveMax !== undefined) words.push(`less than ${exclusiveMax}`);
  const multiple = pick("multipleOf");
  if (multiple !== undefined) words.push(`a multiple of ${multiple}`);
  const length = range(pick("minLength"), pick("maxLength"), (n) =>
    n === 1 ? " character" : " characters",
  );
  if (length) words.push(length);
  const count = range(
    pick("minItems"),
    pick("maxItems"),
    (n) => ` ${itemNoun(node, n)}`,
  );
  if (count) words.push(count);
  return words;
}

function withLimitsInDescription(node: SchemaNode, words: string[]): void {
  if (words.length === 0) return;
  const limits = words.join(", ");
  const description =
    typeof node.description === "string" ? node.description.trim() : "";
  if (description.includes(limits)) return;
  node.description = description ? `${description} (${limits})` : limits;
}

/**
 * A copy of `schema` without the keywords `rules` rejects, each removed limit
 * appended in words to the description of the node that had it, or, for a
 * node inside `anyOf`, of the property that holds it.
 */
export function rewriteToolSchema(
  schema: unknown,
  rules: ProviderSchemaRules,
): RewrittenToolSchema {
  const removed: string[] = [];
  let closed = true;

  const visit = (
    value: unknown,
    path: string,
    owner: SchemaNode | undefined,
  ): unknown => {
    if (Array.isArray(value)) {
      return value.map((item, i) => visit(item, `${path}[${i}]`, owner));
    }
    if (!value || typeof value !== "object") return value;
    const node: SchemaNode = { ...(value as SchemaNode) };
    const dropped = new Set<string>();
    for (const key of rules.unsupportedKeywords) {
      if (key in node) dropped.add(key);
    }
    if (
      rules.maxSupportedMinItems !== undefined &&
      isNumber(node.minItems) &&
      node.minItems > rules.maxSupportedMinItems
    ) {
      dropped.add("minItems");
    }
    if (
      rules.strictNeedsClosedObjects &&
      "additionalProperties" in node &&
      node.additionalProperties !== false
    ) {
      closed = false;
    }
    const words = describeLimits(node, dropped);
    for (const key of dropped) delete node[key];
    if (dropped.size > 0) removed.push(`${path}: ${[...dropped].join(", ")}`);

    const target =
      typeof node.description === "string" || !owner ? node : owner;
    withLimitsInDescription(target, words);

    for (const [key, child] of Object.entries(node)) {
      if (key === "description" || key === "enum" || key === "const") continue;
      if (key === "properties" && child && typeof child === "object") {
        node.properties = Object.fromEntries(
          Object.entries(child as SchemaNode).map(([name, property]) => [
            name,
            visit(property, `${path}.properties.${name}`, undefined),
          ]),
        );
        continue;
      }
      const childOwner = key === "anyOf" || key === "oneOf" ? node : undefined;
      node[key] = visit(child, `${path}.${key}`, childOwner);
    }
    return node;
  };

  const rewritten = visit(schema, "$", undefined);
  const noProperties = hasNoProperties(rewritten);
  return {
    schema: rewritten,
    strict: closed && !(rules.noStrictWithoutProperties && noProperties),
    removed,
  };
}

/** True when a tool's JSON schema declares no properties (empty or absent). */
export function hasNoProperties(schema: unknown): boolean {
  const properties = (schema as { properties?: unknown } | null)?.properties;
  return (
    !properties ||
    typeof properties !== "object" ||
    Object.keys(properties).length === 0
  );
}

/**
 * Every keyword in `schema` that `rules` rejects, by path: empty when the
 * provider accepts the schema as sent.
 */
export function schemaViolations(
  schema: unknown,
  rules: ProviderSchemaRules,
  path = "$",
): string[] {
  if (Array.isArray(schema)) {
    return schema.flatMap((item, i) =>
      schemaViolations(item, rules, `${path}[${i}]`),
    );
  }
  if (!schema || typeof schema !== "object") return [];
  const node = schema as SchemaNode;
  const here = rules.unsupportedKeywords
    .filter((key) => key in node)
    .map((key) => `${path}.${key}`);
  if (
    rules.maxSupportedMinItems !== undefined &&
    isNumber(node.minItems) &&
    node.minItems > rules.maxSupportedMinItems
  ) {
    here.push(`${path}.minItems`);
  }
  return [
    ...here,
    ...Object.entries(node)
      .filter(([key]) => key !== "enum" && key !== "const")
      .flatMap(([key, value]) =>
        schemaViolations(value, rules, `${path}.${key}`),
      ),
  ];
}
