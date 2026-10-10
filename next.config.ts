import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Single Cloud Run service `web` in asia-southeast2 serves both the UI
  // and the API routes — no static export, no separate backend.
  output: "standalone",
  // @google/adk statically reaches optional peers (express, MCP SDK, @google-cloud/storage, mikro-orm) through
  // modules R-08 never uses; Turbopack fails resolving them. Load ADK with native require instead (R-08 Task 0).
  serverExternalPackages: ["@google/adk"],
};

export default nextConfig;
