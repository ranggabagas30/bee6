import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Single Cloud Run service `web` in asia-southeast2 serves both the UI
  // and the API routes — no static export, no separate backend.
  output: "standalone",
};

export default nextConfig;
