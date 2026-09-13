// 交給 `repo.commit()` 的每一個 update 都要用 `changes`，不是 `data`。
//
// `repo.commit()` 的 update 那一支讀 `o.changes`；create 讀 `o.data`。寫錯一個字的症狀
// 特別安靜：**寫入照樣「成功」**（只寫進 updatedAt），而稽核那一筆的 `after` 是 undefined，
// Firestore 整批拒收 —— 畫面上只跳一句「儲存失敗：…Unsupported field value: undefined」。
//
// 2026-09-13 在「買過什麼」改購買日時抓到的（`data/customers.js` 的 `updateEntitlements()`），
// 那個功能從 9/6 做出來那天起就沒有存成功過。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fromRoot } from './helpers/paths.js';

const DATA = fromRoot('public/js/data');

test("每一個 op: 'update' 都帶 changes，不帶 data", () => {
  const offenders = [];
  for (const f of readdirSync(DATA).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(join(DATA, f), 'utf8');
    for (const m of src.matchAll(/op:\s*'update'/g)) {
      // 那一個物件字面值裡**先出現的**是 data 還是 changes。不能讀到第一個 `}` 就停 ——
      // 路徑常常是模板字串（`customers/${id}/entitlements`），裡面就有一個 `}`。
      const next = src.indexOf('op:', m.index + 3);
      const body = src.slice(m.index, next === -1 ? m.index + 400 : Math.min(next, m.index + 400));
      const key = body.match(/\b(data|changes)\b\s*[:,}]/)?.[1] ?? null;
      if (key !== 'changes') {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${f}:${line}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'update 要用 changes（repo.commit() 讀的是 o.changes）');
});
