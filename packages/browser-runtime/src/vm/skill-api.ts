/**
 * SKILL_API Bridge
 * Defines the API interface available to skills and implements the bridge
 * between QuickJS VM and the host environment
 */

import { createLogger } from "@apty/agent-core";
import type { FileStats } from "./types";
import { assertSkillFetchUrlAllowed } from "./url-guard";
import { zenfs } from "./zenfs-manager";

const log = createLogger("SkillAPI");

export type { FileStats };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: any;
  handler?: string;
}

/**
 * SKILL_API interface available to skills
 */
export interface SkillAPIBridge {
  // Tool Management
  registerTool(definition: ToolDefinition): Promise<void>;

  // File System (ZenFS)
  fs: {
    readFile(path: string, encoding?: string): Promise<string | Uint8Array>;
    writeFile(path: string, data: string | Uint8Array): Promise<void>;
    readdir(path: string): Promise<string[]>;
    exists(path: string): Promise<boolean>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    rm(path: string, options?: { recursive?: boolean }): Promise<void>;
    stat(path: string): Promise<FileStats>;
    existsSync(path: string): boolean;
    readFileSync(path: string, encoding?: string): string | Uint8Array;
    writeFileSync(path: string, data: string | Uint8Array): void;
    readdirSync(path: string): string[];
    mkdirSync(path: string, options?: { recursive?: boolean }): void;
    rmSync(path: string, options?: { recursive?: boolean }): void;
    statSync(path: string): FileStats;
  };

  // Console (forwards to host console)
  console: {
    log(...args: any[]): void;
    error(...args: any[]): void;
    warn(...args: any[]): void;
  };

  // HTTP Requests
  fetch(url: string, options?: RequestInit): Promise<any>;

  // Browser Downloads
  downloadFile(
    data: string,
    options?: {
      filename?: string;
      encoding?: "base64" | "utf8";
      saveAs?: boolean;
    },
  ): Promise<{ success: boolean; downloadId?: number; error?: string }>;

  // Chrome APIs (to be implemented)
  chrome?: {
    tabs?: any;
    storage?: any;
    runtime?: any;
  };
}

/**
 * Create a SKILL_API bridge instance
 */
export function createSkillAPIBridge(options: {
  skillId: string;
  onToolRegister?: (tool: ToolDefinition) => Promise<void>;
}): SkillAPIBridge {
  const { skillId, onToolRegister } = options;

  return {
    // Tool Registration
    async registerTool(definition: ToolDefinition): Promise<void> {
      log.debug(`Registering tool: ${definition.name}`);

      if (onToolRegister) {
        await onToolRegister(definition);
      } else {
        console.warn("[SKILL_API] No tool registration handler provided");
      }
    },

    // File System API
    fs: {
      async readFile(
        path: string,
        encoding?: string,
      ): Promise<string | Uint8Array> {
        log.debug(`fs.readFile: ${path}`);

        const result = await zenfs.readFile(path, encoding as BufferEncoding);

        // Convert Buffer to Uint8Array before passing to VM
        // This is critical: Buffer objects don't serialize properly across VM boundary
        if (
          !encoding &&
          result &&
          typeof result === "object" &&
          !(result instanceof Uint8Array)
        ) {
          // It's a Buffer, convert to Uint8Array
          return new Uint8Array(result as Buffer);
        }

        return result as string | Uint8Array;
      },

      async writeFile(path: string, data: string | Uint8Array): Promise<void> {
        log.debug(`fs.writeFile: ${path}`);
        await zenfs.writeFile(path, data);
      },

      async readdir(path: string): Promise<string[]> {
        log.debug(`fs.readdir: ${path}`);
        return await zenfs.readdir(path);
      },

      async exists(path: string): Promise<boolean> {
        log.debug(`fs.exists: ${path}`);
        return await zenfs.exists(path);
      },

      async mkdir(
        path: string,
        options?: { recursive?: boolean },
      ): Promise<void> {
        log.debug(`fs.mkdir: ${path}`);
        await zenfs.mkdir(path, options);
      },

      async rm(path: string, options?: { recursive?: boolean }): Promise<void> {
        log.debug(`fs.rm: ${path}`);
        await zenfs.rm(path, options);
      },

      async stat(path: string): Promise<FileStats> {
        log.debug(`fs.stat: ${path}`);
        return await zenfs.stat(path);
      },

      existsSync(path: string): boolean {
        log.debug(`fs.existsSync: ${path}`);
        return zenfs.existsSync(path);
      },

      readFileSync(path: string, encoding?: string): string | Uint8Array {
        log.debug(`fs.readFileSync: ${path}`);
        const result = zenfs.readFileSync(path, encoding as BufferEncoding);

        // Convert Buffer to Uint8Array before passing to VM
        // This is critical: Buffer objects don't serialize properly across VM boundary
        if (
          !encoding &&
          result &&
          typeof result === "object" &&
          !(result instanceof Uint8Array)
        ) {
          // It's a Buffer, convert to Uint8Array
          return new Uint8Array(result as Buffer);
        }

        return result;
      },

      writeFileSync(path: string, data: string | Uint8Array): void {
        log.debug(`fs.writeFileSync: ${path}`);
        zenfs.writeFileSync(path, data);
      },

      readdirSync(path: string): string[] {
        log.debug(`fs.readdirSync: ${path}`);
        return zenfs.readdirSync(path);
      },

      mkdirSync(path: string, options?: { recursive?: boolean }): void {
        log.debug(`fs.mkdirSync: ${path}`);
        zenfs.mkdirSync(path, options);
      },

      rmSync(path: string, options?: { recursive?: boolean }): void {
        log.debug(`fs.rmSync: ${path}`);
        zenfs.rmSync(path, options);
      },

      statSync(path: string): FileStats {
        log.debug(`fs.statSync: ${path}`);
        return zenfs.statSync(path);
      },
    },

    // Console API - forwards to host console with skill prefix
    console: {
      log(...args: any[]): void {
        log.debug(`[Skill:${skillId}]`, ...args);
      },

      error(...args: any[]): void {
        console.error(`[Skill:${skillId}]`, ...args);
      },

      warn(...args: any[]): void {
        console.warn(`[Skill:${skillId}]`, ...args);
      },
    },

    // Fetch API - uses host fetch
    async fetch(url: string, options?: RequestInit): Promise<any> {
      // SSRF guard: skills are untrusted code. Reject requests targeting
      // private/internal network ranges or non-http(s) schemes before they
      // reach the host fetch in the extension service worker context.
      let validatedUrl: URL;
      try {
        validatedUrl = assertSkillFetchUrlAllowed(url);
      } catch (error: any) {
        console.error("[SKILL_API] Fetch blocked:", error?.message);
        throw new Error(`Fetch failed: ${error?.message || String(error)}`);
      }

      log.debug(`fetch: ${validatedUrl.host}`);

      // Only these options pass through. Never follow redirects, so the
      // SSRF guard can't be bypassed by a public host that redirects to an
      // internal address, and never send the user's cookies: under
      // <all_urls> that would let a skill read any site the user is
      // signed in to.
      const safeOptions: RequestInit = {
        method: options?.method,
        headers: options?.headers,
        body: options?.body,
        redirect: "error",
        credentials: "omit",
      };

      try {
        const response = await fetch(validatedUrl.toString(), safeOptions);

        // Convert response to a plain object that can be serialized
        const result = {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          url: response.url,
          // Try to parse as JSON, fallback to text
          body: await response.text(),
        };

        // Try to parse body as JSON
        try {
          result.body = JSON.parse(result.body);
        } catch {
          // Keep as text
        }

        return result;
      } catch (error: any) {
        console.error("[SKILL_API] Fetch error:", error);
        throw new Error(`Fetch failed: ${error.message}`);
      }
    },

    // Download File API - triggers browser download from Base64 or text data
    async downloadFile(
      data: string,
      options?: {
        filename?: string;
        encoding?: "base64" | "utf8";
        saveAs?: boolean;
      },
    ): Promise<{ success: boolean; downloadId?: number; error?: string }> {
      const filename = options?.filename || "download";
      log.debug(`downloadFile: ${filename}`);

      try {
        // Check if downloads permission is available
        if (!chrome?.downloads) {
          throw new Error(
            "Downloads permission not available. Please check extension permissions.",
          );
        }

        // Validate that filename is provided
        if (!options?.filename) {
          throw new Error("filename option is required");
        }

        const encoding = options?.encoding || "utf8";
        let uint8Array: Uint8Array;

        if (encoding === "base64") {
          // Decode Base64 string to Uint8Array
          const binaryString = atob(data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          uint8Array = bytes;
        } else {
          // Treat as UTF-8 text
          const encoder = new TextEncoder();
          uint8Array = encoder.encode(data);
        }

        // Determine MIME type from filename extension
        const extension = filename.split(".").pop()?.toLowerCase();
        let mimeType = "application/octet-stream";
        if (extension === "zip") {
          mimeType = "application/zip";
        } else if (extension === "json") {
          mimeType = "application/json";
        } else if (extension === "txt" || extension === "md") {
          mimeType = "text/plain";
        }

        // Convert to base64 data URI
        const base64String = btoa(
          String.fromCharCode(...Array.from(uint8Array)),
        );
        const dataUri = `data:${mimeType};base64,${base64String}`;

        // Trigger download using chrome.downloads API
        const downloadId = await chrome.downloads.download({
          url: dataUri,
          filename: filename,
          saveAs: options?.saveAs ?? true, // Default to showing save dialog
        });

        log.debug(
          `Download triggered successfully: ${filename} (ID: ${downloadId})`,
        );
        return {
          success: true,
          downloadId,
        };
      } catch (error: any) {
        console.error("[SKILL_API] Download error:", error);
        return {
          success: false,
          error: error?.message || String(error),
        };
      }
    },
  };
}

/**
 * SKILL_API type definition for TypeScript skills
 */
export type SkillAPI = SkillAPIBridge;
