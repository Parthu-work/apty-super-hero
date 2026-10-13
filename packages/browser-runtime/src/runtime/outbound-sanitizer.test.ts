import type { AgentInputItem } from "@apty/agent-core";
import { describe, expect, it, vi } from "vitest";
import { createOutboundSanitizer } from "./outbound-sanitizer.js";
import { redactTextInMode } from "./redaction-mode.js";

vi.mock("./redaction-mode.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./redaction-mode.js")>();
  return {
    ...actual,
    redactTextInMode: vi.fn(actual.redactTextInMode),
  };
});

const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const GITHUB_TOKEN = `ghp_${"a1B2c3D4e5".repeat(3)}`;

const result = (callId: string, output: unknown): AgentInputItem =>
  ({
    type: "function_call_result",
    name: "get_page_metadata",
    callId,
    output,
  }) as AgentInputItem;

const userText = (text: string): AgentInputItem =>
  ({ type: "message", role: "user", content: text }) as AgentInputItem;

const outputOf = (item: AgentInputItem | undefined) =>
  (item as { output: unknown }).output;

async function sanitize(
  mode: "strict" | "standard" | "off",
  items: AgentInputItem[],
) {
  return createOutboundSanitizer({ getMode: () => mode })(items);
}

describe("outbound sanitizer", () => {
  it("redacts a secret in a string tool result", async () => {
    const [out] = await sanitize("strict", [
      result("c1", `{"note":"hello","header":"Bearer ${JWT}"}`),
    ]);
    expect(outputOf(out)).not.toContain(JWT);
    expect(outputOf(out)).toContain("hello");
  });

  it("redacts inside the SDK's text-object and content-part outputs", async () => {
    const [wrapped, parts] = await sanitize("standard", [
      result("c1", { type: "text", text: `token ${GITHUB_TOKEN}` }),
      result("c2", [
        { type: "text", text: `see ${GITHUB_TOKEN}` },
        { type: "image", image: "data:image/png;base64,AAAA" },
      ]),
    ]);
    expect(JSON.stringify(outputOf(wrapped))).not.toContain(GITHUB_TOKEN);
    expect(JSON.stringify(outputOf(parts))).not.toContain(GITHUB_TOKEN);
    expect((outputOf(parts) as unknown[])[1]).toEqual({
      type: "image",
      image: "data:image/png;base64,AAAA",
    });
  });

  it("redacts a secret held in a structured output", async () => {
    const [out] = await sanitize("strict", [
      result("c1", { found: true, value: GITHUB_TOKEN }),
    ]);
    expect(JSON.stringify(outputOf(out))).not.toContain(GITHUB_TOKEN);
  });

  it("masks structural secrets in user messages in strict and standard, not off", async () => {
    const text = `my key is ${GITHUB_TOKEN}`;
    for (const mode of ["strict", "standard"] as const) {
      const [out] = await sanitize(mode, [userText(text)]);
      expect((out as { content: string }).content).not.toContain(GITHUB_TOKEN);
    }
    const [off] = await sanitize("off", [userText(text)]);
    expect((off as { content: string }).content).toBe(text);
  });

  it("leaves user prose and page-context-looking words alone", async () => {
    const text = "why is the address field empty on the patient page?";
    const [out] = await sanitize("strict", [userText(text)]);
    expect((out as { content: string }).content).toBe(text);
  });

  it("masks text parts of a multimodal user message and keeps images", async () => {
    const image = { type: "input_image", image: "data:image/png;base64,AAAA" };
    const [out] = await sanitize("strict", [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: GITHUB_TOKEN }, image],
      } as AgentInputItem,
    ]);
    const content = (out as { content: Array<{ text?: string }> }).content;
    expect(content[0]?.text).not.toContain(GITHUB_TOKEN);
    expect(content[1]).toEqual(image);
  });

  it("is idempotent", async () => {
    const items = [
      result("c1", `{"a":"Bearer ${JWT}"}`),
      userText(GITHUB_TOKEN),
    ];
    const once = await sanitize("strict", items);
    const twice = await sanitize("strict", once);
    expect(twice).toEqual(once);
  });

  it("keeps untouched items identical and never drops or reorders items", async () => {
    const plain = result("c0", "nothing sensitive");
    const call = {
      type: "function_call",
      callId: "c1",
      name: "get_page_metadata",
      arguments: "{}",
    } as AgentInputItem;
    const input = [userText("hi"), call, result("c1", JWT), plain];
    const out = await sanitize("strict", input);
    expect(out).toHaveLength(input.length);
    expect(out[0]).toBe(input[0]);
    expect(out[1]).toBe(call);
    expect(out[3]).toBe(plain);
    expect((out[2] as { callId: string }).callId).toBe("c1");
  });

  it("reads the mode at every call, not once", async () => {
    let mode: "strict" | "off" = "strict";
    const sanitizer = createOutboundSanitizer({ getMode: () => mode });
    const text = `my key is ${GITHUB_TOKEN}`;
    const first = await sanitizer([userText(text)]);
    expect((first[0] as { content: string }).content).not.toContain(
      GITHUB_TOKEN,
    );
    mode = "off";
    const second = await sanitizer([userText(text)]);
    expect((second[0] as { content: string }).content).toBe(text);
  });

  it("does not redact the same tool result twice, but does when the mode changes", async () => {
    let mode: "strict" | "standard" = "strict";
    const sanitizer = createOutboundSanitizer({ getMode: () => mode });
    const item = result("c-cache", `{"x":"Bearer ${JWT}"}`);
    const spy = vi.mocked(redactTextInMode);
    spy.mockClear();

    await sanitizer([item]);
    expect(spy).toHaveBeenCalledTimes(1);
    await sanitizer([item]);
    expect(spy).toHaveBeenCalledTimes(1);

    mode = "standard";
    await sanitizer([item]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does not serve a cached result for a different output under the same call id", async () => {
    const sanitizer = createOutboundSanitizer({ getMode: () => "strict" });
    await sanitizer([result("c1", "clean")]);
    const [out] = await sanitizer([result("c1", `Bearer ${JWT}`)]);
    expect(outputOf(out)).not.toContain(JWT);
  });
});
