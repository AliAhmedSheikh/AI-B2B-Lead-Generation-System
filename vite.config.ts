// vite.config.ts — custom config goes here via defineConfig({ vite: { ... } })
// Note: tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro, and other
// standard plugins are already included by the base config. Do not add them manually.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
