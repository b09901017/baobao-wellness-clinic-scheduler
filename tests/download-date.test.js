// 匯出的檔名日期是台灣那一天，不是 UTC（prelaunch-fixes-2026-10-08 段四之二發現的，lessons 第七節）。
// 以前 `toISOString().slice(0, 10)`：台灣 00:00–08:00 匯出的 `排課系統備份-日期.json` 寫成前一天。

process.env.TZ = 'Asia/Taipei';

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import { dated } from '../public/js/ui/components/download.js';

test('台灣 10/9 01:30 匯出 → 檔名是 10/9', () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-08T17:30:00.000Z') });
  try {
    assert.equal(dated('排課系統備份', 'json'), '排課系統備份-2026-10-09.json');
  } finally {
    mock.timers.reset();
  }
});
