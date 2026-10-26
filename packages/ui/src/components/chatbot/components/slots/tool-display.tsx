import { useTranslation } from "../../../../i18n/context";
import { translatedToolName } from "../../../../i18n/tool-names";
import type { ToolDisplaySlotProps } from "../../../../types";
import { Response } from "../../../ai-elements/response";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  ToolScreenshot,
} from "../../../ai-elements/tool";
import { formatToolOutput, mapToolState } from "../../tools";

/**
 * Default tool display slot component
 * Opens by default when there's an error so users can see the failure reason
 */
export function DefaultToolDisplay({ tool }: ToolDisplaySlotProps) {
  const { t } = useTranslation();
  const displayName = translatedToolName(t, tool.toolName);
  // Expand by default when in error state to make failure reasons visible
  const shouldExpandByDefault = tool.state === "error";

  return (
    <Tool defaultOpen={shouldExpandByDefault}>
      <ToolHeader type={displayName} state={mapToolState(tool.state)} />
      <ToolContent>
        {displayName !== tool.toolName && (
          <p className="px-4 pt-3 text-xs text-muted-foreground">
            {t("chat.toolLabel")} <code>{tool.toolName}</code>
            {typeof tool.duration === "number" &&
              ` · ${t("chat.durationMs", { duration: tool.duration })}`}
          </p>
        )}
        <ToolInput input={tool.input} />
        <ToolOutput
          output={
            tool.output ? (
              <Response>{formatToolOutput(tool.output)}</Response>
            ) : undefined
          }
          errorText={tool.errorText}
        />
        <ToolScreenshot
          screenshot={tool.screenshot}
          screenshotUid={tool.screenshotUid}
        />
      </ToolContent>
    </Tool>
  );
}
