/** Languages a message can name, by their ISO 639-1 code. */
export const LANGUAGE_CODES: Readonly<Record<string, string>> = {
  arabic: "ar",
  chinese: "zh",
  czech: "cs",
  danish: "da",
  dutch: "nl",
  english: "en",
  finnish: "fi",
  french: "fr",
  german: "de",
  greek: "el",
  hebrew: "he",
  hindi: "hi",
  hungarian: "hu",
  indonesian: "id",
  italian: "it",
  japanese: "ja",
  korean: "ko",
  norwegian: "no",
  polish: "pl",
  portuguese: "pt",
  romanian: "ro",
  russian: "ru",
  spanish: "es",
  swedish: "sv",
  thai: "th",
  turkish: "tr",
  ukrainian: "uk",
  vietnamese: "vi",
};

/**
 * Older or narrower codes for the same language that content can carry
 * (iw and in before ISO 639 changed them, Norwegian Bokmål and Nynorsk).
 * Whether the player treats them as the code above is not verified.
 */
export const OTHER_LANGUAGE_CODES: Readonly<Record<string, readonly string[]>> =
  { he: ["iw"], id: ["in"], no: ["nb", "nn"] };

/** "French" for "fr"; the code itself for one this table does not name. */
export function languageName(code: string): string {
  const name = Object.keys(LANGUAGE_CODES).find(
    (n) => LANGUAGE_CODES[n] === code,
  );
  return name ? name[0]?.toUpperCase() + name.slice(1) : code;
}
