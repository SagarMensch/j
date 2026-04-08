import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Force workspace root to this monorepo and avoid lockfile auto-detection drift.
  outputFileTracingRoot: path.join(__dirname, ".."),
};

export default nextConfig;
