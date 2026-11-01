import { describe, expect, it } from "vitest";
import { asksAboutDapty } from "./dapty-route";

describe("asksAboutDapty", () => {
  it.each([
    "Dapty is not answering my users",
    "ask dapty doesn't work on this page",
    "The AI assistant suggested a workflow that does not open",
    "Dapty suggested Export a report but nothing happens",
    "the widget chat is broken",
    "users say the chatbot gives an error",
    "Dapty said it couldn't find information about leads",
    "what did Dapty suggest to the user?",
    "dapty failed to answer",
    "Dapty 没有回答",
    "AI 助手无法打开推荐的工作流",
  ])("checks the chat for %j", (message) => {
    expect(asksAboutDapty(message)).toBe(true);
  });

  it.each([
    "How do I turn on Dapty?",
    "What is Dapty?",
    "Explain how the AI assistant picks its answers",
    "Can you explain what the widget chat sends to ai-service?",
    "please investigate why Dapty is not answering",
    "Dapty is great",
    "my workflow is not visible in the widget",
    "the tooltip is not showing",
    "Is it possible to rename Dapty?",
  ])("leaves %j to the model or another check", (message) => {
    expect(asksAboutDapty(message)).toBe(false);
  });

  it("scans long input in linear time", () => {
    const long = `dapty ${"not ".repeat(25_000)}`;
    const started = performance.now();
    asksAboutDapty(long);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
