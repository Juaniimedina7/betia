import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@bet/db", "@bet/odds-api-client", "@bet/combo-engine", "@bet/mcp-tools"],
};

export default nextConfig;
