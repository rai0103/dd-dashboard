import type { NextConfig } from "next";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const isGithubPages = process.env.DEPLOY_TARGET === "github-pages";
const basePath = isGithubPages ? "/dd-dashboard" : "";

// ビルドごとのID。画面に埋め込み、同じIDを public/version.json にも書き出す。開いたままのページ（特にスマホのホーム画面アプリ）が
// 復帰時に version.json と比べ、新しいバージョンがデプロイされていれば再読み込みする（lib/sync・取り込みの変更を古いコードで実行しないように）。
const buildId = process.env.GITHUB_SHA || String(Date.now());
try { writeFileSync(join(process.cwd(), "public", "version.json"), JSON.stringify({ buildId })); } catch { /* 書き出せなくても動作には影響しない */ }

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  assetPrefix: isGithubPages ? "/dd-dashboard/" : "",
  images: { unoptimized: true },
  trailingSlash: true,
  env: { NEXT_PUBLIC_BUILD_ID: buildId, NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
