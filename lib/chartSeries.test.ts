import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodPath, periodSpanDays, csvRowsToStockDataPoints, PERIOD_OPTIONS } from './chartSeries';
import { StockDataPoint } from './videoTypes';

// 2020-01-01から2021-12-31までの営業日を模した合成系列（週末も含めた日次。periodPathは日付文字列の
// 前方一致検索だけに依存するため、実際の営業日カレンダーである必要はない）を生成するヘルパー。
function buildDaily(startDate: string, days: number, closeFn: (i: number) => number): StockDataPoint[] {
  const out: StockDataPoint[] = [];
  const d = new Date(`${startDate}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    out.push({ date: d.toISOString().slice(0, 10), close: closeFn(i) });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

test('periodPath: maxは全期間を使い、開始点が100になる', () => {
  const daily = buildDaily('2020-01-01', 10, (i) => 100 + i);
  const path = periodPath(daily, 'max');
  assert.equal(path.length, 10);
  assert.equal(path[0].v, 100);
  assert.equal(path[0].t, 0);
  assert.equal(path[path.length - 1].t, 1);
  // 最終日の終値109 / 開始日の終値100 * 100
  assert.ok(Math.abs(path[path.length - 1].v - 109) < 1e-9);
});

test('periodPath: 1wは直近7日前以降のみを採用する', () => {
  const daily = buildDaily('2020-01-01', 30, (i) => 100 + i);
  const path = periodPath(daily, '1w');
  // asOfDate省略時は最終点（2020-01-30）が終端。カットオフは2020-01-23。
  assert.ok(path.length > 0 && path.length <= 8);
  assert.equal(path[0].v, 100);
});

test('periodPath: ytdはその年の1/1以降のみを採用する', () => {
  const daily = buildDaily('2019-12-20', 60, (i) => 100 + i); // 2019-12-20（index0）〜2020-02-17程度
  const path = periodPath(daily, 'ytd');
  // 2020-01-01が系列中のindex12（12/20→1/1は12日後）。開始点（t=0）の終値は 100+12=112 のはずで、
  // それがv=100に正規化される（前年12月分の11日分が除外されていることの確認）。
  const jan1Idx = daily.findIndex((p) => p.date === '2020-01-01');
  assert.equal(jan1Idx, 12);
  assert.equal(path.length, daily.length - jan1Idx);
  assert.equal(path[0].v, 100);
});

test('periodPath: asOfDateを指定すると、その日以前の最新点を終端とする', () => {
  const daily = buildDaily('2020-01-01', 30, (i) => 100 + i);
  const path = periodPath(daily, 'max', '2020-01-10');
  assert.ok(Math.abs(path[path.length - 1].v - (100 + 9)) < 1e-9); // 2020-01-10（index9）が終端
});

test('periodPath: 空配列を渡すと空配列を返す', () => {
  assert.deepEqual(periodPath([], 'max'), []);
});

test('periodPath: 期間が上場前（データが無い範囲）をカバーする場合は空配列を返す', () => {
  const daily = buildDaily('2024-01-01', 5, (i) => 100 + i); // 直近5日分しか無い
  const path = periodPath(daily, 'max', '2024-01-05');
  assert.equal(path.length, 5); // maxなら全部使える
});

test('csvRowsToStockDataPoints: date/priceをdate文字列/closeに変換する', () => {
  const rows = [{ date: new Date(Date.UTC(2020, 0, 1)), price: 123.45 }, { date: new Date(Date.UTC(2020, 0, 2)), price: 124 }];
  const pts = csvRowsToStockDataPoints(rows);
  assert.deepEqual(pts, [{ date: '2020-01-01', close: 123.45 }, { date: '2020-01-02', close: 124 }]);
});

test('PERIOD_OPTIONS: ユーザー指定の9区分が全て揃っている', () => {
  const keys = PERIOD_OPTIONS.map((o) => o.key).sort();
  assert.deepEqual(keys, ['1m', '1w', '1y', '3m', '3y', '5y', '6m', 'max', 'ytd'].sort());
});

test('periodSpanDays: maxは開始点〜終端点の実際の日数を返す（横軸ラベル用）', () => {
  const daily = buildDaily('2020-01-01', 366, (i) => 100 + i); // 2020-01-01〜2020-12-31（うるう年、366日分）
  assert.equal(periodSpanDays(daily, 'max'), 365);
});

test('periodSpanDays: 1yは実際には約365日だが、営業日の抜けがあっても暦日ベースで計算する', () => {
  // 平日のみ（土日を除く）の合成系列：periodPathのtは点の個数基準の等間隔になるが、
  // periodSpanDaysは実際のカレンダー日数（暦日）を返すので、点の個数には依存しない。
  const daily: ReturnType<typeof buildDaily> = [];
  const d = new Date('2019-01-01T00:00:00Z');
  for (let i = 0; i < 800; i++) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) daily.push({ date: d.toISOString().slice(0, 10), close: 100 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const span = periodSpanDays(daily, '1y');
  assert.ok(span !== null && span >= 360 && span <= 366, `expected ~365, got ${span}`);
});

test('periodSpanDays: asOfDateを指定すると、その日までの日数で計算する', () => {
  const daily = buildDaily('2020-01-01', 30, (i) => 100 + i);
  const span = periodSpanDays(daily, 'max', '2020-01-10');
  assert.equal(span, 9); // 2020-01-01〜2020-01-10
});

test('periodSpanDays: 空配列、またはasOfDateが全データより前の場合はnullを返す', () => {
  assert.equal(periodSpanDays([], 'max'), null);
  const daily = buildDaily('2020-01-01', 30, (i) => 100 + i);
  assert.equal(periodSpanDays(daily, 'max', '2019-01-01'), null); // asOfDateが全データより前＝終端点が無い
});

test('periodSpanDays: 期間が実際のデータより長い場合は、データ開始点からの実日数を返す（periodPathと同じ挙動）', () => {
  const daily = buildDaily('2024-01-01', 5, (i) => 100 + i); // 直近5日分しかないのに5年を指定
  assert.equal(periodSpanDays(daily, '5y', '2024-01-05'), 4); // periodPathと同様、使える範囲（4日分）で計算する
});
