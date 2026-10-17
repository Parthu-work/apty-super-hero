/**
 * FileExplorer Component
 *
 * A simplified file explorer for browsing the virtual file system.
 * For a full implementation, see browser-runtime/src/skill/components/file-manager/
 */

import { FolderOpen, HardDrive } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useTranslation } from "../../i18n/context";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import type { FileSystemClient } from "./types";

interface FileExplorerProps {
  fileSystemClient: FileSystemClient;
  basePath?: string;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
  fileSystemClient,
  basePath = "/skills",
}) => {
  const { t } = useTranslation();
  const [loading] = useState(false);
  void fileSystemClient;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          {t("fileManager.title")}
        </CardTitle>
        <CardDescription>{t("fileManager.description")}</CardDescription>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-muted-foreground">{t("common.loading")}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              {t("fileManager.browser")}
            </h3>
            <p className="text-muted-foreground">
              {t("fileManager.comingSoon")}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {t("fileManager.basePath")}{" "}
              <span className="font-mono">{basePath}</span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
