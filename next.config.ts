import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;
