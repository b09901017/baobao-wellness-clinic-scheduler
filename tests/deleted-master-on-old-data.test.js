// 拿主檔去印**既有來訪**的畫面，要連已刪除的一起讀（段四之二發現的 2，同 C 之一的形狀）。
//
// - 批次取消：那一列的治療師、診間、課程名字（刪掉的會印成空的、「（沒有課程）」），
//   取消框「壓在哪個系統」問課程主檔（查不到就退回猜 Abovee）
// - 療程單比對：抬頭與每一句的課程、器材名字；刪掉的器材那一列推不出課程
// 兩頁裡讓她挑的選單（療程單確認層）自己濾掉刪除的（`live()`），多讀不會冒回選項。
// 資料層 import 不進 node，掃原始碼。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../public/js/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

for (const rel of ['ui/views/bulkCancel.js', 'ui/views/treatmentSheets.js']) {
  test(`${rel} 讀主檔帶 includeDeleted`, () => {
    const src = read(rel);
    assert.match(src, /config\.loadAll\(\{ includeDeleted: true \}\)/);
    assert.doesNotMatch(src, /config\.loadAll\(\)/);
  });
}

test('療程單確認層挑課程、器材、品項的選單照舊濾掉刪除的', () => {
  const src = read('ui/components/sheetConfirm.js');
  assert.match(src, /const live = \(rows\) => \(rows \?\? \[\]\)\.filter\(\(r\) => r && !r\.deletedAt/);
  for (const type of ['courses', 'ivProducts', 'equipment']) assert.ok(src.includes(`live(ctx.master.${type})`), type);
});
