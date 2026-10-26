import { ConfirmDialog } from "@apty/ui/components/ui/confirm-dialog";
import { useTranslation } from "@apty/ui/i18n/context";
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
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("fileManager.confirmDelete")}
      description={
        <>
          {t("fileManager.deletePrompt")}{" "}
          <span className="font-mono text-foreground">{fileName}</span>
          {t("fileManager.deletePromptEnd")} {t("fileManager.cannotUndo")}
        </>
      }
      confirmLabel={t("common.delete")}
      onConfirm={() => {
        onConfirm();
        onOpenChange(false);
      }}
    >
      {fileType === "directory" && (
        <p className="text-sm text-destructive">
          {t("fileManager.deleteFolderWarning")}
        </p>
      )}
    </ConfirmDialog>
  );
};
