/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_HOST?: string;
  readonly VITE_AI_TOKEN?: string;
  readonly VITE_AI_MODEL?: string;
  readonly VITE_DEV_MODE?: string;
  /** Base URL for the website (e.g., "https://www.claudechrome.com") */
  readonly VITE_WEBSITE_URL?: string;

  // Apty integration placeholders — see .env.example. Empty/undefined means
  // "not configured", which the corresponding diagnostics provider reports
  // as status: "not_configured" rather than failing.
  readonly VITE_APTY_STUDIO_EXTENSION_ID?: string;
  readonly VITE_APTY_WIDGET_EXTENSION_ID?: string;
  readonly VITE_APTY_CLIENT_EXTENSION_ID?: string;
  readonly VITE_APTY_SERVICE_WORKER_EXTENSION_ID?: string;
  readonly VITE_APTY_SERVICE_WORKER_DIAGNOSTIC_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Support for CSS imports with ?inline suffix
declare module "*.css?inline" {
  const content: string;
  export default content;
}
