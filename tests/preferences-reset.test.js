// 設定 → 排序權重「回復預設值」只回復那一頁上的那幾格（staging-polish 段二中途發現 1，她 10/18：「Fix it」）。
//
// 以前是 `saveSettings(DEFAULT_SETTINGS)` 整份蓋上去：`DEFAULT_SETTINGS` 裡有 `sheetSync: { url: '', token: '' }`
// 與 `messageTemplates: {}`，按一下試算表就安靜地不再推、改過的 LINE 模板全部回到預設。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DEFAULT_SETTINGS, PREFERENCE_KEYS, preferenceDefaults } from '../public/js/domain/seed.js';

test('回復預設值只帶那一頁上的五格', () => {
  assert.deepEqual(PREFERENCE_KEYS, ['sortWeights', 'slotGapMin', 'noReplyDays', 'reportDueDays', 'followupDueDays']);
  const reset = preferenceDefaults();
  assert.deepEqual(Object.keys(reset), PREFERENCE_KEYS);
  for (const k of PREFERENCE_KEYS) assert.deepEqual(reset[k], DEFAULT_SETTINGS[k], k);
  for (const k of ['sheetSync', 'messageTemplates', 'todoRows']) assert.ok(!(k in reset), k);
});

test('沒有任何一頁把整份 DEFAULT_SETTINGS 存回去', () => {
  for (const f of ['preferences.js', 'templates.js', 'report.js', 'todoRows.js', 'settings.js']) {
    const src = readFileSync(new URL(`../public/js/ui/views/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /saveSettings\(\s*DEFAULT_SETTINGS\s*\)/, f);
  }
});
