/**
 * Selection Card
 *
 * Clean and colorful user selection card
 */

import { CheckIcon } from "lucide-react";
import type React from "react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "../../i18n/hooks.js";
import type { TranslationKey } from "../../i18n/types.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Notice } from "../ui/notice.js";
import { OptionCard } from "../ui/option-card.js";
import type { InterventionStatus } from "./InterventionCard.js";
import { InterventionCard } from "./InterventionCard.js";

export interface SelectionOption {
  id: string;
  label: string;
  description?: string;
}

export interface UserSelectionResult {
  selectedOptions: SelectionOption[];
  otherText?: string;
}

interface SelectionCardProps {
  status: InterventionStatus;
  question?: string;
  options?: SelectionOption[];
  mode?: "single" | "multiple";
  allowOther?: boolean;
  reason?: string;
  timeout?: number;
  selectedResult?: UserSelectionResult;
  onConfirm?: (result: UserSelectionResult) => void;
  onCancel?: () => void;
}

export const SelectionCard: React.FC<SelectionCardProps> = ({
  status,
  question,
  options = [],
  mode = "single",
  allowOther = false,
  reason,
  timeout,
  selectedResult,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const groupId = useId();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [otherSelected, setOtherSelected] = useState(false);
  const [otherText, setOtherText] = useState("");

  // Normalize options: convert string array to object array
  const normalizedOptions = useMemo(() => {
    return options.map((opt: unknown, index: number) => {
      if (typeof opt === "string") {
        return {
          id: `option-${index}`,
          label: opt,
        };
      }
      if (opt && typeof opt === "object" && ("label" in opt || "id" in opt)) {
        const optObj = opt as {
          id?: string;
          label?: string;
          description?: string;
        };
        return {
          id: optObj.id || `option-${index}`,
          label:
            optObj.label ||
            optObj.id ||
            `${t("interventions.selection.promptSingle" as TranslationKey)} ${index + 1}`,
          description: optObj.description,
        };
      }
      return {
        id: `option-${index}`,
        label: String(opt),
      };
    });
  }, [options, t]);

  const isActive = status === "active" || status === "pending";
  const isCompleted = status === "completed";

  // Handle option click
  const handleOptionClick = (optionId: string) => {
    if (!isActive) return;

    if (mode === "single") {
      setSelectedIds(new Set([optionId]));
      setOtherSelected(false);
    } else {
      const newSelected = new Set(selectedIds);
      if (newSelected.has(optionId)) {
        newSelected.delete(optionId);
      } else {
        newSelected.add(optionId);
      }
      setSelectedIds(newSelected);
    }
  };

  // Handle "other" option click
  const handleOtherClick = () => {
    if (!isActive) return;

    if (mode === "single") {
      setSelectedIds(new Set());
      setOtherSelected(true);
    } else {
      setOtherSelected(!otherSelected);
    }
  };

  // Check if can confirm
  const canConfirm =
    selectedIds.size > 0 || (otherSelected && otherText.trim().length > 0);

  // Handle confirm
  const handleConfirm = () => {
    if (!canConfirm || !onConfirm) return;

    const selectedOptions = normalizedOptions.filter((opt) => {
      return selectedIds.has(opt.id);
    });

    const result: UserSelectionResult = {
      selectedOptions,
      otherText: otherSelected ? otherText.trim() : undefined,
    };

    onConfirm(result);
  };

  const optionCard = (
    id: string,
    title: string,
    description: string | undefined,
    checked: boolean,
    onToggle: () => void,
  ) => (
    <OptionCard
      key={id}
      type={mode === "single" ? "radio" : "checkbox"}
      name={`${groupId}-option`}
      value={id}
      checked={checked}
      onChange={onToggle}
      disabled={!isActive}
      title={title}
      description={description}
    />
  );

  return (
    <InterventionCard
      status={status}
      title={t("interventions.selection.title" as TranslationKey)}
      reason={reason}
      timeout={timeout}
      onCancel={onCancel}
    >
      {isActive && (
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium text-foreground">
              {question ||
                t(
                  mode === "single"
                    ? "interventions.selection.promptSingle"
                    : ("interventions.selection.promptMultiple" as TranslationKey),
                )}
            </legend>
            {normalizedOptions.map((option) =>
              optionCard(
                option.id,
                option.label,
                option.description,
                selectedIds.has(option.id),
                () => handleOptionClick(option.id),
              ),
            )}
            {allowOther &&
              optionCard(
                `${groupId}-other`,
                t("interventions.selection.other" as TranslationKey),
                t("interventions.selection.otherDescription" as TranslationKey),
                otherSelected,
                handleOtherClick,
              )}
            {allowOther && otherSelected && (
              <Input
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder={t(
                  "interventions.selection.otherPlaceholder" as TranslationKey,
                )}
                aria-label={t(
                  "interventions.selection.other" as TranslationKey,
                )}
                disabled={!isActive}
              />
            )}
          </fieldset>

          {question && (
            <p className="text-xs text-muted-foreground">
              {t(
                mode === "single"
                  ? "interventions.selection.promptSingle"
                  : ("interventions.selection.promptMultiple" as TranslationKey),
              )}
            </p>
          )}

          <Button
            type="button"
            size="lg"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="w-full"
          >
            <CheckIcon aria-hidden="true" />
            {t("interventions.selection.confirmButton" as TranslationKey)}
          </Button>
        </div>
      )}

      {isCompleted && selectedResult && (
        <Notice
          tone="success"
          title={t("interventions.selection.completed" as TranslationKey)}
        >
          <ul className="mt-1 space-y-1">
            {selectedResult.selectedOptions.map((option) => (
              <li key={option.id}>
                <span className="font-medium">{option.label}</span>
                {option.description && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {option.description}
                  </span>
                )}
              </li>
            ))}
            {selectedResult.otherText && (
              <li>
                <span className="font-medium">
                  {t("interventions.selection.other" as TranslationKey)}:{" "}
                </span>
                {selectedResult.otherText}
              </li>
            )}
          </ul>
        </Notice>
      )}

      {status === "cancelled" && (
        <p className="text-sm text-muted-foreground">
          {t("interventions.selection.cancelled" as TranslationKey)}
        </p>
      )}

      {status === "timeout" && (
        <Notice tone="warning">
          {t("interventions.selection.timeout" as TranslationKey)}
        </Notice>
      )}

      {status === "error" && (
        <Notice tone="error">
          {t("interventions.selection.error" as TranslationKey)}
        </Notice>
      )}
    </InterventionCard>
  );
};
