import type en from "./locales/en.json";

export type Language = "en" | "zh";

/** The English resources define the shape; `locales.test.ts` holds zh.json to it. */
export type TranslationResources = typeof en;

/** Every dotted path to a string in `T`, such as `"common.save"`. */
type LeafKeys<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : LeafKeys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type BaseTranslationKey = LeafKeys<TranslationResources>;

export type TranslationKey = BaseTranslationKey | `tools.${string}`;

export interface I18nContextValue {
  language: Language;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  changeLanguage: (lang: Language) => Promise<void>;
}
