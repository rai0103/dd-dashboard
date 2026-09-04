import type { NextConfig } from "next";

const isGithubPages = process.env.DEPLOY_TARGET === "github-pages";

const nextConfig: NextConfig = {
  output: "export",
  basePath: isGithubPages ? "/dd-dashboard" : "",
  assetPrefix: isGithubPages ? "/dd-dashboard/" : "",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
