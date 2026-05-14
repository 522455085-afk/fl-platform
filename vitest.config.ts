import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Vitest config — minimal jsdom environment so React components and
 * DOM-touching hooks/utilities can be exercised without spinning up a
 * full browser. Path alias mirrors `tsconfig.json` so `@/...` imports
 * resolve identically in tests.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // Coverage settings
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/**",
        "*.config.*",
        "vitest.setup.ts",
        "**/*.d.ts",
        "src/app/**",
        "src/lib/mock-data.ts",
      ],
    },
  },
});
