import type { Metadata } from "next";

// タブのタイトルを「DD戦略ダッシュボード」（本体）・「グラフ作成」・「動画作成」で見分けられるようにする。
// 親（app/layout.tsx）のtitleは文字列指定のため、ここで完全に上書きされる（Next.jsのメタデータの仕様）。
export const metadata: Metadata = {
  title: "グラフ作成",
};

export default function ChartStudioLayout({ children }: { children: React.ReactNode }) {
  return children;
}
