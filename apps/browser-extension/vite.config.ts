import path from "node:path";
import { crx, type ManifestV3Export } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { build, defineConfig, type Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import manifest from "./manifest.json";

// console.warn/error stay: they report real failures in the field.
const DEBUG_CONSOLE_CALLS = ["console.log", "console.info", "console.debug"];

const CONSOLE_BRIDGE = path.resolve(
  __dirname,
  "src/entrypoints/content/console-bridge.ts",
);

/**
 * Bundle a content script with its imports inlined. crxjs only skips its
 * async `import()` loader for a chunk with no imports, and the console
 * bridge must hook `console` before the page's own scripts run.
 */
function selfContainedContentScript(entry: string): Plugin {
  return {
    name: "apty:self-contained-content-script",
    apply: "build",
    async load(id) {
      if (id !== entry) return null;
      const result = await build({
        configFile: false,
        logLevel: "warn",
        build: {
          write: false,
          minify: false,
          lib: { entry, formats: ["iife"], name: "aptyConsoleBridge" },
        },
      });
      const [output] = Array.isArray(result) ? result : [result];
      if (!("output" in output)) throw new Error("Unexpected watcher output");
      return output.output[0].code;
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  esbuild: {
    pure: mode === "production" ? DEBUG_CONSOLE_CALLS : [],
  },
  plugins: [
    react(),
    selfContainedContentScript(CONSOLE_BRIDGE),
    crx({ manifest: manifest as unknown as ManifestV3Export }),
    viteStaticCopy({
      targets: [
        {
          src: "assets/*",
          dest: "assets",
        },
      ],
    }),
  ],
  // Optimize dependencies - hooks are now properly isolated
  optimizeDeps: {
    // No longer need to exclude hooks since they're not in the main export path
    include: ["react", "react-dom"],
  },
  resolve: {
    // Dedupe React to ensure single instance across all chunks
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
    alias: [
      { find: "~", replacement: path.resolve(__dirname, "./src") },
      { find: "@", replacement: path.resolve(__dirname, "./") },
      // Point to workspace packages source code directly for better dev experience
      {
        find: "@apty/agent-core",
        replacement: path.resolve(
          __dirname,
          "../../packages/agent-core/src/index.ts",
        ),
      },
      {
        find: /^@apty\/ui\/(.*)$/,
        replacement: path.resolve(__dirname, "../../packages/ui/src/$1"),
      },
      {
        find: "@apty/ui",
        replacement: path.resolve(__dirname, "../../packages/ui/src/index.ts"),
      },
      {
        find: /^@apty\/browser-runtime\/(.*)$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/browser-runtime/src/$1",
        ),
      },
      {
        find: "@apty/browser-runtime",
        replacement: path.resolve(
          __dirname,
          "../../packages/browser-runtime/src/index.ts",
        ),
      },
      {
        find: /^@apty\/dom-snapshot\/(.*)$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/dom-snapshot/src/$1",
        ),
      },
      {
        find: "@apty/dom-snapshot",
        replacement: path.resolve(
          __dirname,
          "../../packages/dom-snapshot/src/index.ts",
        ),
      },
    ],
  },
  css: {
    postcss: "./postcss.config.js", // Use config file instead of inline
    devSourcemap: true, // Enable sourcemaps for debugging
  },
  build: {
    rollupOptions: {
      input: {
        // Note: sidepanel entry is handled by @crxjs/vite-plugin via manifest.json
        // side_panel.default_path -> src/entrypoints/sidepanel/index.html -> ./index.tsx
        options: path.resolve(__dirname, "src/entrypoints/options/index.html"),
      },
    },
    // Ensure CSS is extracted properly
    cssCodeSplit: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
      // Improve HMR reliability
      overlay: true,
    },
    // Force watch Tailwind files for better HMR
    watch: {
      ignored: ["!**/node_modules/@tailwindcss/**"],
    },
  },
}));
