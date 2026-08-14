import { resolve } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    useTypeScriptCli: true,
  },
  reactStrictMode: true,
  transpilePackages: ["@wikirunner/contracts"],
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  turbopack: {
    root: resolve(import.meta.dirname, "../.."),
  },
};

export default nextConfig;
