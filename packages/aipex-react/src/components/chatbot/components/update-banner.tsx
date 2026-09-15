import { ArrowUpCircleIcon, SparklesIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";

export interface VersionCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string | null;
  changelogUrl: string;
  isNewlyUpdated: boolean;
  notes: string | null;
}

interface UpdateBannerProps {
  className?: string;
  /** Function to check version */
  onCheckVersion?: () => Promise<VersionCheckResult>;
  /** Function to check if update is dismissed for a version */
  onIsUpdateDismissed?: (version: string) => Promise<boolean>;
  /** Function to dismiss update for a version */
  onDismissUpdate?: (version: string) => Promise<void>;
  /** Function to request update from Chrome */
  onRequestUpdate?: () => Promise<{
    status: "update_available" | "no_update" | "throttled" | "error";
    version?: string;
  }>;
  /** Function to open changelog */
  onOpenChangelog?: (url: string) => void;
  /** Function to open update page */
  onOpenUpdatePage?: () => void;
}

/**
 * Update Banner Component
 * Shows update notification when a new version is available
 * Also shows "What's New" for users who just updated
 */
// Default translations for the update banner
const defaultTranslations = {
  "update.whatsNewTitle": "What's New in v{{version}}",
  "update.whatsNewDescription": "See what's changed in this version",
  "update.viewChanges": "View Changes",
  "update.newVersionAvailable": "Update Available: v{{version}}",
  "update.currentVersion": "Current: v{{version}}",
  "update.restartRequired": "Restart to complete update",
  "update.updating": "Checking...",
  "update.openStore": "Open Store",
  "update.updateNow": "Update Now",
};

export function UpdateBanner({
  className,
  onCheckVersion,
  onIsUpdateDismissed,
  onDismissUpdate,
  onRequestUpdate,
  onOpenChangelog,
  onOpenUpdatePage,
}: UpdateBannerProps) {
  // Simple translation function with variable substitution
  const t = (key: string, vars?: Record<string, unknown>): string => {
    let text =
      defaultTranslations[key as keyof typeof defaultTranslations] || key;
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        text = text.replace(`{{${k}}}`, String(v));
      });
    }
    return text;
  };
  const [versionInfo, setVersionInfo] = useState<VersionCheckResult | null>(
    null,
  );
  const [isVisible, setIsVisible] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "ready" | "failed"
  >("idle");

  useEffect(() => {
    const checkVersionAndShow = async () => {
      if (!onCheckVersion) return;

      try {
        const result = await onCheckVersion();
        setVersionInfo(result);

        // Show "What's New" for newly updated users
        if (result.isNewlyUpdated) {
          setShowWhatsNew(true);
          setIsVisible(true);
          return;
        }

        // Check if update is available and not dismissed
        if (result.hasUpdate && result.latestVersion) {
          const dismissed = onIsUpdateDismissed
            ? await onIsUpdateDismissed(result.latestVersion)
            : false;
          if (!dismissed) {
            setIsVisible(true);
          }
        }
      } catch (error) {
        console.error("[UpdateBanner] Failed to check version:", error);
      }
    };

    checkVersionAndShow();
  }, [onCheckVersion, onIsUpdateDismissed]);

  const handleDismiss = async () => {
    if (versionInfo?.latestVersion && onDismissUpdate) {
      await onDismissUpdate(versionInfo.latestVersion);
    }
    setIsVisible(false);
    setShowWhatsNew(false);
  };

  const handleUpdate = async () => {
    if (!onRequestUpdate) {
      onOpenUpdatePage?.();
      return;
    }

    setUpdateStatus("checking");

    try {
      const result = await onRequestUpdate();

      if (result.status === "update_available") {
        // Update is available and will be installed
        setUpdateStatus("ready");
        console.log(
          "[UpdateBanner] Update available, version:",
          result.version,
        );
      } else {
        // Failed or throttled, fallback to opening store
        console.log("[UpdateBanner] Update check result:", result.status);
        setUpdateStatus("failed");
        // Open store page as fallback
        setTimeout(() => {
          onOpenUpdatePage?.();
        }, 1000);
      }
    } catch (error) {
      console.error("[UpdateBanner] Update request failed:", error);
      setUpdateStatus("failed");
      // Open store page as fallback
      setTimeout(() => {
        onOpenUpdatePage?.();
      }, 1000);
    }
  };

  const handleWhatsNew = () => {
    if (versionInfo?.changelogUrl && onOpenChangelog) {
      onOpenChangelog(versionInfo.changelogUrl);
    }
    // After viewing What's New, hide the banner
    setShowWhatsNew(false);
    setIsVisible(false);
  };

  if (!isVisible) {
    return null;
  }

  // "What's New" banner for newly updated users
  if (showWhatsNew) {
    return (
      <div
        className={cn(
          "relative flex items-center justify-between gap-3 px-4 py-3",
          "bg-accent border-b border-border",
          "animate-in slide-in-from-top duration-300",
          className,
        )}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex-shrink-0 p-1.5 rounded-full bg-background">
            <SparklesIcon
              className="size-4 text-foreground"
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate">
              {t("update.whatsNewTitle", {
                version: versionInfo?.currentVersion,
              })}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {t("update.whatsNewDescription")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-3"
            onClick={handleWhatsNew}
          >
            {t("update.viewChanges")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleDismiss}
          >
            <XIcon className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  // Update available banner
  if (versionInfo?.hasUpdate) {
    return (
      <div
        className={cn(
          "relative flex items-center justify-between gap-3 px-4 py-3",
          "bg-info/10 border-b border-info/30",
          "animate-in slide-in-from-top duration-300",
          className,
        )}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex-shrink-0 p-1.5 rounded-full bg-info/15">
            <ArrowUpCircleIcon className="size-4 text-info" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate">
              {t("update.newVersionAvailable", {
                version: versionInfo.latestVersion,
              })}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {t("update.currentVersion", {
                version: versionInfo.currentVersion,
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {updateStatus === "ready" ? (
            <div className="text-xs text-info font-medium">
              {t("update.restartRequired")}
            </div>
          ) : (
            <Button
              variant="default"
              size="sm"
              className="h-8 px-3"
              onClick={handleUpdate}
              disabled={
                updateStatus === "checking" || updateStatus === "failed"
              }
            >
              {updateStatus === "checking"
                ? t("update.updating")
                : updateStatus === "failed"
                  ? t("update.openStore")
                  : t("update.updateNow")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleDismiss}
          >
            <XIcon className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
