// 手動貼上那一格講它少了什麼（`.scratch/asks-2026-09-24-evening/issues/05`）。
//
// 她 2026-09-24 晚：「沒再用了，但是那邊可以有一個tooltip提醒」。
// `customerReport()` 從來沒有來訪紀錄；格式 5 的「記一句」、格式 6 的「買過什麼」也只在自動推送那條。
// `ui/views/report.js` 進不了 node（一路 import 到 firebase 的 CDN），所以掃原始碼。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('試算表報表那一格的 ? 講得出手動貼上少了哪三樣', () => {
  const src = readFileSync(new URL('../public/js/ui/views/report.js', import.meta.url), 'utf8');
  const title = src.slice(src.indexOf('試算表報表${tip('), src.indexOf('</h2>', src.indexOf('試算表報表${tip(')));
  for (const want of ['來訪紀錄', '記一句', '買過什麼', '自動同步']) {
    assert.ok(title.includes(want), `那一顆 ? 沒講到「${want}」`);
  }
});
