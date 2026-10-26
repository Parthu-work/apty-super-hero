/**
 * FileExplorer Wrapper
 *
 * Wraps the full FileExplorer implementation with proper imports for the extension package.
 * This component uses the zenfs manager from @apty/browser-runtime.
 */

import type { DiskUsage, FileTreeNode } from "@apty/browser-runtime";
import { zenfs } from "@apty/browser-runtime";
import { Alert, AlertDescription } from "@apty/ui/components/ui/alert";
import { Badge } from "@apty/ui/components/ui/badge";
import { Button } from "@apty/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apty/ui/components/ui/card";
import { Input } from "@apty/ui/components/ui/input";
import { useTranslation } from "@apty/ui/i18n/context";
import {
  AlertCircle,
  Files,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Search,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

import { FilePreview } from "./file-components/FilePreview.js";
import { FileTree } from "./file-components/FileTree.js";
import { formatBytes } from "./file-components/utils.js";

interface FileExplorerProps {
  basePath?: string;
  /** When set, auto-opens preview for this file path (deep-link from SkillDetails). */
  initialFilePath?: string | null;
  /** Called after initialFilePath has been opened, so parent can clear the pending path. */
  onInitialFileOpened?: () => void;
}

export const FileExplorerWrapper: React.FC<FileExplorerProps> = ({
  basePath = "/skills",
  initialFilePath,
  onInitialFileOpened,
}) => {
  const { t } = useTranslation();
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [diskUsage, setDiskUsage] = useState<DiskUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const loadFileSystem = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Initialize ZenFS if needed
      await zenfs.initialize();

      // Load file tree and disk usage
      const [tree, usage] = await Promise.all([
        zenfs.getFileTree(basePath),
        zenfs.getDiskUsage(basePath),
      ]);

      setFileTree(tree);
      setDiskUsage(usage);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : t("fileManager.loadSystemFailed");
      setError(errorMsg);
      console.error("Failed to load file system:", err);
    } finally {
      setLoading(false);
    }
  }, [basePath, t]);

  useEffect(() => {
    void loadFileSystem();
  }, [loadFileSystem]);

  // Handle deep-link: when initialFilePath is set, open that file in the preview
  useEffect(() => {
    if (initialFilePath && !loading) {
      setSelectedFile(initialFilePath);
      setPreviewOpen(true);
      onInitialFileOpened?.();
    }
  }, [initialFilePath, loading, onInitialFileOpened]);

  const handleRefresh = () => {
    void loadFileSystem();
  };

  const handleFileSelect = (path: string) => {
    setSelectedFile(path);
    setPreviewOpen(true);
  };

  const handleDelete = async (path: string) => {
    try {
      await zenfs.rm(path, { recursive: true });
      await loadFileSystem();

      // Close preview if the deleted file was selected
      if (selectedFile === path) {
        setPreviewOpen(false);
        setSelectedFile(null);
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : t("fileManager.deleteFailed");
      setError(errorMsg);
    }
  };

  const filterTree = (nodes: FileTreeNode[], query: string): FileTreeNode[] => {
    if (!query.trim()) return nodes;

    const lowerQuery = query.toLowerCase();

    return nodes
      .filter((node) => {
        // Check if current node matches
        const nameMatches = node.name.toLowerCase().includes(lowerQuery);

        // Check if any children match (for directories)
        if (node.children) {
          const filteredChildren = filterTree(node.children, query);
          if (filteredChildren.length > 0) {
            return true;
          }
        }

        return nameMatches;
      })
      .map((node) => {
        // If node has children, filter them recursively
        if (node.children) {
          return {
            ...node,
            children: filterTree(node.children, query),
          };
        }
        return node;
      });
  };

  const filteredTree = filterTree(fileTree, searchQuery);

  if (loading) {
    return (
      <Card className="w-full">
        <CardContent className="flex items-center justify-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin mr-2" />
          {t("fileManager.loadingSystem")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Disk Usage Stats */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-5 w-5" />
                {t("fileManager.title")}
              </CardTitle>
              <CardDescription>{t("fileManager.description")}</CardDescription>
            </div>
            <div className="flex gap-2">
              {diskUsage && (
                <>
                  <Badge variant="outline" className="flex items-center gap-1">
                    <Files className="h-3 w-3" />
                    {t("fileManager.files", { count: diskUsage.fileCount })}
                  </Badge>
                  <Badge variant="outline" className="flex items-center gap-1">
                    <FolderOpen className="h-3 w-3" />
                    {t("fileManager.folders", {
                      count: diskUsage.directoryCount,
                    })}
                  </Badge>
                  <Badge variant="default" className="flex items-center gap-1">
                    <HardDrive className="h-3 w-3" />
                    {formatBytes(diskUsage.totalSize)}
                  </Badge>
                </>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Search and Actions */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("fileManager.search")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t("common.refresh")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Per-Skill Disk Usage */}
      {diskUsage && Object.keys(diskUsage.bySkill).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {t("fileManager.diskUsageBySkill")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(diskUsage.bySkill)
                .sort((a, b) => b[1].size - a[1].size)
                .map(([skillName, usage]) => (
                  <div
                    key={skillName}
                    className="flex items-center justify-between py-2 border-b last:border-b-0"
                  >
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{skillName}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>
                        {t("fileManager.files", { count: usage.fileCount })}
                      </span>
                      <Badge variant="secondary">
                        {formatBytes(usage.size)}
                      </Badge>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* File Tree */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("fileManager.browser")}</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredTree.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-title font-semibold mb-2">
                {t("fileManager.none")}
              </h3>
              <p className="text-muted-foreground">
                {t(
                  searchQuery
                    ? "fileManager.adjustSearch"
                    : "fileManager.empty",
                )}
              </p>
            </div>
          ) : (
            <FileTree
              nodes={filteredTree}
              onFileSelect={handleFileSelect}
              onDelete={handleDelete}
            />
          )}
        </CardContent>
      </Card>

      {/* File Preview Modal */}
      <FilePreview
        filePath={selectedFile}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onFileSaved={handleRefresh}
      />
    </div>
  );
};
