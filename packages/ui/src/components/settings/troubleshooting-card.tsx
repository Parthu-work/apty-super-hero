import type { AppSettings } from "@apty/agent-core";
import { Bug } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";

export interface TroubleshootingCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  language?: string;
}

export function TroubleshootingCard({
  settings,
  onChange,
  language,
}: TroubleshootingCardProps) {
  const zh = language === "zh";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bug className="h-5 w-5" />
          {zh ? "故障排除" : "Troubleshooting"}
        </CardTitle>
        <CardDescription>
          {zh
            ? "报告问题时打开。详细日志写入扩展的开发者工具控制台，不会发送到任何地方。"
            : "Turn this on when reporting a problem. Detailed logs go to the extension's DevTools consoles and are never sent anywhere."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="verbose-logging" className="text-sm font-medium">
            {zh ? "详细日志" : "Verbose logging"}
          </Label>
          <Switch
            id="verbose-logging"
            checked={settings.verboseLogging === true}
            onCheckedChange={(checked) => onChange({ verboseLogging: checked })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
