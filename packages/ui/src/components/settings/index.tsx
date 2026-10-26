import {
  AI_PROVIDERS,
  type AIProviderKey,
  type AppSettings,
  type CustomModelConfig,
  detectProviderFromHost,
  migrateSettings,
  PHI_APPROVED_PROVIDERS,
  type ProviderType,
  STORAGE_KEYS,
  SUPERSEDED_PRESET_HOSTS,
  type ToolCallingSupport,
  withSettingsDefaults,
} from "@apty/agent-core";
import {
  Activity,
  Bot,
  CheckCircle,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Info,
  Mic,
  Package,
  Palette,
  Plug,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../i18n/context";
import type { I18nContextValue, TranslationKey } from "../../i18n/types";
import { downloadText, timestampedFilename } from "../../lib/download";
import { cn } from "../../lib/utils";
import { useTheme } from "../../theme/context";
import { DEFAULT_MODELS } from "../chatbot/constants";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Notice } from "../ui/notice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { SettingRow } from "../ui/setting-row";
import { Switch } from "../ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { DataHandlingCard } from "./data-handling-card";
import { TroubleshootingCard } from "./troubleshooting-card";
import type { SaveStatus, SettingsPageProps, SettingsTab } from "./types";

const PROVIDER_TYPE_TO_KEY: Record<ProviderType, AIProviderKey> = {
  openai: "openai",
  google: "google",
  claude: "anthropic",
};

const PROVIDER_KEY_TO_TYPE: Partial<Record<AIProviderKey, ProviderType>> = {
  openai: "openai",
  google: "google",
  anthropic: "claude",
};

const buildDefaultProviderModels = (): CustomModelConfig[] =>
  (
    Object.entries(AI_PROVIDERS) as [
      AIProviderKey,
      (typeof AI_PROVIDERS)[AIProviderKey],
    ][]
  ).map(([key, provider]) => ({
    id: `builtin-${key}`,
    name: provider.name,
    providerType: provider.providerType,
    aiHost: "host" in provider ? (provider.host ?? "") : "",
    aiToken: "",
    aiModel: provider.models[0] ?? "",
    enabled: false,
  }));

const mergeWithDefaultProviders = (
  models: CustomModelConfig[],
): CustomModelConfig[] => {
  const existingIds = new Set(models.map((model) => model.id));
  const merged = models.map((model) => {
    const key = model.id.startsWith("builtin-")
      ? (model.id.slice("builtin-".length) as AIProviderKey)
      : null;
    const preset = key ? AI_PROVIDERS[key] : undefined;
    return key &&
      preset &&
      "host" in preset &&
      model.aiHost === SUPERSEDED_PRESET_HOSTS[key]
      ? { ...model, aiHost: preset.host }
      : model;
  });
  for (const model of buildDefaultProviderModels()) {
    if (!existingIds.has(model.id)) {
      merged.push(model);
    }
  }
  return merged;
};

const resolveProviderKey = (
  model: Pick<CustomModelConfig, "aiHost" | "providerType"> &
    Partial<Pick<CustomModelConfig, "id">>,
): AIProviderKey => {
  if (model.id?.startsWith("builtin-")) {
    const key = model.id.slice("builtin-".length) as AIProviderKey;
    if (AI_PROVIDERS[key]) return key;
  }
  const detected = model.aiHost ? detectProviderFromHost(model.aiHost) : null;
  if (detected && AI_PROVIDERS[detected]) {
    return detected;
  }
  return PROVIDER_TYPE_TO_KEY[model.providerType] ?? "openai";
};

const DEFAULT_MODEL_AUTO_VALUE = "__use-first-available__";

/**
 * UI-only hint, not a security boundary — the real enforcement (full
 * private-range handling, IP-literal normalization) lives in
 * validateHostUrl (apps/browser-extension/src/services/ai-provider.ts).
 * This just flags the common case so a user pointing at Ollama/LM Studio
 * sees a reassuring note instead of wondering why a non-https local host
 * is accepted.
 */
export const isLikelyLoopbackHost = (hostInput: string): boolean => {
  if (!hostInput) return false;
  let hostname: string;
  try {
    hostname = new URL(hostInput).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
};

const generateId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `custom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createEmptyCustomModel = (
  providerType: ProviderType = "openai",
): CustomModelConfig => {
  const providerKey = PROVIDER_TYPE_TO_KEY[providerType];
  const providerMeta = AI_PROVIDERS[providerKey];
  return {
    id: generateId(),
    name: "",
    providerType,
    aiHost:
      providerMeta && "host" in providerMeta ? (providerMeta.host ?? "") : "",
    aiToken: "",
    aiModel: providerMeta?.models?.[0] ?? "",
    enabled: false,
  };
};

const MODEL_EXPORT_FORMAT_VERSION = 1;

const VALID_PROVIDER_TYPES: readonly ProviderType[] = [
  "openai",
  "claude",
  "google",
];

interface ModelConfigExportFile {
  formatVersion: number;
  exportedAt: string;
  includesApiKeys: boolean;
  models: Partial<CustomModelConfig>[];
}

/** Serializes custom model configs to a portable JSON document. API keys are stripped unless `includeKeys` is explicitly true — exporting is opt-in to leak credentials, not opt-out. */
export function serializeModelsForExport(
  models: CustomModelConfig[],
  includeKeys: boolean,
): string {
  const exported: ModelConfigExportFile = {
    formatVersion: MODEL_EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    includesApiKeys: includeKeys,
    models: models.map((model) => {
      if (includeKeys) return model;
      const { aiToken: _aiToken, ...withoutToken } = model;
      return withoutToken;
    }),
  };
  return JSON.stringify(exported, null, 2);
}

/** Parses a model-config export file back into CustomModelConfig entries. Always assigns fresh ids (avoids colliding with existing models on import) and always imports as disabled (an imported config shouldn't silently become the active provider — the user re-enables it explicitly after reviewing it). Throws with a descriptive message on malformed input rather than silently producing garbage entries. */
export function parseImportedModels(jsonText: string): CustomModelConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Not valid JSON.");
  }
  const models = (parsed as Partial<ModelConfigExportFile> | null)?.models;
  if (!Array.isArray(models)) {
    throw new Error(
      "Missing a 'models' array — not a model-config export file.",
    );
  }
  return models.map((entry) => {
    const raw = (entry ?? {}) as Partial<CustomModelConfig>;
    const providerType = VALID_PROVIDER_TYPES.includes(
      raw.providerType as ProviderType,
    )
      ? (raw.providerType as ProviderType)
      : "openai";
    return {
      id: generateId(),
      name: typeof raw.name === "string" ? raw.name : "",
      providerType,
      aiHost: typeof raw.aiHost === "string" ? raw.aiHost : "",
      aiToken: typeof raw.aiToken === "string" ? raw.aiToken : "",
      aiModel: typeof raw.aiModel === "string" ? raw.aiModel : "",
      ...(typeof raw.aiWorkspaceId === "string"
        ? { aiWorkspaceId: raw.aiWorkspaceId }
        : {}),
      enabled: false,
    };
  });
}

interface ResolvedModelConfig {
  activeModel: CustomModelConfig | undefined;
  aiHost: string;
  aiToken: string;
  aiModel: string;
  aiWorkspaceId: string | undefined;
  providerType: ProviderType;
  providerKey: AIProviderKey;
}

/** The settings a request for this model config is made with. */
const settingsForModel = (
  settings: AppSettings,
  model: CustomModelConfig,
): AppSettings => ({
  ...settings,
  aiHost: model.aiHost,
  aiToken: model.aiToken,
  aiModel: model.aiModel,
  aiWorkspaceId: model.aiWorkspaceId,
  aiProvider: resolveProviderKey(model),
  providerType: model.providerType,
});

/** The last probe, for the model id currently set, found no tool calling. */
const failedToolProbe = (model: CustomModelConfig): boolean =>
  model.toolCalling?.support === "no" &&
  model.toolCalling.model === model.aiModel;

type Translate = I18nContextValue["t"];

const toolProbeWarning = (modelId: string, t: Translate): string =>
  t("providerErrors.toolCallingWarning", { model: modelId });

const TOOL_PROBE_LABEL: Record<ToolCallingSupport, TranslationKey> = {
  yes: "providerErrors.toolCallingYes",
  no: "providerErrors.toolCallingNo",
  unknown: "providerErrors.toolCallingUnknown",
};

const toolProbeLabel = (support: ToolCallingSupport, t: Translate): string =>
  t(TOOL_PROBE_LABEL[support]);

const resolveActiveModel = (
  settings: AppSettings,
  customModels: CustomModelConfig[],
  selectedModelId: string | null,
): ResolvedModelConfig => {
  const enabledModels = customModels.filter((model) => model.enabled);
  const selected = selectedModelId
    ? customModels.find((model) => model.id === selectedModelId)
    : undefined;
  const activeModel = selected?.enabled ? selected : enabledModels[0];

  const providerType =
    activeModel?.providerType ?? settings.providerType ?? "openai";
  const providerKey: AIProviderKey =
    activeModel !== undefined
      ? resolveProviderKey({
          id: activeModel.id,
          aiHost: activeModel.aiHost ?? "",
          providerType: providerType as ProviderType,
        })
      : (settings.aiProvider ?? "openai");
  const providerMeta = AI_PROVIDERS[providerKey];

  const aiHost =
    activeModel?.aiHost ??
    (providerMeta && "host" in providerMeta ? (providerMeta.host ?? "") : "") ??
    settings.aiHost ??
    "";
  const aiToken = activeModel?.aiToken ?? settings.aiToken ?? "";
  const aiModel = activeModel?.aiModel ?? settings.aiModel ?? "";
  const aiWorkspaceId = activeModel
    ? activeModel.aiWorkspaceId
    : settings.aiWorkspaceId;

  return {
    activeModel,
    aiHost,
    aiToken,
    aiModel,
    aiWorkspaceId,
    providerType: providerType as ProviderType,
    providerKey,
  };
};

const ERROR_MESSAGES = {
  enableOneModel: "providerErrors.enableOneModel",
  fillRequired: "providerErrors.fillRequired",
} as const satisfies Record<string, TranslationKey>;

const createErrorMessage = (
  key: keyof typeof ERROR_MESSAGES,
  t: Translate,
): string => t(ERROR_MESSAGES[key]);

export function SettingsPage({
  storageAdapter,
  storageKey = STORAGE_KEYS.SETTINGS,
  className,
  onSave,
  onTestConnection,
  onFetchModels,
  skillsContent,
  connectionContent,
  permissionsContent,
  sttConfig,
  initialTab,
  activeTab: controlledTab,
  onTabChange,
  initialSkill: _initialSkill,
  redactionPreview,
  recentRequests,
}: SettingsPageProps) {
  // initialSkill is reserved for future use (pre-select a skill when initialTab="skills")
  void _initialSkill;
  const { t, language, changeLanguage } = useTranslation();
  const { theme, changeTheme, effectiveTheme } = useTheme();

  useEffect(() => {
    const container = document.querySelector("#root");
    if (container) {
      if (effectiveTheme === "dark") {
        container.classList.add("dark");
      } else {
        container.classList.remove("dark");
      }
    }
  }, [effectiveTheme]);

  const [settings, setSettings] = useState<AppSettings>({});
  const [customModels, setCustomModels] = useState<CustomModelConfig[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  // "Fetch models": the live list per model config, and the last fetch's status.
  const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>(
    {},
  );
  const [modelFetch, setModelFetch] = useState<{
    state: "idle" | "loading" | "done" | "error";
    message: string;
  }>({ state: "idle", message: "" });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({
    type: "",
    message: "",
  });
  const [showToken, setShowToken] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    controlledTab ?? initialTab ?? "general",
  );
  useEffect(() => {
    if (controlledTab) setActiveTab(controlledTab);
  }, [controlledTab]);
  const [searchTerm, setSearchTerm] = useState("");
  const [includeKeysOnExport, setIncludeKeysOnExport] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  // ElevenLabs STT state (independent of main settings blob)
  const [sttApiKey, setSttApiKey] = useState("");
  const [sttModelId, setSttModelId] = useState("");
  const [showSttKey, setShowSttKey] = useState(false);
  const [isSavingStt, setIsSavingStt] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const result = await storageAdapter.load(storageKey);
        const loadedSettings = withSettingsDefaults(
          migrateSettings(result).settings,
        );
        let loadedCustomModels = loadedSettings.customModels ?? [];
        const resolvedProviderType =
          loadedSettings.providerType ??
          PROVIDER_KEY_TO_TYPE[loadedSettings.aiProvider as AIProviderKey] ??
          "openai";

        if (
          loadedCustomModels.length === 0 &&
          (loadedSettings.aiHost ||
            loadedSettings.aiToken ||
            loadedSettings.aiModel)
        ) {
          loadedCustomModels = [
            {
              id: generateId(),
              name: loadedSettings.aiModel,
              providerType: resolvedProviderType,
              aiHost: loadedSettings.aiHost ?? "",
              aiToken: loadedSettings.aiToken ?? "",
              aiModel: loadedSettings.aiModel ?? "",
              aiWorkspaceId: loadedSettings.aiWorkspaceId,
              enabled: true,
            },
          ];
        }

        const mergedCustomModels =
          mergeWithDefaultProviders(loadedCustomModels);

        setSettings({
          ...loadedSettings,
          customModels: mergedCustomModels,
          providerType: resolvedProviderType,
          providerEnabled: loadedSettings.providerEnabled ?? false,
        });

        setCustomModels(mergedCustomModels);
        const initialSelection =
          mergedCustomModels.find((model) => model.enabled)?.id ||
          mergedCustomModels[0]?.id ||
          null;
        setSelectedModelId(initialSelection);
      } catch (error) {
        console.error("Failed to load settings:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, [storageAdapter, storageKey]);

  // Load ElevenLabs STT config when adapter is provided
  useEffect(() => {
    if (!sttConfig) return;
    sttConfig.load().then(({ apiKey, modelId }) => {
      setSttApiKey(apiKey);
      setSttModelId(modelId);
    });
  }, [sttConfig]);

  const updateSettingsFromModel = useCallback((model: CustomModelConfig) => {
    const providerKey = resolveProviderKey(model);
    setSettings((prev: AppSettings) => ({
      ...prev,
      aiHost: model.aiHost,
      aiToken: model.aiToken,
      aiModel: model.aiModel,
      aiWorkspaceId: model.aiWorkspaceId,
      aiProvider: providerKey,
      providerType: model.providerType,
      providerEnabled: model.enabled,
    }));
  }, []);

  useEffect(() => {
    setSettings((prev: AppSettings) => {
      const anyEnabled = customModels.some((model) => model.enabled);
      return {
        ...prev,
        customModels,
        providerEnabled: anyEnabled,
      };
    });
  }, [customModels]);

  useEffect(() => {
    if (!selectedModelId) return;
    const selected = customModels.find((model) => model.id === selectedModelId);
    if (selected) {
      updateSettingsFromModel(selected);
    }
  }, [customModels, selectedModelId, updateSettingsFromModel]);

  const handleSelectModel = useCallback(
    (id: string) => {
      const target = customModels.find((model) => model.id === id);
      if (
        target &&
        id !== selectedModelId &&
        failedToolProbe(target) &&
        !window.confirm(toolProbeWarning(target.aiModel, t))
      ) {
        return;
      }
      setSelectedModelId(id);
      setModelFetch({ state: "idle", message: "" });
      if (target) {
        updateSettingsFromModel(target);
      }
    },
    [customModels, selectedModelId, updateSettingsFromModel, t],
  );

  const handleFetchModels = useCallback(async () => {
    const model = customModels.find((m) => m.id === selectedModelId);
    if (!model || !onFetchModels) return;
    setModelFetch({ state: "loading", message: "" });
    try {
      const outcome = await onFetchModels(settingsForModel(settings, model));
      if (outcome.ok) {
        setFetchedModels((prev) => ({ ...prev, [model.id]: outcome.models }));
        setModelFetch({
          state: "done",
          message: t("providerErrors.modelsFetched", {
            count: outcome.models.length,
          }),
        });
      } else {
        setModelFetch({ state: "error", message: outcome.error });
      }
    } catch (error) {
      setModelFetch({
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [customModels, selectedModelId, onFetchModels, settings, t]);

  const handleModelFieldChange = useCallback(
    <K extends keyof CustomModelConfig>(
      key: K,
      value: CustomModelConfig[K],
    ) => {
      if (!selectedModelId) return;
      setCustomModels((prev) => {
        const next = prev.map((model) => {
          if (model.id !== selectedModelId) return model;
          // The first key typed into a provider turns it on: forgetting
          // the Enable switch was the most common first-run mistake.
          const firstKey =
            key === "aiToken" &&
            typeof value === "string" &&
            value.trim() !== "" &&
            !model.aiToken?.trim();
          return {
            ...model,
            [key]: value,
            ...(firstKey ? { enabled: true } : {}),
          };
        });
        const updated = next.find((model) => model.id === selectedModelId);
        if (updated) {
          updateSettingsFromModel(updated);
        }
        return next;
      });
    },
    [selectedModelId, updateSettingsFromModel],
  );

  const handleAddModel = useCallback(() => {
    const providerType = settings.providerType ?? "openai";
    const newModel = createEmptyCustomModel(providerType);
    setCustomModels((prev) => [...prev, newModel]);
    setSelectedModelId(newModel.id);
    updateSettingsFromModel(newModel);
  }, [settings.providerType, updateSettingsFromModel]);

  const handleExportModels = useCallback(() => {
    const json = serializeModelsForExport(customModels, includeKeysOnExport);
    downloadText(
      timestampedFilename("apty-model-configs", "json"),
      json,
      "application/json",
    );
  }, [customModels, includeKeysOnExport]);

  const handleImportFileSelected = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Allow re-selecting the same file later even if this import fails.
      e.target.value = "";
      if (!file) return;

      try {
        const text = await file.text();
        const imported = parseImportedModels(text);
        setCustomModels((prev) => [...prev, ...imported]);
        setImportError(null);
        setSaveStatus({
          type: "success",
          message: t("settings.importedModels", { count: imported.length }),
        });
        setTimeout(() => setSaveStatus({ type: "", message: "" }), 4000);
      } catch (error) {
        setImportError(error instanceof Error ? error.message : String(error));
      }
    },
    [t],
  );

  const handleDeleteModel = useCallback(
    (id: string) => {
      setCustomModels((prev) => {
        const remaining = prev.filter((model) => model.id !== id);
        const deletedModel = prev.find((model) => model.id === id);
        const nextSelected =
          selectedModelId === id ? (remaining[0]?.id ?? null) : selectedModelId;
        setSelectedModelId(nextSelected);
        if (nextSelected) {
          const nextModel = remaining.find(
            (model) => model.id === nextSelected,
          );
          if (nextModel) {
            updateSettingsFromModel(nextModel);
          }
        } else {
          setSettings((prevSettings: AppSettings) => ({
            ...prevSettings,
            aiHost: "",
            aiToken: "",
            aiModel: "",
            providerEnabled: false,
            defaultModel:
              prevSettings.defaultModel &&
              deletedModel &&
              prevSettings.defaultModel === deletedModel.aiModel
                ? undefined
                : prevSettings.defaultModel,
          }));
        }
        return remaining;
      });
    },
    [selectedModelId, updateSettingsFromModel],
  );

  const defaultModelOptions = useMemo(() => {
    const baseOptions = DEFAULT_MODELS.map(
      (model: { name: string; value: string }) => ({
        value: model.value,
        label: model.name,
      }),
    );

    const customOptions = customModels
      .filter((model) => model.enabled && model.aiModel.trim())
      .map((model) => ({
        value: model.aiModel,
        label:
          model.name?.trim() ||
          `${model.aiModel} (custom-${model.providerType})`,
      }));

    const seen = new Set<string>();
    const options = [...customOptions, ...baseOptions].filter((option) => {
      if (seen.has(option.value)) return false;
      seen.add(option.value);
      return true;
    });

    if (settings.defaultModel && !seen.has(settings.defaultModel)) {
      options.push({
        value: settings.defaultModel,
        label: settings.defaultModel,
      });
    }

    return options;
  }, [customModels, settings.defaultModel]);

  const handleDefaultModelChange = useCallback((value: string) => {
    setSettings((prev: AppSettings) => ({
      ...prev,
      defaultModel: value === DEFAULT_MODEL_AUTO_VALUE ? undefined : value,
    }));
  }, []);

  // General-tab switches take effect at once: that tab has no Save button.
  // Each patch is merged into what's stored, not into unsaved AI-tab edits.
  const generalSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const saveGeneralSetting = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettings((prev: AppSettings) => ({ ...prev, ...patch }));
      generalSaveQueue.current = generalSaveQueue.current.then(async () => {
        try {
          const stored = withSettingsDefaults(
            migrateSettings(await storageAdapter.load(storageKey)).settings,
          );
          await storageAdapter.save(storageKey, { ...stored, ...patch });
        } catch (error) {
          console.error("Failed to save setting:", error);
        }
      });
    },
    [storageAdapter, storageKey],
  );

  const handleSaveSettings = useCallback(async () => {
    setIsSaving(true);
    setSaveStatus({ type: "", message: "" });

    const enabledModels = customModels.filter((model) => model.enabled);

    const availableDefaultModels = new Set(
      defaultModelOptions.map((option) => option.value),
    );
    const resolvedDefaultModel =
      settings.defaultModel && availableDefaultModels.has(settings.defaultModel)
        ? settings.defaultModel
        : undefined;

    const hasIncomplete = enabledModels.some(
      (model) => !model.aiToken || !model.aiModel,
    );
    if (hasIncomplete) {
      setSaveStatus({
        type: "error",
        message: createErrorMessage("fillRequired", t),
      });
      setIsSaving(false);
      return;
    }

    try {
      const {
        activeModel,
        aiHost,
        aiToken,
        aiModel,
        aiWorkspaceId,
        providerType,
        providerKey,
      } = resolveActiveModel(settings, customModels, selectedModelId);

      const settingsToSave = {
        ...settings,
        aiHost,
        aiToken,
        aiModel,
        aiWorkspaceId,
        aiProvider: providerKey,
        providerType,
        providerEnabled:
          enabledModels.length > 0 ? (activeModel?.enabled ?? false) : false,
        customModels,
        defaultModel: resolvedDefaultModel,
      };
      await storageAdapter.save(storageKey, settingsToSave);
      onSave?.(settingsToSave);
      setSaveStatus({
        type: "success",
        message: t("settings.saveSuccess"),
      });
      setTimeout(() => setSaveStatus({ type: "", message: "" }), 3000);
    } catch (error) {
      console.error("Error saving settings:", error);
      setSaveStatus({
        type: "error",
        message: t("settings.saveError"),
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    settings,
    customModels,
    selectedModelId,
    storageAdapter,
    storageKey,
    onSave,
    t,
    defaultModelOptions,
  ]);

  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setSaveStatus({ type: "", message: "" });

    const {
      activeModel,
      aiHost,
      aiToken,
      aiModel,
      aiWorkspaceId,
      providerType,
      providerKey,
    } = resolveActiveModel(settings, customModels, selectedModelId);

    if (!activeModel) {
      setSaveStatus({
        type: "error",
        message: createErrorMessage("enableOneModel", t),
      });
      setIsTesting(false);
      return;
    }

    if (!aiToken || !aiModel) {
      setSaveStatus({
        type: "error",
        message: createErrorMessage("fillRequired", t),
      });
      setIsTesting(false);
      return;
    }

    try {
      if (!onTestConnection) {
        setSaveStatus({
          type: "error",
          message: t("providerErrors.handlerMissing"),
        });
        setIsTesting(false);
        return;
      }

      const outcome = await onTestConnection({
        ...settings,
        aiHost,
        aiToken,
        aiModel,
        aiWorkspaceId,
        aiProvider: providerKey,
        providerType,
        customModels,
      });

      const { ok, toolCalling } =
        typeof outcome === "boolean" ? { ok: outcome } : outcome;
      if (ok && toolCalling && activeModel) {
        setCustomModels((prev) =>
          prev.map((model) =>
            model.id === activeModel.id
              ? {
                  ...model,
                  toolCalling: { model: aiModel, support: toolCalling },
                }
              : model,
          ),
        );
      }
      if (ok) {
        setSaveStatus({
          type: toolCalling === "no" ? "error" : "success",
          message: toolCalling
            ? `${t("settings.testSuccess")} · ${toolProbeLabel(toolCalling, t)}`
            : t("settings.testSuccess"),
        });
      } else {
        setSaveStatus({
          type: "error",
          message: t("settings.testFailed"),
        });
      }
      setTimeout(() => setSaveStatus({ type: "", message: "" }), 5000);
    } catch (error) {
      console.error("Connection test error:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : t("providerErrors.unknownError");
      setSaveStatus({
        type: "error",
        message: `${t("settings.testFailed")}: ${errorMessage}`,
      });
      setTimeout(() => setSaveStatus({ type: "", message: "" }), 8000);
    } finally {
      setIsTesting(false);
    }
  }, [settings, customModels, selectedModelId, onTestConnection, t]);

  const handleReset = useCallback(() => {
    if (confirm(t("settings.resetConfirm"))) {
      setCustomModels([]);
      setSettings({});
      setSelectedModelId(null);
      setSaveStatus({
        type: "info",
        message: t("settings.resetDone"),
      });
    }
  }, [t]);

  const handleSaveStt = useCallback(async () => {
    if (!sttConfig) return;
    setIsSavingStt(true);
    try {
      await sttConfig.save({ apiKey: sttApiKey, modelId: sttModelId });
      setSaveStatus({ type: "success", message: t("settings.saveSuccess") });
      setTimeout(() => setSaveStatus({ type: "", message: "" }), 3000);
    } catch (error) {
      console.error("Error saving STT settings:", error);
      setSaveStatus({ type: "error", message: t("settings.saveError") });
    } finally {
      setIsSavingStt(false);
    }
  }, [sttConfig, sttApiKey, sttModelId, t]);

  const filteredModels = useMemo(() => {
    const term = searchTerm.toLowerCase();
    if (!term) return customModels;
    return customModels.filter((model) => {
      const name = model.name?.toLowerCase() ?? "";
      const modelName = model.aiModel?.toLowerCase() ?? "";
      return name.includes(term) || modelName.includes(term);
    });
  }, [customModels, searchTerm]);

  const selectedModel = selectedModelId
    ? customModels.find((model) => model.id === selectedModelId)
    : undefined;

  const selectedProviderKey: AIProviderKey = selectedModel
    ? resolveProviderKey(selectedModel)
    : ("openai" as AIProviderKey);

  const selectedProviderMeta = AI_PROVIDERS[selectedProviderKey];
  const enabledCustomModelsForActions = customModels.filter(
    (model) => model.enabled,
  );
  const actionModel = selectedModel?.enabled
    ? selectedModel
    : enabledCustomModelsForActions[0];
  const canTest =
    !!actionModel &&
    actionModel.enabled &&
    Boolean(actionModel.aiToken) &&
    Boolean(actionModel.aiModel);
  const canSave = enabledCustomModelsForActions.length === 0 || canTest;

  if (isLoading) {
    return (
      <div
        className={cn(
          "min-h-screen bg-background flex items-center justify-center",
          className,
        )}
      >
        <Card className="w-80">
          <CardContent className="pt-4 sm:pt-6">
            <div className="text-center space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent mx-auto" />
              <p className="text-muted-foreground">{t("common.processing")}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("min-h-screen bg-background", className)}>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-180 items-center gap-2 px-4 pt-4 sm:px-6">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground"
          >
            <Activity className="size-4" />
          </span>
          <span className="text-sm font-medium text-muted-foreground">
            {t("shell.appName")}
          </span>
        </div>
        <div className="mx-auto max-w-180 px-4 pt-2 pb-4 sm:px-6">
          <h1 className="text-display font-semibold text-foreground">
            {t("settings.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("settings.extensionSubtitle")}
          </p>
        </div>
      </header>

      {saveStatus.message && (
        <div className="fixed top-4 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2">
          <Notice
            tone={
              saveStatus.type === "error"
                ? "error"
                : saveStatus.type === "success"
                  ? "success"
                  : "info"
            }
            className="animate-in fade-in slide-in-from-top-2 shadow-lg duration-200 motion-reduce:animate-none"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="font-medium">{saveStatus.message}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("common.dismiss")}
                onClick={() => setSaveStatus({ type: "", message: "" })}
                className="-mt-1 -mr-1 shrink-0"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          </Notice>
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(value: string) => {
          setActiveTab(value as SettingsTab);
          onTabChange?.(value as SettingsTab);
        }}
        className="w-full"
      >
        <div className="sticky top-0 z-40 border-b border-border bg-background">
          <TabsList
            variant="underline"
            className="mx-auto max-w-180 border-b-0 px-2 sm:px-4"
          >
            <TabsTrigger variant="underline" value="general">
              <Settings aria-hidden="true" className="size-4" />
              {t("settings.general")}
            </TabsTrigger>
            <TabsTrigger variant="underline" value="ai">
              <Bot aria-hidden="true" className="size-4" />
              {t("settings.aiConfiguration")}
            </TabsTrigger>
            {skillsContent && (
              <TabsTrigger variant="underline" value="skills">
                <Package aria-hidden="true" className="size-4" />
                {t("settings.skillsTab")}
              </TabsTrigger>
            )}
            {connectionContent && (
              <TabsTrigger variant="underline" value="connection">
                <Plug aria-hidden="true" className="size-4" />
                {t("settings.aptyIntegration")}
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <div className="mx-auto max-w-180 px-4 py-6 sm:px-6">
          {/* General Tab */}
          <TabsContent value="general" className="mt-0 space-y-4">
            <div className="grid gap-4">
              {/* Language Selection */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="h-5 w-5" />
                    {t("settings.language")}
                  </CardTitle>
                  <CardDescription>
                    {t("settings.languageHint")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    {(["en", "zh"] as const).map((lang) => (
                      <Button
                        key={lang}
                        variant={language === lang ? "default" : "outline"}
                        onClick={() => changeLanguage(lang)}
                        className="h-auto p-4 flex flex-col items-center gap-2"
                      >
                        <span className="text-title">
                          {lang === "en" ? "🇺🇸" : "🇨🇳"}
                        </span>
                        <span className="font-medium">
                          {t(`language.${lang}`)}
                        </span>
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Theme Selection */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="h-5 w-5" />
                    {t("settings.theme")}
                  </CardTitle>
                  <CardDescription>{t("settings.themeHint")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-3">
                    {(["light", "dark", "system"] as const).map(
                      (themeOption) => (
                        <Button
                          key={themeOption}
                          variant={
                            theme === themeOption ? "default" : "outline"
                          }
                          onClick={() => changeTheme(themeOption)}
                          className="h-auto p-4 flex flex-col items-center gap-2"
                        >
                          <span className="text-display">
                            {themeOption === "light" && "☀️"}
                            {themeOption === "dark" && "🌙"}
                            {themeOption === "system" && "💻"}
                          </span>
                          <span className="text-sm font-medium">
                            {t(`theme.${themeOption}`)}
                          </span>
                        </Button>
                      ),
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Privacy Section — a truthful statement, not a control: no
                analytics/telemetry code exists anywhere in this product, so
                there is nothing here for a toggle to turn on or off. */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Info className="h-5 w-5" />
                  {t("settings.privacy")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-sm leading-relaxed">
                    {t("settings.privacyNotice")}
                  </p>
                </div>
              </CardContent>
            </Card>

            <DataHandlingCard
              settings={settings}
              language={language}
              onChange={saveGeneralSetting}
              redactionPreview={redactionPreview}
              recentRequests={recentRequests}
            />

            <TroubleshootingCard
              settings={settings}
              language={language}
              onChange={saveGeneralSetting}
            />

            {/* Skill execution toggle — off by default. Running a skill
                script executes untrusted, author-supplied code in a QuickJS
                sandbox, through a fetch bridge with a documented residual
                DNS-rebinding risk. */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  {t("settings.skillExecution")}
                </CardTitle>
                <CardDescription>
                  {t("settings.skillExecutionHint")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <SettingRow
                  label={t("settings.enableSkillExecution")}
                  control={
                    <Switch
                      aria-label={t("settings.enableSkillExecution")}
                      checked={settings.skillExecutionEnabled === true}
                      onCheckedChange={(checked) =>
                        saveGeneralSetting({ skillExecutionEnabled: checked })
                      }
                    />
                  }
                />
                <Notice tone="warning">
                  {t("settings.skillExecutionWarning")}
                </Notice>
              </CardContent>
            </Card>

            {permissionsContent}

            {/* ElevenLabs STT Configuration (shown when adapter provided) */}
            {sttConfig && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mic className="h-5 w-5" />
                    {t("settings.sttTitle")}
                  </CardTitle>
                  <CardDescription>
                    {t("settings.sttDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="sttApiKey">
                      {t("settings.sttApiKey")}
                      <span className="text-destructive ml-1">*</span>
                    </Label>
                    <div className="relative">
                      <Input
                        id="sttApiKey"
                        type={showSttKey ? "text" : "password"}
                        value={sttApiKey}
                        onChange={(e) => setSttApiKey(e.target.value)}
                        placeholder="xi-..."
                        className="font-mono pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowSttKey(!showSttKey)}
                        aria-label={t(
                          showSttKey
                            ? "settings.hideApiKey"
                            : "settings.showApiKey",
                        )}
                        aria-pressed={showSttKey}
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      >
                        {showSttKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.sttGetKey")}{" "}
                      <a
                        href="https://elevenlabs.io/app/developers/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        elevenlabs.io
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sttModelId">
                      {t("settings.sttModelId")}
                    </Label>
                    <Input
                      id="sttModelId"
                      className="font-mono"
                      type="text"
                      value={sttModelId}
                      onChange={(e) => setSttModelId(e.target.value)}
                      placeholder={t("settings.sttModelPlaceholder")}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("settings.sttModelHint")}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={handleSaveStt}
                      disabled={isSavingStt}
                      size="sm"
                    >
                      {isSavingStt ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                          {t("common.saving")}
                        </>
                      ) : (
                        t("settings.saveConfiguration")
                      )}
                    </Button>
                    {sttApiKey && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSttApiKey("");
                          setSaveStatus({
                            type: "info",
                            message: t("settings.cleared"),
                          });
                        }}
                      >
                        {t("settings.clear")}
                      </Button>
                    )}
                  </div>

                  {sttApiKey && (
                    <Alert>
                      <AlertDescription className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-success" />
                        <span className="text-sm">
                          {t("settings.sttKeyConfigured")}
                        </span>
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* AI Configuration Tab — this product is BYOK-only (there is no
              login or proxy fallback), so the fields are always shown; there
              is no gate toggle to enable them first. */}
          <TabsContent value="ai" className="mt-0 space-y-4">
            <div className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bot className="h-5 w-5" />
                    {t("settings.defaultModel")}
                  </CardTitle>
                  <CardDescription>
                    {t("settings.defaultModelHint")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Select
                    value={settings.defaultModel || DEFAULT_MODEL_AUTO_VALUE}
                    onValueChange={handleDefaultModelChange}
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label={t("settings.defaultModel")}
                    >
                      <SelectValue
                        placeholder={t("settings.useFirstAvailable")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_MODEL_AUTO_VALUE}>
                        {t("settings.useFirstAvailable")}
                      </SelectItem>
                      {defaultModelOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>
            </div>

            {/* overflow-clip, not overflow-hidden: it rounds the corners
                without breaking the sticky footer below. */}
            <Card id="ai-provider" className="scroll-mt-4 overflow-clip">
              <div className="flex" style={{ minHeight: "500px" }}>
                {/* Left Sidebar - Custom Model List */}
                <div className="w-72 border-r flex flex-col">
                  {/* Search + Add */}
                  <div className="p-3 border-b space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="text"
                        value={searchTerm}
                        placeholder={t("settings.searchProviders")}
                        className="pl-9"
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleAddModel}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {t("settings.addModel")}
                    </Button>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1"
                        onClick={handleExportModels}
                        disabled={customModels.length === 0}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        {t("settings.export")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1"
                        onClick={() => importFileInputRef.current?.click()}
                      >
                        <Upload className="h-4 w-4 mr-1" />
                        {t("settings.import")}
                      </Button>
                      <input
                        ref={importFileInputRef}
                        type="file"
                        accept="application/json"
                        className="hidden"
                        onChange={handleImportFileSelected}
                      />
                    </div>
                    <SettingRow
                      label={t("settings.includeKeysOnExport")}
                      control={
                        <Switch
                          aria-label={t("settings.includeKeysOnExport")}
                          checked={includeKeysOnExport}
                          onCheckedChange={setIncludeKeysOnExport}
                        />
                      }
                    />
                    {importError && (
                      <Alert variant="destructive">
                        <AlertDescription className="text-xs">
                          {t("settings.importFailed")} {importError}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>

                  {/* Model List */}
                  <div className="flex-1 overflow-y-auto">
                    {filteredModels.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground space-y-3">
                        <Search className="w-12 h-12 mx-auto text-muted-foreground" />
                        <p className="text-sm">
                          {t("settings.noProvidersFound")}
                        </p>
                        <Button size="sm" onClick={handleAddModel}>
                          {t("settings.createModel")}
                        </Button>
                      </div>
                    ) : (
                      filteredModels.map((model) => {
                        const providerKey = resolveProviderKey(model);
                        const provider = AI_PROVIDERS[providerKey];
                        const isSelected = selectedModelId === model.id;
                        const displayName =
                          model.name?.trim() ||
                          model.aiModel ||
                          provider.name ||
                          t("settings.aiModel");

                        return (
                          <div
                            key={model.id}
                            className={cn(
                              "flex items-center group border-b border-border/40",
                              isSelected ? "bg-primary/5" : "",
                            )}
                          >
                            <Button
                              variant="ghost"
                              onClick={() => handleSelectModel(model.id)}
                              className={cn(
                                "w-full justify-start h-auto p-4 border-l-2 rounded-none text-left",
                                isSelected
                                  ? "border-primary bg-primary/5"
                                  : "border-transparent",
                              )}
                            >
                              <div className="flex items-center w-full gap-3">
                                <div
                                  className={cn(
                                    "w-8 h-8 rounded-lg flex items-center justify-center text-title",
                                    isSelected ? "bg-primary/10" : "bg-muted",
                                  )}
                                >
                                  {provider.icon}
                                </div>
                                <div className="flex-1">
                                  <div className="text-sm font-medium">
                                    {displayName}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {provider.name}
                                  </div>
                                </div>
                                {failedToolProbe(model) && (
                                  <Badge variant="destructive">
                                    {t("settings.noTools")}
                                  </Badge>
                                )}
                                {model.enabled && (
                                  <Badge variant="default">
                                    {t("settings.current")}
                                  </Badge>
                                )}
                              </div>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                              aria-label={`${t("settings.deleteModel")} ${model.name || model.aiModel || ""}`.trim()}
                              onClick={() => handleDeleteModel(model.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Right Panel - Configuration Details */}
                <div className="flex-1 flex flex-col">
                  {/* Header */}
                  <div className="p-6 border-b">
                    <div className="flex items-center justify-between">
                      {selectedModel ? (
                        <>
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-display">
                              {selectedProviderMeta.icon}
                            </div>
                            <div>
                              <h3 className="text-title font-semibold">
                                {selectedModel.name?.trim() ||
                                  selectedModel.aiModel ||
                                  t("settings.aiModel")}
                              </h3>
                              <p className="text-sm text-muted-foreground">
                                {selectedProviderMeta.name}
                              </p>
                              {"experimental" in selectedProviderMeta &&
                                selectedProviderMeta.experimental && (
                                  <p
                                    role="note"
                                    className="text-xs text-destructive"
                                  >
                                    {t("settings.experimental")}{" "}
                                    {selectedProviderMeta.experimental}
                                  </p>
                                )}
                              {!PHI_APPROVED_PROVIDERS.has(
                                selectedProviderKey,
                              ) && (
                                <p role="note" className="text-xs text-warning">
                                  {t("settings.phiProviderWarning")}
                                </p>
                              )}
                              {selectedProviderMeta.docs && (
                                <Button
                                  variant="link"
                                  size="sm"
                                  asChild
                                  className="h-auto p-0"
                                >
                                  <a
                                    href={selectedProviderMeta.docs}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1"
                                  >
                                    {t("settings.getApiKey")}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">
                              {t("settings.enable")}
                            </span>
                            <Switch
                              aria-label={t("settings.enable")}
                              checked={selectedModel.enabled}
                              onCheckedChange={(checked) =>
                                handleModelFieldChange("enabled", checked)
                              }
                            />
                          </div>
                        </>
                      ) : (
                        <div className="text-muted-foreground">
                          {t("settings.selectOrCreateModel")}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Configuration Form */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    {selectedModel ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="modelName">
                            {t("settings.displayName")}
                          </Label>
                          <Input
                            id="modelName"
                            type="text"
                            value={selectedModel.name || ""}
                            onChange={(e) =>
                              handleModelFieldChange("name", e.target.value)
                            }
                            placeholder={t("settings.displayNamePlaceholder")}
                          />
                        </div>

                        {/* Provider Type */}
                        <div className="space-y-2">
                          <Label htmlFor="providerType">
                            {t("settings.providerType")}
                            <span className="text-destructive ml-1">*</span>
                          </Label>
                          <Select
                            value={selectedModel.providerType}
                            onValueChange={(value: ProviderType) =>
                              handleModelFieldChange("providerType", value)
                            }
                          >
                            <SelectTrigger id="providerType">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="openai">OpenAI</SelectItem>
                              <SelectItem value="claude">Claude</SelectItem>
                              <SelectItem value="google">Google</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* API Host */}
                        <div className="space-y-2">
                          <Label htmlFor="aiHost">{t("settings.aiHost")}</Label>
                          <Input
                            id="aiHost"
                            className="font-mono"
                            type="url"
                            value={selectedModel.aiHost || ""}
                            onChange={(e) =>
                              handleModelFieldChange("aiHost", e.target.value)
                            }
                            placeholder={
                              "host" in selectedProviderMeta
                                ? (selectedProviderMeta.host ?? "")
                                : ""
                            }
                          />
                          {isLikelyLoopbackHost(selectedModel.aiHost || "") && (
                            <Alert>
                              <AlertDescription className="text-xs leading-relaxed">
                                {t("settings.localAddressNotice")}
                              </AlertDescription>
                            </Alert>
                          )}
                        </div>

                        {/* API Token */}
                        <div className="space-y-2">
                          <Label htmlFor="aiToken">
                            {t("settings.aiToken")}
                            <span className="text-destructive ml-1">*</span>
                          </Label>
                          <div className="relative">
                            <Input
                              id="aiToken"
                              type={showToken ? "text" : "password"}
                              value={selectedModel.aiToken || ""}
                              onChange={(e) =>
                                handleModelFieldChange(
                                  "aiToken",
                                  e.target.value,
                                )
                              }
                              placeholder={
                                selectedProviderMeta.tokenPlaceholder
                              }
                              className="font-mono pr-10"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => setShowToken(!showToken)}
                              aria-label={t(
                                showToken
                                  ? "settings.hideApiKey"
                                  : "settings.showApiKey",
                              )}
                              aria-pressed={showToken}
                              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                            >
                              {showToken ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>

                        {selectedProviderKey === "anthropic" && (
                          <div className="space-y-2">
                            <Label htmlFor="aiWorkspaceId">
                              {t("settings.aiWorkspaceId")}
                            </Label>
                            <Input
                              id="aiWorkspaceId"
                              className="font-mono"
                              value={selectedModel.aiWorkspaceId || ""}
                              onChange={(e) =>
                                handleModelFieldChange(
                                  "aiWorkspaceId",
                                  e.target.value,
                                )
                              }
                              placeholder="wrkspc_…"
                              aria-describedby="aiWorkspaceIdHint"
                              autoComplete="off"
                              spellCheck={false}
                            />
                            <p
                              id="aiWorkspaceIdHint"
                              className="text-xs text-muted-foreground"
                            >
                              {t("settings.aiWorkspaceIdHint")}
                            </p>
                          </div>
                        )}

                        {/* Model Selection — a free-text combobox: presets
                            (when the provider has any) show as native
                            suggestions, but typing an arbitrary model id
                            always works, for providers/models not in the
                            preset list. */}
                        <div className="space-y-2">
                          <Label htmlFor="aiModel">
                            {t("settings.aiModel")}
                            <span className="text-destructive ml-1">*</span>
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              id="aiModel"
                              className="font-mono"
                              type="text"
                              list={`aiModel-suggestions-${selectedModel.id}`}
                              value={selectedModel.aiModel || ""}
                              onChange={(e) =>
                                handleModelFieldChange(
                                  "aiModel",
                                  e.target.value,
                                )
                              }
                              placeholder={t("settings.modelPlaceholder")}
                            />
                            {onFetchModels && (
                              <Button
                                type="button"
                                variant="outline"
                                onClick={handleFetchModels}
                                disabled={
                                  !selectedModel.aiToken?.trim() ||
                                  modelFetch.state === "loading"
                                }
                              >
                                {t(
                                  modelFetch.state === "loading"
                                    ? "providerErrors.fetchingModels"
                                    : "providerErrors.fetchModels",
                                )}
                              </Button>
                            )}
                          </div>
                          {modelFetch.message && (
                            <p
                              role={
                                modelFetch.state === "error"
                                  ? "alert"
                                  : "status"
                              }
                              className={cn(
                                "text-xs",
                                modelFetch.state === "error"
                                  ? "text-destructive"
                                  : "text-muted-foreground",
                              )}
                            >
                              {modelFetch.message}
                              {modelFetch.state === "error" &&
                                ` ${t("providerErrors.fetchFallback")}`}
                            </p>
                          )}
                          {(fetchedModels[selectedModel.id]?.length ?? 0) +
                            selectedProviderMeta.models.length >
                            0 && (
                            <datalist
                              id={`aiModel-suggestions-${selectedModel.id}`}
                            >
                              {[
                                ...new Set([
                                  ...(fetchedModels[selectedModel.id] ?? []),
                                  ...selectedProviderMeta.models,
                                ]),
                              ].map((model: string) => (
                                <option key={model} value={model} />
                              ))}
                            </datalist>
                          )}
                          {selectedModel.toolCalling?.model ===
                            selectedModel.aiModel &&
                            selectedModel.toolCalling && (
                              <Badge
                                variant={
                                  selectedModel.toolCalling.support === "no"
                                    ? "destructive"
                                    : selectedModel.toolCalling.support ===
                                        "yes"
                                      ? "default"
                                      : "secondary"
                                }
                              >
                                {toolProbeLabel(
                                  selectedModel.toolCalling.support,
                                  t,
                                )}
                              </Badge>
                            )}
                          <p className="text-xs text-muted-foreground">
                            {t("settings.modelTip")}
                          </p>
                        </div>
                      </>
                    ) : (
                      <div className="text-center text-muted-foreground py-12">
                        {t("settings.selectOrCreateModelLeft")}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons - Footer, kept in view while the
                      provider list scrolls the page */}
                  <div className="sticky bottom-0 z-10 border-t bg-muted p-6">
                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        onClick={handleTestConnection}
                        disabled={isTesting || !canTest}
                        className="flex-1"
                      >
                        {isTesting ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent mr-2" />
                            {t("settings.testing")}
                          </>
                        ) : (
                          t("settings.testConnection")
                        )}
                      </Button>

                      <Button
                        onClick={handleSaveSettings}
                        disabled={isSaving || !canSave}
                        className="flex-1"
                      >
                        {isSaving ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                            {t("common.saving")}
                          </>
                        ) : (
                          t("common.save")
                        )}
                      </Button>

                      <Button
                        variant="outline"
                        onClick={handleReset}
                        disabled={isSaving}
                      >
                        {t("settings.reset")}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* Skills Tab */}
          {skillsContent && (
            <TabsContent value="skills" className="mt-0 space-y-4">
              {skillsContent}
            </TabsContent>
          )}

          {/* Connection Tab */}
          {connectionContent && (
            <TabsContent value="connection" className="mt-0 space-y-4">
              {connectionContent}
            </TabsContent>
          )}
        </div>
      </Tabs>
    </div>
  );
}

export type { SettingsPageProps, STTConfigAdapter } from "./types";
