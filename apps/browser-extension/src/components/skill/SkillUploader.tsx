import { Alert, AlertDescription } from "@apty/ui/components/ui/alert";
import { Button } from "@apty/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apty/ui/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@apty/ui/components/ui/dialog";
import { Progress } from "@apty/ui/components/ui/progress";
import { useTranslation } from "@apty/ui/i18n/context";
import { AlertCircle, CheckCircle, FileArchive, Upload } from "lucide-react";
import type React from "react";
import { useCallback, useRef, useState } from "react";
import type { SkillClient, SkillMetadata } from "./types";

interface SkillUploaderProps {
  skillClient: SkillClient;
  onUploadSuccess: (skill: SkillMetadata) => void;
  onUploadError: (error: string) => void;
}

export const SkillUploader: React.FC<SkillUploaderProps> = ({
  skillClient,
  onUploadSuccess,
  onUploadError,
}) => {
  const { t } = useTranslation();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [conflictingSkillName, setConflictingSkillName] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileSelect = useCallback(
    async (file: File, replace: boolean = false) => {
      if (!file.name.endsWith(".zip")) {
        onUploadError(t("skills.uploader.invalidZip"));
        return;
      }

      setIsUploading(true);
      setUploadProgress(0);
      setUploadStatus("idle");

      try {
        // Simulate upload progress
        const progressInterval = setInterval(() => {
          setUploadProgress((prev) => {
            if (prev >= 90) {
              clearInterval(progressInterval);
              return 90;
            }
            return prev + 10;
          });
        }, 200);

        // Upload skill
        const result = await skillClient.uploadSkill(file, replace);

        clearInterval(progressInterval);
        setUploadProgress(100);

        if (result.ok) {
          setUploadStatus("success");
          setStatusMessage(
            t(
              replace ? "skills.uploader.replaced" : "skills.uploader.uploaded",
              { name: result.skill.name },
            ),
          );
          onUploadSuccess(result.skill);

          // Reset after 3 seconds
          setTimeout(() => {
            setUploadStatus("idle");
            setStatusMessage("");
            setUploadProgress(0);
          }, 3000);
        } else if (result.type === "conflict") {
          setConflictingSkillName(result.skillName);
          setPendingFile(file);
          setConflictDialogOpen(true);
        } else {
          setUploadStatus("error");
          setStatusMessage(result.message);
          onUploadError(result.message);
        }
      } catch (error) {
        setUploadStatus("error");
        const message =
          error instanceof Error ? error.message : t("skills.uploader.failed");
        setStatusMessage(message);
        onUploadError(message);
      } finally {
        setIsUploading(false);
      }
    },
    [skillClient, onUploadSuccess, onUploadError, t],
  );

  const handleConfirmReplace = useCallback(async () => {
    setConflictDialogOpen(false);
    if (pendingFile) {
      await handleFileSelect(pendingFile, true);
      setPendingFile(null);
    }
  }, [pendingFile, handleFileSelect]);

  const handleCancelReplace = useCallback(() => {
    setConflictDialogOpen(false);
    setPendingFile(null);
    setConflictingSkillName("");
  }, []);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files?.[0]) {
        handleFileSelect(e.dataTransfer.files[0]);
      }
    },
    [handleFileSelect],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.[0]) {
        handleFileSelect(e.target.files[0]);
      }
    },
    [handleFileSelect],
  );

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          {t("skills.uploader.title")}
        </CardTitle>
        <CardDescription>{t("skills.uploader.description")}</CardDescription>
      </CardHeader>

      <CardContent>
        <div className="space-y-4">
          {/* Upload Area: the transparent file input covering it is the control (keyboard and screen readers reach it directly); the area only takes drops. */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target only; the file input inside is the keyboard-reachable control */}
          <div
            className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors focus-within:ring-2 focus-within:ring-ring ${
              dragActive
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50"
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              aria-label={t("skills.uploader.inputLabel")}
              type="file"
              accept=".zip"
              onChange={handleFileInputChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              disabled={isUploading}
              ref={fileInputRef}
            />

            <div className="space-y-2">
              <FileArchive className="h-12 w-12 mx-auto text-muted-foreground" />
              <div className="text-title font-medium">
                {t(
                  isUploading
                    ? "skills.uploader.uploading"
                    : "skills.uploader.dropHere",
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                {t("skills.uploader.browse")}
              </div>
            </div>
          </div>

          {/* Upload Progress */}
          {isUploading && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{t("skills.uploader.uploadingSkill")}</span>
                <span>{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="w-full" />
            </div>
          )}

          {/* Status Messages */}
          {uploadStatus !== "idle" && (
            <Alert
              variant={uploadStatus === "success" ? "default" : "destructive"}
            >
              <div className="flex items-center gap-2">
                {uploadStatus === "success" ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                <AlertDescription>{statusMessage}</AlertDescription>
              </div>
            </Alert>
          )}

          {/* Help Text */}
          <div className="text-xs text-muted-foreground space-y-1">
            <div>{t("skills.uploader.helpZip")}</div>
            <div>{t("skills.uploader.helpTypes")}</div>
            <div>{t("skills.uploader.helpSize")}</div>
          </div>
        </div>
      </CardContent>

      {/* Conflict Dialog */}
      <Dialog open={conflictDialogOpen} onOpenChange={setConflictDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("skills.uploader.conflictTitle")}</DialogTitle>
            <DialogDescription>
              {t("skills.uploader.conflictDescription", {
                name: conflictingSkillName,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelReplace}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleConfirmReplace}>
              {t("skills.uploader.replace")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
