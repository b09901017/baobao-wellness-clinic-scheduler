// 常駐說明的棘輪：**只准變少**。
//
// 她 2026-09-12：
//
// > 有關於畫面簡化，能用Tooltip就用Tooltip，像是以下這些
// > page__lead，wayrow__hint，drawer__note，note__note，(muted)，muted dim，card__note
// > 這些請幫我全域檢查，我看起來大部分都是新手說明，這些不需要，占版面，
// > 讓畫面很雜很頭痛，都縮成用Tooltip
//
// ## 為什麼是棘輪而不是「一個都不准有」
//
// 她點名的那幾個 class **不是同一種東西**。盤點 42 處之後分成三堆：
//
//   說明   讀過一次就夠的導覽 → 收進 `tip()`（這一輪收掉 21 處）
//   資料   她自己寫的字、筆數、狀態、到期日 → **留著**（收起來等於把資料藏了）
//   紅線   藏起來之後「她按下去的結果會跟她以為的不一樣」→ **留著**
//         （`tests/tip-red-lines.test.js` 另外釘著那五條）
//
// 所以這一支盯的是**數量只准往下**。下一輪要再收一批就把數字改小；
// 而「順手又加一段常駐說明」會在這裡紅。
//
// 每一個留下來的都要有理由，寫在 `KEEP` 裡。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { fromRoot, toPosix } from './helpers/paths.js';

const CLASSES = ['page__lead', 'card__note', 'drawer__note', 'wayrow__hint', 'note__note'];

/**
 * 欄位說明（`components/form.js` 的 `hint` 參數）2026-09-12 起畫成標籤旁邊
 * 那一顆 `?`，所以剩下的都是**手寫**的那幾段。同一個棘輪，只准變少。
 */
const FIELD_HINT_KEEP = {
  // 整支檔案都是禁忌與警示那一種，連 tip.js 都不可以 import
  'ui/components/flags.js': 6,
  // `hint` 那一條共用的退路：一排丸子的選項是空的時候那一句要留在畫面上
  // （整排消失的話她會以為那個欄位不用填），以及 `undecidedHint()`（ADR-0079）
  'ui/components/form.js': 2,
  // 「改成 0 就是不要那一項」—— 講的是寫進去的東西
  'ui/components/planTweak.js': 1,
  // 「從日曆拿掉只是清掉日期」—— 同上
  'ui/views/calendar.js': 1,
  // 整支檔案連 tip.js 都不可以 import（同 flags.js）
  'ui/views/customersBulk.js': 1,
  // 休假與行事備註差在哪、結束日不同就是跨天 —— 兩句都會改變她挑哪一個
  'ui/views/eventEditor.js': 3,
  // Apps Script 的網址與 token 要怎麼填 —— 藏起來她會填錯，而那是一次性設定
  'ui/views/report.js': 2,
  // 「這裡是加約的二返」「沒有它試算表印不出位置」「跟買的不一樣」
  'ui/views/schedule.js': 3,
  // 「那一天已經是 X 了，所以這是另外一次來訪」（ADR-0083）、「這一段取消了」
  'ui/views/visitEditor.js': 2,
};

/**
 * 還留著幾段，以及**為什麼**。
 *
 * 這幾個數字只准變小。要改大的話先問：那一段真的是「資料」或「紅線」嗎？
 */
const KEEP = {
  // 「哪一種沒給就點它一下。給了的才會記進試算表。」——
  // 後半句講的是**寫進去的東西**，藏起來她會以為都記了
  'ui/components/note.js': 1,
  // 通用參數：那一句由各呼叫端決定，這一支自己不寫任何說明
  'ui/components/sheet.js': 1,
  // 隨手記的**內文**（她自己寫的字），不是說明
  'ui/components/tasklist.js': 1,
  // 「它們仍然生效，只是在這一頁改不了」—— 紅線 4
  'ui/views/availability.js': 1,
  // 整支檔案都是「會改變寫進去的東西」那一種，連 tip.js 都不可以 import
  // （`tests/tip-red-lines.test.js`）
  'ui/views/customersBulk.js': 2,
  // 「客戶自己填的，看過沒問題就按下去」＋筆數 —— 空狀態與資料
  'ui/views/formInbox.js': 1,
  // 九段：今天沒有待辦（空狀態）、還沒簽的筆數、她壓表時記的那一句、
  // 「次數只扣打勾的那幾段」（寫進去的東西）、那一天現在還是什麼狀態…
  'ui/views/home.js': 9,
  // 五段：沒有剩餘次數了（空狀態）、月份讀不出來（錯誤）、去記時間那顆按鈕、
  // 「併進同一天」（紅線 5）
  'ui/views/schedule.js': 5,
};

const counts = (classes = CLASSES) => {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.js')) continue;
      const src = readFileSync(full, 'utf8');
      let n = 0;
      for (const c of classes) {
        // `class="page__lead"` 與 `class="page__lead num"` 都算
        n += src.split(`class="${c}"`).length - 1;
        n += src.split(`class="${c} `).length - 1;
      }
      if (n) out[toPosix(full).slice(toPosix(fromRoot('public/js/')).length)] = n;
    }
  };
  walk(fromRoot('public/js'));
  return out;
};

describe('常駐說明只准變少', () => {
  const now = counts();

  for (const [file, max] of Object.entries(KEEP)) {
    test(`${file} 最多 ${max} 段`, () => {
      assert.ok((now[file] ?? 0) <= max,
        `${file} 現在有 ${now[file]} 段（上限 ${max}）——`
        + ' 順手加一段常駐說明的話，先問它是不是收得進 `tip()`');
    });
  }

  test('沒有別的檔案又長出常駐說明', () => {
    const extra = Object.keys(now).filter((f) => !(f in KEEP));
    assert.deepEqual(extra, [],
      '這幾支長出了常駐說明 —— 收進 `tip()`，真的收不進去就寫進 KEEP 並附理由');
  });

  test('手寫的欄位說明也只准變少', () => {
    const now2 = counts(['field__hint']);
    for (const [file, max] of Object.entries(FIELD_HINT_KEEP)) {
      assert.ok((now2[file] ?? 0) <= max, `${file} 現在有 ${now2[file]} 段（上限 ${max}）`);
    }
    const extra = Object.keys(now2).filter((f) => !(f in FIELD_HINT_KEEP));
    assert.deepEqual(extra, [],
      '這幾支自己手寫了欄位說明 —— `form.js` 的 `hint` 參數已經畫成一顆 `?` 了');
  });

  test('總數只准往下', () => {
    const total = Object.values(now).reduce((a, b) => a + b, 0);
    const cap = Object.values(KEEP).reduce((a, b) => a + b, 0);
    assert.ok(total <= cap, `現在 ${total} 段，上限 ${cap} 段`);
  });
});
