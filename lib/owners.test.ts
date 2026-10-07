// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNER_OPTIONS, migrateHoldingsOwners, migrateAsOfKeys, detectRakutenOwnerFromFileName, ownerDisplayLabel } from "./owners.ts";

test("口座主の選択肢は 楽天(saki)・楽天(shin)・moomoo・大和コネクト証券・iDeCo・Coin Checkの6つ", () => {
  assert.deepEqual(OWNER_OPTIONS, ["楽天(saki)", "楽天(shin)", "moomoo", "大和コネクト証券", "iDeCo", "Coin Check"]);
});

test("保有銘柄の口座主を移行：shin/saki → 楽天(shin)/楽天(saki)、moomoo取り込み分 → moomoo", () => {
  const list = [
    { id: "1", owner: "shin" },
    { id: "2", owner: "saki" },
    { id: "3", owner: "moomoo証券", broker: "moomoo" },
    { id: "4", owner: "楽天(shin)" },
    { id: "5", owner: "moomoo", broker: "moomoo" },
  ];
  const { list: out, changed } = migrateHoldingsOwners(list);
  assert.equal(changed, true);
  assert.deepEqual(out.map((h) => h.owner), ["楽天(shin)", "楽天(saki)", "moomoo", "楽天(shin)", "moomoo"]);
  assert.equal(out[3], list[3], "変更不要の行は同じオブジェクトのまま");
  // 冪等：2回目は変更なし
  assert.equal(migrateHoldingsOwners(out).changed, false);
});

test("holdings_as_of のキーも移行（新旧が重複したら新しい日付を残す）", () => {
  const { map, changed } = migrateAsOfKeys({ shin: "2026-08-31", saki: "2026-09-09", "楽天(saki)": "2026-09-01" });
  assert.equal(changed, true);
  assert.deepEqual(map, { "楽天(shin)": "2026-08-31", "楽天(saki)": "2026-09-09" });
  assert.equal(migrateAsOfKeys(map).changed, false);
});

test("楽天証券CSVのファイル名から口座主を判定", () => {
  assert.equal(detectRakutenOwnerFromFileName("assetbalance(all)_20260831_shin.csv"), "楽天(shin)");
  assert.equal(detectRakutenOwnerFromFileName("assetbalance(all)_20260909_SAKI.csv"), "楽天(saki)");
  assert.equal(detectRakutenOwnerFromFileName("assetbalance.csv"), null);
});

test("表示用の口座名：対応表にある口座だけ変換し、それ以外はそのまま", () => {
  assert.equal(ownerDisplayLabel("楽天(shin)"), "楽天証券（私）");
  assert.equal(ownerDisplayLabel("楽天(saki)"), "楽天証券（妻）");
  assert.equal(ownerDisplayLabel("大和コネクト証券"), "大和コネクト");
  for (const o of ["Coin Check", "iDeCo", "moomoo", "moomoo証券", "未知の口座"]) assert.equal(ownerDisplayLabel(o), o);
});
