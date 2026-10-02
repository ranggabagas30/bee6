import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Convention used across stub/testable callbacks: an intentionally
      // unused parameter is prefixed with `_` (see scripts/probe.ts).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    // Vendored, minified capture assets (VAD worklet + ORT loaders), copied from
    // node_modules by scripts/vendor-capture-assets.mjs — not our source.
    "public/vendor/**",
    // Local git worktrees (created under .claude/worktrees/ by agents/sessions for
    // isolated builds) carry their own build artifacts (e.g. a nested .next/).
    // They are local-only and never committed, so nothing inside them should be
    // scanned from the main checkout.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
