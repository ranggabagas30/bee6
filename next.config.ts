import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Single Cloud Run service `web` in asia-southeast2 serves both the UI
  // and the API routes — no static export, no separate backend.
  output: "standalone",
  // @google/adk statically reaches optional peers (express, MCP SDK, @google-cloud/storage, mikro-orm) through
  // modules R-08 never uses; Turbopack fails resolving them. Load ADK with native require instead (R-08 Task 0).
  serverExternalPackages: ["@google/adk"],
  // R-21 D6: favicon.ico 404 fix. Clients (Safari, bots) that ask for /favicon.ico get the generated /icon route.
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icon" }];
  },
};

export default nextConfig;
