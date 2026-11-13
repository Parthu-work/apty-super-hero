import { describe, expect, it } from "vitest";
import {
  PROVIDER_SCHEMA_RULES,
  rewriteToolSchema,
  schemaViolations,
} from "./provider-schema.js";

const anthropic = PROVIDER_SCHEMA_RULES.anthropic;

describe("rewriteToolSchema for Anthropic", () => {
  it("removes bounded integers and states the range in the description", () => {
    const { schema, strict, removed } = rewriteToolSchema(
      {
        type: "object",
        properties: {
          topK: {
            type: "integer",
            minimum: 1,
            maximum: 5,
            description: "How many chunks.",
          },
        },
        required: ["topK"],
        additionalProperties: false,
      },
      anthropic,
    );
    expect(schema).toEqual({
      type: "object",
      properties: {
        topK: { type: "integer", description: "How many chunks. (1 to 5)" },
      },
      required: ["topK"],
      additionalProperties: false,
    });
    expect(strict).toBe(true);
    expect(removed).toEqual(["$.properties.topK: minimum, maximum"]);
    expect(schemaViolations(schema, anthropic)).toEqual([]);
  });

  it("moves a limit inside anyOf to the property's description", () => {
    const { schema } = rewriteToolSchema(
      {
        type: "object",
        properties: {
          query: {
            description: "The question",
            anyOf: [{ type: "string", maxLength: 300 }, { type: "null" }],
          },
        },
      },
      anthropic,
    );
    expect(schema).toMatchObject({
      properties: {
        query: {
          description: "The question (at most 300 characters)",
          anyOf: [{ type: "string" }, { type: "null" }],
        },
      },
    });
  });

  it.each([
    [{ type: "string", minLength: 1 }, "at least 1 character"],
    [{ type: "string", minLength: 4, maxLength: 4 }, "exactly 4 characters"],
    [
      { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
      "exactly 2 numbers",
    ],
    [{ type: "array", items: {}, maxItems: 4 }, "at most 4 items"],
    [
      { type: "integer", exclusiveMinimum: 0, maximum: 50 },
      "at most 50, greater than 0",
    ],
    [
      { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      "at least 0",
    ],
    [{ type: "number", multipleOf: 5 }, "a multiple of 5"],
  ])("states %j as %s", (property, words) => {
    const { schema } = rewriteToolSchema(
      { type: "object", properties: { p: property } },
      anthropic,
    );
    const sent = (schema as { properties: { p: Record<string, unknown> } })
      .properties.p;
    expect(sent.description).toBe(words);
    expect(schemaViolations(schema, anthropic)).toEqual([]);
  });

  it("keeps minItems 0 and 1, which strict mode accepts", () => {
    const input = {
      type: "object",
      properties: { a: { type: "array", items: {}, minItems: 1 } },
    };
    expect(rewriteToolSchema(input, anthropic).schema).toEqual(input);
  });

  it("leaves enum and const values alone even when they look like keywords", () => {
    const input = {
      type: "object",
      properties: { k: { type: "string", enum: ["minimum", "maximum"] } },
    };
    expect(rewriteToolSchema(input, anthropic).schema).toEqual(input);
  });

  it("drops strict when an object allows additional properties", () => {
    const { strict } = rewriteToolSchema(
      {
        type: "object",
        properties: { headers: { type: "object", additionalProperties: {} } },
        additionalProperties: false,
      },
      anthropic,
    );
    expect(strict).toBe(false);
  });

  it("does not change the schema it is given", () => {
    const input = {
      type: "object",
      properties: { n: { type: "integer", minimum: 1 } },
    };
    const copy = structuredClone(input);
    rewriteToolSchema(input, anthropic);
    expect(input).toEqual(copy);
  });
});

describe("other providers", () => {
  it("Groq: a tool without properties is not strict, the schema is unchanged", () => {
    const empty = { type: "object", properties: {}, required: [] };
    expect(rewriteToolSchema(empty, PROVIDER_SCHEMA_RULES.groq)).toEqual({
      schema: empty,
      strict: false,
      removed: [],
    });
    const bounded = {
      type: "object",
      properties: { n: { type: "integer", minimum: 1 } },
    };
    expect(rewriteToolSchema(bounded, PROVIDER_SCHEMA_RULES.groq)).toEqual({
      schema: bounded,
      strict: true,
      removed: [],
    });
  });

  it.each([
    "openai",
    "google",
    "openai-compatible",
  ] as const)("%s: no documented limit, nothing changes", (provider) => {
    const input = {
      type: "object",
      properties: { n: { type: "integer", minimum: 1, maximum: 5 } },
    };
    expect(rewriteToolSchema(input, PROVIDER_SCHEMA_RULES[provider])).toEqual({
      schema: input,
      strict: true,
      removed: [],
    });
  });
});
