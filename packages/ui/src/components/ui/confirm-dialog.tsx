import * as React from "react";

import { useTranslation } from "../../i18n/context";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

/**
 * A confirmation before a destructive action: the title and what will
 * happen, Cancel on the left with the initial focus, and the danger action
 * on the right. While `pending`, both buttons are disabled and Esc or a
 * click outside does not close it.
 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  pending = false,
  onCloseAutoFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
  confirmLabel: React.ReactNode;
  /** The safe action's label; "Cancel" when absent. */
  cancelLabel?: React.ReactNode;
  onConfirm: () => void;
  pending?: boolean;
  /** Where focus goes on close when the opener is gone (call `preventDefault`). */
  onCloseAutoFocus?: (event: Event) => void;
  /** More detail under the description, such as what else is removed. */
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const cancel = React.useRef<HTMLButtonElement>(null);
  const holdWhilePending = (event: Event) => {
    if (pending) event.preventDefault();
  };
  return (
    <Dialog open={open} onOpenChange={(next) => pending || onOpenChange(next)}>
      <DialogContent
        role="alertdialog"
        showCloseButton={!pending}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={holdWhilePending}
        onInteractOutside={holdWhilePending}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button
            ref={cancel}
            variant="secondary"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ConfirmDialog };
