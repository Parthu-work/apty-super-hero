/**
 * Tool-display dispatcher: gives `analyze_element_selectors` a dedicated
 * visual (see `selector-analysis-display.tsx`) and every other tool the
 * existing default rendering. Only dispatches once the tool call has
 * actually completed with output — in-flight/error states always fall back
 * to the default display so failures are never hidden behind a
 * specialized view that doesn't know how to render them.
 */
import { DefaultToolDisplay } from "@aipexstudio/aipex-react/components/chatbot";
import type { ToolDisplaySlotProps } from "@aipexstudio/aipex-react/types";
import { SelectorAnalysisDisplay } from "./selector-analysis-display";

export function AptyToolDisplay(props: ToolDisplaySlotProps) {
  if (
    props.tool.toolName === "analyze_element_selectors" &&
    props.tool.state === "completed"
  ) {
    return <SelectorAnalysisDisplay {...props} />;
  }
  return <DefaultToolDisplay {...props} />;
}
