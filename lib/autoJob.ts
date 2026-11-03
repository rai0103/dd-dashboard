// Stage F-1：平日朝の自動配信（タスクスケジューラ）の設定の型と既定値。
// investment-shortsのlib/autoJob.tsと同じ考え方（投資shortsのコードは一切コピーしていない、新規実装）。
// dd-dashboardは当面「株式情報・当日」の動画を生成するジョブのみを想定しているため、
// AutoModeは投資shorts（'csv'|'preview'|'video'）と異なり'preview'|'video'の2値のみ。
export type AutoMode = 'preview' | 'video';
export const MODE_LABEL: Record<AutoMode, string> = {
  preview: '台本生成（プレビュー）まで',
  video: '動画生成（保存）まで',
};

export interface AutoTime {
  id: string;
  time: string; // "HH:MM"
  season: 'all' | 'summer' | 'winter'; // 米国の夏時間／冬時間でだけ実行するか（季節に合わない時刻は自動でスキップ）
}

export interface AutoJob {
  id: string;
  name: string;
  enabled: boolean;
  days: number[]; // 0=日 … 6=土
  times: AutoTime[]; // 複数設定可
  mode: AutoMode;
}

export interface AutoConfig {
  outDir: string; // 動画生成（保存）までのときの保存先フォルダ（絶対パス）
  jobs: AutoJob[];
}

export const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
export const SCHTASK_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const SEASON_LABEL: Record<AutoTime['season'], string> = {
  all: '通年',
  summer: '米国夏時間のみ',
  winter: '米国冬時間のみ',
};

export const newId = (): string => Math.random().toString(36).slice(2, 8);

export const defaultTimes = (): AutoTime[] => [
  { id: newId(), time: '06:15', season: 'winter' },
  { id: newId(), time: '05:15', season: 'summer' },
];

// 既定は「平日の朝・株式情報・動画生成まで」の1ジョブのみ（要望に無い複数銘柄・複数メニューは持たない）。
export const defaultJobs = (): AutoJob[] => [
  { id: newId(), name: '平日の朝（株式情報）', enabled: true, days: [1, 2, 3, 4, 5], times: defaultTimes(), mode: 'video' },
];

export const defaultConfig = (): AutoConfig => ({ outDir: '', jobs: defaultJobs() });
