import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    useTypeScriptCli: true,
  },
  reactStrictMode: true,
  transpilePackages: ["@wikirunner/contracts"],
};

export default nextConfig;
