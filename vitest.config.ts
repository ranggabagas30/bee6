import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror the tsconfig `@/*` -> `./*` path alias so tests can import
    // modules the same way route handlers and pages do.
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/.claude/**"],
    // Slow loop tests (calendar.test.ts, demo/service.test.ts, session/route.test.ts,
    // capture/page.test.tsx) timeout under load. 30s allows them to pass when run in
    // parallel on a loaded machine without changing test logic or adding retries.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
