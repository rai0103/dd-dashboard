"use client";

import dynamic from "next/dynamic";

// ブラウザ専用の機能（localStorage・IndexedDB・Canvas・音声）を使うため、サーバー側では描画しない
const ExplainerStudio = dynamic(() => import("@/components/ExplainerStudio"), { ssr: false });

export default function ExplainerPage() {
  return <ExplainerStudio />;
}
