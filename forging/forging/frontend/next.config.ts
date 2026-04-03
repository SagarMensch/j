import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

function loadSharedEnv() {
  const envPath = path.resolve(process.cwd(), "..", ".env");
  const values: Record<string, string> = {};

  if (!fs.existsSync(envPath)) {
    return values;
  }

  for (const rawLine of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    values[key] = value;

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return values;
}

const sharedEnv = loadSharedEnv();

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  env: {
    FASTAPI_URL: sharedEnv.FASTAPI_URL || process.env.FASTAPI_URL || "http://127.0.0.1:8000",
    NEXT_PUBLIC_FASTAPI_URL:
      sharedEnv.NEXT_PUBLIC_FASTAPI_URL ||
      process.env.NEXT_PUBLIC_FASTAPI_URL ||
      "http://127.0.0.1:8000",
  },
};

export default nextConfig;
