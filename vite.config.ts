// vite.config.ts — custom config goes here via defineConfig({ vite: { ... } })
// Note: tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro, and other
// standard plugins are already included by the base config. Do not add them manually.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
});
