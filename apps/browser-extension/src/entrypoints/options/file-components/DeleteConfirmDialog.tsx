import { Button } from "@apty/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@apty/ui/components/ui/dialog";
import { useTranslation } from "@apty/ui/i18n/context";
import { AlertTriangle } from "lucide-react";
import type React from "react";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  fileName: string;
  fileType: "file" | "directory";
}

export const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
  fileName,
  fileType,
}) => {
  const { t } = useTranslation();
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            {t("fileManager.confirmDelete")}
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <p>
              {t("fileManager.deletePrompt")}{" "}
              <span className="font-semibold">{fileName}</span>
              {t("fileManager.deletePromptEnd")}
            </p>
            {fileType === "directory" && (
              <p className="text-destructive">
                {t("fileManager.deleteFolderWarning")}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {t("fileManager.cannotUndo")}
            </p>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            {t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
