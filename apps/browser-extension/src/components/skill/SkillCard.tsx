import { Badge } from "@apty/ui/components/ui/badge";
import { Button } from "@apty/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apty/ui/components/ui/card";
import { ConfirmDialog } from "@apty/ui/components/ui/confirm-dialog";
import { Switch } from "@apty/ui/components/ui/switch";
import { useTranslation } from "@apty/ui/i18n/context";
import { Download, Eye, Settings, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import type { SkillClient, SkillMetadata } from "./types";

interface SkillCardProps {
  skill: SkillMetadata;
  skillClient: SkillClient;
  onToggleEnabled: (skillId: string, enabled: boolean) => void;
  onDelete: (skillId: string) => void;
  onViewDetails: (skill: SkillMetadata) => void;
  onExport: (skill: SkillMetadata) => void;
}

export const SkillCard: React.FC<SkillCardProps> = ({
  skill,
  skillClient,
  onToggleEnabled,
  onDelete,
  onViewDetails,
  onExport,
}) => {
  const { t } = useTranslation();
  const isBuiltin = skill.id === "skill-creator";
  const [fileStats, setFileStats] = useState({
    scripts: 0,
    references: 0,
    assets: 0,
  });

  const handleToggleEnabled = (checked: boolean) => {
    if (isBuiltin) {
      alert(t("skills.card.cannotDisableBuiltIn"));
      return;
    }
    onToggleEnabled(skill.id, checked);
  };

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  // Load file statistics
  useEffect(() => {
    const loadFileStats = async () => {
      try {
        const detail = await skillClient.getSkill(skill.id);
        if (detail) {
          setFileStats({
            scripts: detail.scripts.length,
            references: detail.references.length,
            assets: detail.assets.length,
          });
        }
      } catch (error) {
        console.error(
          `Failed to load file stats for skill ${skill.id}:`,
          error,
        );
        // Keep default stats of 0 if loading fails
      }
    };

    loadFileStats();
  }, [skill.id, skillClient]);

  const stats = fileStats;

  return (
    <Card className="w-full">
      <CardHeader className="pb-3 sm:pb-3">
        <div className="text-center">
          <CardTitle>{skill.name}</CardTitle>
          <CardDescription className="mt-2 text-sm leading-relaxed">
            {skill.description}
          </CardDescription>
        </div>
        <div className="flex items-center justify-center gap-2 mt-3">
          {isBuiltin && (
            <Badge variant="outline" className="text-info border-info">
              {t("skillDetails.builtIn")}
            </Badge>
          )}
          <Badge variant={skill.enabled ? "default" : "secondary"}>
            {t(
              skill.enabled ? "skillDetails.enabled" : "skillDetails.disabled",
            )}
          </Badge>
          <Switch
            aria-label={t("skills.card.enable", { name: skill.name })}
            checked={skill.enabled}
            onCheckedChange={handleToggleEnabled}
            disabled={isBuiltin}
            className="ml-2"
          />
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-4">
          {/* Left Column - Statistics */}
          <div className="space-y-3">
            <div className="text-sm font-semibold text-foreground text-center">
              {t("skills.card.fileStatistics")}
            </div>
            <div className="space-y-2 text-sm text-muted-foreground text-center">
              <div className="flex items-center justify-center gap-2">
                <Settings className="h-4 w-4" />
                <span>
                  {t("skills.card.scripts", { count: stats.scripts })}
                </span>
              </div>
              <div className="flex items-center justify-center gap-2">
                <Eye className="h-4 w-4" />
                <span>
                  {t("skills.card.references", { count: stats.references })}
                </span>
              </div>
              <div className="flex items-center justify-center gap-2">
                <Download className="h-4 w-4" />
                <span>{t("skills.card.assets", { count: stats.assets })}</span>
              </div>
            </div>
          </div>

          {/* Right Column - Metadata */}
          <div className="space-y-3">
            <div className="text-sm font-semibold text-foreground text-center">
              {t("skills.card.metadata")}
            </div>
            <div className="space-y-2 text-sm text-muted-foreground text-center">
              <div>{t("skills.card.version", { version: skill.version })}</div>
              <div>
                {t("skills.card.uploaded", {
                  date: formatDate(skill.uploadedAt),
                })}
              </div>
              <div>
                {t("skills.card.status", {
                  status: t(
                    skill.enabled
                      ? "skills.card.active"
                      : "skills.card.inactive",
                  ),
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-4 mt-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onViewDetails(skill)}
            className="flex-1"
          >
            <Eye className="h-3 w-3 mr-1" />
            {t("skills.card.viewDetails")}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onExport(skill)}
            aria-label={t("skills.card.export", { name: skill.name })}
          >
            <Download className="h-3 w-3" />
          </Button>

          <Button
            variant="danger"
            size="sm"
            onClick={() => setConfirmingDelete(true)}
            disabled={isBuiltin}
            aria-label={t("skills.card.delete", { name: skill.name })}
          >
            <Trash2 aria-hidden="true" className="size-3" />
          </Button>
          <ConfirmDialog
            open={confirmingDelete}
            onOpenChange={setConfirmingDelete}
            title={t("skills.card.confirmDelete", { name: skill.name })}
            description={t("fileManager.cannotUndo")}
            confirmLabel={t("common.delete")}
            onConfirm={() => {
              setConfirmingDelete(false);
              onDelete(skill.id);
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
};
