/**
 * Tool-display dispatcher: gives `analyze_element_selectors` a dedicated
 * visual (see `selector-analysis-display.tsx`), adds a full-response viewer
 * under `inspect_extension_network` results, and gives every other tool the
 * existing default rendering. Only dispatches once the tool call has
 * actually completed with output — in-flight/error states always fall back
 * to the default display so failures are never hidden behind a
 * specialized view that doesn't know how to render them.
 */
import { DefaultToolDisplay } from "@apty/ui/components/chatbot";
import type { ToolDisplaySlotProps } from "@apty/ui/types";
import { evidenceIdOf, ResponseBodyViewer } from "./response-body-viewer";
import { SelectorAnalysisDisplay } from "./selector-analysis-display";

export function AptyToolDisplay(props: ToolDisplaySlotProps) {
  if (props.tool.state !== "completed") {
    return <DefaultToolDisplay {...props} />;
  }
  if (props.tool.toolName === "analyze_element_selectors") {
    return <SelectorAnalysisDisplay {...props} />;
  }
  const evidenceId =
    props.tool.toolName === "inspect_extension_network"
      ? evidenceIdOf(props.tool.output)
      : undefined;
  if (evidenceId) {
    return (
      <div>
        <DefaultToolDisplay {...props} />
        <ResponseBodyViewer evidenceId={evidenceId} />
      </div>
    );
  }
  return <DefaultToolDisplay {...props} />;
}
