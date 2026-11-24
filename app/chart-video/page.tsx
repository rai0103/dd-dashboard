"use client";

import dynamic from "next/dynamic";

// ブラウザ専用の機能（IndexedDB・Canvas・録画）を使うため、サーバー側では描画しない
const ChartVideoStudio = dynamic(() => import("@/components/ChartVideoStudio"), { ssr: false });

export default function ChartVideoPage() {
  return <ChartVideoStudio />;
}
