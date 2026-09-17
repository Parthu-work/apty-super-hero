/**
 * Environment type definitions for @apty/ui
 * These are build-time environment variables when bundled with Vite.
 */

interface ImportMetaEnv {
  /** Base URL for the website (e.g., "https://app.apty.ai") */
  readonly VITE_WEBSITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
