"use client";

import dynamic from "next/dynamic";

// ブラウザ専用の機能（IndexedDB・Canvas）を使うため、サーバー側では描画しない
const ChartStudio = dynamic(() => import("@/components/ChartStudio"), { ssr: false });

export default function ChartStudioPage() {
  return <ChartStudio />;
}
