/**
 * Tool-display dispatcher: gives `analyze_element_selectors` and
 * `run_diagnosis` dedicated visuals (see `selector-analysis-display.tsx` and
 * `check-result-card.tsx`) and every other tool the existing default
 * rendering. Only dispatches once the tool call has
 * actually completed with output — in-flight/error states always fall back
 * to the default display so failures are never hidden behind a
 * specialized view that doesn't know how to render them.
 */
import { DefaultToolDisplay } from "@apty/ui/components/chatbot";
import type { ToolDisplaySlotProps } from "@apty/ui/types";
import { CheckResultCard } from "./check-result-card";
import { evidenceIdOf, ResponseBodyViewer } from "./response-body-viewer";
import { SelectorAnalysisDisplay } from "./selector-analysis-display";

export function AptyToolDisplay(props: ToolDisplaySlotProps) {
  if (
    props.tool.toolName === "analyze_element_selectors" &&
    props.tool.state === "completed"
  ) {
    return <SelectorAnalysisDisplay {...props} />;
  }
  if (
    props.tool.toolName === "run_diagnosis" &&
    props.tool.state === "completed"
  ) {
    return <CheckResultCard {...props} />;
  }
  return <DefaultToolDisplay {...props} />;
}

/** Under a completed inspect_extension_network call: the full response viewer. */
export function AptyToolFooter({ tool }: ToolDisplaySlotProps) {
  if (
    tool.toolName !== "inspect_extension_network" ||
    tool.state !== "completed"
  ) {
    return null;
  }
  const evidenceId = evidenceIdOf(tool.output);
  return evidenceId ? <ResponseBodyViewer evidenceId={evidenceId} /> : null;
}
