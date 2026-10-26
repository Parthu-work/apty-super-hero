import { useTranslation } from "../../../../i18n/context";
import { translatedToolName } from "../../../../i18n/tool-names";
import type { ToolDisplaySlotProps } from "../../../../types";
import {
  Tool,
  ToolBlock,
  ToolContent,
  ToolError,
  ToolHeader,
  ToolScreenshot,
} from "../../../ai-elements/tool";
import { mapToolState } from "../../tools";

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/**
 * A tool call as a collapsed card: name and status. Opened, it shows the
 * parameters, the result or the error, and any screenshot.
 */
export function DefaultToolDisplay({ tool }: ToolDisplaySlotProps) {
  const { t } = useTranslation();
  const displayName = translatedToolName(t, tool.toolName);

  return (
    <Tool>
      <ToolHeader type={displayName} state={mapToolState(tool.state)} />
      <ToolContent>
        {displayName !== tool.toolName && (
          <p className="text-xs text-muted-foreground">
            {t("chat.toolLabel")}{" "}
            <code className="font-mono">{tool.toolName}</code>
            {typeof tool.duration === "number" &&
              ` · ${t("chat.durationMs", { duration: tool.duration })}`}
          </p>
        )}
        <ToolBlock
          caption={t("chat.parameters")}
          copyLabel={t("chat.copyParameters")}
          text={asText(tool.input)}
        />
        {tool.errorText && <ToolError errorText={tool.errorText} />}
        {Boolean(tool.output) && (
          <ToolBlock
            caption={t("chat.result")}
            copyLabel={t("chat.copyResult")}
            text={asText(tool.output)}
          />
        )}
        <ToolScreenshot
          screenshot={tool.screenshot}
          screenshotUid={tool.screenshotUid}
        />
      </ToolContent>
    </Tool>
  );
}
