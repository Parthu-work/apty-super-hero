import type { AgentInputItem } from "@apty/agent-core";
import { describe, expect, it } from "vitest";
import {
  createRequestBudgetFilter,
  FULL_RESULTS_KEPT,
  MAX_TOOL_RESULT_TOKENS,
  REPORT_RESULT_TOKENS,
  STUB_PREVIEW_CHARS,
} from "./request-budget.js";

const MAX_CHARS = MAX_TOOL_RESULT_TOKENS * 4;

const user = (text: string): AgentInputItem =>
  ({ type: "message", role: "user", content: text }) as AgentInputItem;

const call = (callId: string, name = "read_thing"): AgentInputItem =>
  ({
    type: "function_call",
    callId,
    name,
    arguments: "{}",
  }) as AgentInputItem;

const result = (
  callId: string,
  output: unknown,
  name = "read_thing",
): AgentInputItem =>
  ({
    type: "function_call_result",
    callId,
    name,
    output,
  }) as AgentInputItem;

const text = (item: AgentInputItem | undefined): string => {
  const output = (item as { output: unknown }).output;
  return typeof output === "string"
    ? output
    : (output as { text: string }).text;
};

/** One earlier turn: a question, a call, its result. */
function pastTurn(n: number, body: string): AgentInputItem[] {
  return [user(`q${n}`), call(`c${n}`), result(`c${n}`, body)];
}

const run = (items: AgentInputItem[]) => createRequestBudgetFilter()(items);

describe("request budget", () => {
  it("keeps the documented limits", () => {
    expect(MAX_TOOL_RESULT_TOKENS).toBe(2000);
    expect(FULL_RESULTS_KEPT).toBe(4);
    expect(STUB_PREVIEW_CHARS).toBe(200);
  });

  describe("cap", () => {
    it("cuts an oversized result to the cap and says how much was cut", async () => {
      const [, , out] = await run([
        user("go"),
        call("c1"),
        result("c1", "x".repeat(MAX_CHARS * 3)),
      ]);
      const sent = text(out);
      expect(sent.length).toBeLessThan(MAX_CHARS + 200);
      expect(sent.startsWith("x".repeat(100))).toBe(true);
      expect(sent).toMatch(
        new RegExp(`truncated.*${MAX_CHARS}.*${MAX_CHARS * 3}`),
      );
    });

    it("leaves a result at the cap exactly as it is", async () => {
      const exact = result("c1", "x".repeat(MAX_CHARS));
      const items = [user("go"), call("c1"), exact];
      const out = await run(items);
      expect(out[2]).toBe(exact);
    });

    it("caps the text of the SDK's text-object output and keeps its shape", async () => {
      const [, , out] = await run([
        user("go"),
        call("c1"),
        result("c1", { type: "text", text: "y".repeat(MAX_CHARS * 2) }),
      ]);
      const output = (out as { output: { type: string; text: string } }).output;
      expect(output.type).toBe("text");
      expect(output.text.length).toBeLessThan(MAX_CHARS + 200);
    });

    it("exempts a result that already carries an evidence id and a bounded preview", async () => {
      const bounded = JSON.stringify({
        evidenceId: "ev_1",
        bodyPreview: "p".repeat(MAX_CHARS + 2000),
      });
      const item = result("c1", bounded);
      const out = await run([user("go"), call("c1"), item]);
      expect(out[2]).toBe(item);
    });

    it("still caps a result with an evidence id that is far larger than any preview", async () => {
      const huge = JSON.stringify({
        evidenceId: "ev_1",
        bodyPreview: "p".repeat(MAX_CHARS * 10),
      });
      const [, , out] = await run([user("go"), call("c1"), result("c1", huge)]);
      expect(text(out).length).toBeLessThan(MAX_CHARS + 200);
    });

    it("keeps an oversized JSON result valid, keeping every scalar and marking what was cut", async () => {
      const audit = {
        available: true,
        score: 54,
        grade: "NEEDS_ATTENTION",
        frameAccessibility: { framesTotal: 2, framesFailed: 0 },
        risks: Array.from({ length: 400 }, (_, i) => ({
          id: i,
          detail: "d".repeat(120),
        })),
        notes: "n".repeat(20_000),
      };
      const original = JSON.stringify(audit);
      const [, , out] = await run([
        user("go"),
        call("c1"),
        result("c1", original),
      ]);
      const sent = text(out);
      expect(sent.length).toBeLessThanOrEqual(MAX_CHARS);
      const parsed = JSON.parse(sent);
      expect(parsed).toMatchObject({
        available: true,
        score: 54,
        grade: "NEEDS_ATTENTION",
        frameAccessibility: { framesTotal: 2, framesFailed: 0 },
      });
      expect(parsed.risks[0]).toEqual(audit.risks[0]);
      expect(parsed.risks.at(-1)).toMatch(/more items not sent/);
      expect(parsed.notes).toMatch(/more characters not sent/);
      expect(parsed.truncatedForModel).toEqual({
        originalChars: original.length,
      });
    });

    it("replaces deep objects with a marker before giving up on JSON", async () => {
      const app = {
        available: true,
        summary: { pagesAudited: 3, score: 67 },
        pages: Object.fromEntries(
          Array.from({ length: 300 }, (_, i) => [
            `page_${i}`,
            { metrics: { a: i, b: i, c: i }, frames: { top: { ok: true } } },
          ]),
        ),
      };
      const [, , out] = await run([
        user("go"),
        call("c1"),
        result("c1", JSON.stringify(app)),
      ]);
      const parsed = JSON.parse(text(out));
      expect(text(out).length).toBeLessThanOrEqual(MAX_CHARS);
      expect(parsed.available).toBe(true);
      expect(parsed.summary).toEqual({ pagesAudited: 3, score: 67 });
      expect(Object.keys(parsed.pages)).toHaveLength(21);
      expect(parsed.pages["…"]).toBe("[280 more keys not sent]");
    });

    it("cuts as text when even the smallest valid JSON shape is too big", async () => {
      const wide = JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 3000 }, (_, i) => [`key_${i}`, i]),
        ),
      );
      const [, , out] = await run([user("go"), call("c1"), result("c1", wide)]);
      expect(text(out)).toMatch(
        /\[truncated: first \d+ of \d+ characters sent\]$/,
      );
    });

    it("lets a DOM Health report through whole up to its own, higher ceiling", async () => {
      const report = JSON.stringify({ score: 54, risks: "r".repeat(40_000) });
      const item = result("c1", report, "run_dom_health_audit");
      const out = await run([
        user("go"),
        call("c1", "run_dom_health_audit"),
        item,
      ]);
      expect(out[2]).toBe(item);
      const sameSizeOther = result("c2", report);
      const [, , other] = await run([user("go"), call("c2"), sameSizeOther]);
      expect(text(other).length).toBeLessThanOrEqual(MAX_CHARS);
    });

    it("shrinks a DOM Health report past its ceiling, keeping it valid JSON", async () => {
      const ceiling =
        (REPORT_RESULT_TOKENS.run_application_dom_health_audit as number) * 4;
      const report = JSON.stringify({
        pagesAudited: 3,
        notes: "n".repeat(ceiling),
      });
      const [, , out] = await run([
        user("go"),
        call("c1", "run_application_dom_health_audit"),
        result("c1", report, "run_application_dom_health_audit"),
      ]);
      expect(text(out).length).toBeLessThanOrEqual(ceiling);
      expect(JSON.parse(text(out)).pagesAudited).toBe(3);
    });

    it("never touches a non-text output such as an image", async () => {
      const image = result("c1", { type: "image", image: "data:AAAA" });
      const out = await run([user("go"), call("c1"), image]);
      expect(out[2]).toBe(image);
    });
  });

  describe("pruning", () => {
    it("keeps the newest four results in full and stubs older ones from earlier turns", async () => {
      const body = JSON.stringify({ data: "d".repeat(900) });
      const items = [1, 2, 3, 4, 5, 6].flatMap((n) => pastTurn(n, body));
      const out = await run([...items, user("now")]);
      const results = out.filter((i) => i.type === "function_call_result");

      expect(results.slice(-FULL_RESULTS_KEPT).map(text)).toEqual(
        Array(FULL_RESULTS_KEPT).fill(body),
      );
      for (const old of results.slice(0, -FULL_RESULTS_KEPT)) {
        const stub = JSON.parse(text(old));
        expect(stub).toMatchObject({
          stubbed: true,
          tool: "read_thing",
          size: body.length,
        });
        expect(stub.preview).toBe(body.slice(0, STUB_PREVIEW_CHARS));
      }
    });

    it("keeps the evidence id in a stub so the model can fetch the data again", async () => {
      const body = JSON.stringify({
        evidenceId: "ev_42",
        bodyPreview: "b".repeat(1000),
      });
      const items = [1, 2, 3, 4, 5, 6].flatMap((n) =>
        pastTurn(n, n === 1 ? body : "short"),
      );
      const out = await run([...items, user("now")]);
      const first = out.find((i) => i.type === "function_call_result");
      expect(JSON.parse(text(first)).evidenceId).toBe("ev_42");
    });

    it("never stubs a result from the current turn, however many there are", async () => {
      const body = "z".repeat(1500);
      const current: AgentInputItem[] = [user("investigate")];
      for (let n = 1; n <= 9; n++) {
        current.push(call(`c${n}`), result(`c${n}`, body));
      }
      const out = await run(current);
      for (const item of out.filter((i) => i.type === "function_call_result")) {
        expect(text(item)).toBe(body);
      }
    });

    it("counts the current turn's results toward the newest four", async () => {
      const body = "q".repeat(1500);
      const items = [
        ...[1, 2].flatMap((n) => pastTurn(n, body)),
        user("now"),
        call("a"),
        result("a", body),
        call("b"),
        result("b", body),
        call("c"),
        result("c", body),
        call("d"),
        result("d", body),
      ];
      const out = await run(items);
      const results = out.filter((i) => i.type === "function_call_result");
      expect(results).toHaveLength(6);
      expect(JSON.parse(text(results[0])).stubbed).toBe(true);
      expect(JSON.parse(text(results[1])).stubbed).toBe(true);
      for (const kept of results.slice(2)) expect(text(kept)).toBe(body);
    });

    it("does not treat the transient screenshot message as a new turn", async () => {
      const body = "s".repeat(1500);
      const transient = {
        type: "message",
        role: "user",
        content: [{ type: "input_image", image: "data:AAAA" }],
        providerData: { __transient_screenshot__: true },
      } as AgentInputItem;
      const items = [
        ...pastTurn(1, body),
        user("now"),
        call("a"),
        result("a", body),
        transient,
        ...["b", "c", "d", "e"].flatMap((id) => [call(id), result(id, body)]),
      ];
      const out = await run(items);
      const results = out.filter((i) => i.type === "function_call_result");
      expect(results.map((r) => text(r) === body)).toEqual([
        false,
        true,
        true,
        true,
        true,
        true,
      ]);
    });

    it("is idempotent: running it again changes nothing", async () => {
      const body = JSON.stringify({ data: "d".repeat(900) });
      const items = [
        ...[1, 2, 3, 4, 5, 6].flatMap((n) => pastTurn(n, body)),
        user("now"),
      ];
      const once = await run(items);
      const twice = await run(once);
      expect(twice).toEqual(once);
    });

    it("never drops, reorders or unpairs a function call and its result", async () => {
      const items = [
        ...[1, 2, 3, 4, 5, 6, 7].flatMap((n) =>
          pastTurn(n, "w".repeat(MAX_CHARS * 2)),
        ),
        user("now"),
      ];
      const out = await run(items);
      expect(out.map((i) => i.type)).toEqual(items.map((i) => i.type));
      const callIds = (type: string) =>
        out
          .filter((i) => i.type === type)
          .map((i) => (i as { callId: string }).callId);
      expect(callIds("function_call_result")).toEqual(callIds("function_call"));
    });

    it("leaves a short conversation untouched", async () => {
      const items = [user("hi"), call("c1"), result("c1", "ok")];
      const out = await run(items);
      expect(out).toEqual(items);
      expect(out[2]).toBe(items[2]);
    });
  });
});
