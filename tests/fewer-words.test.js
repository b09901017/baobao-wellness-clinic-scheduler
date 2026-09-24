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
  // `ui/components/flags.js` 2026-09-17 降到 0（ADR-0102）：全部收進 `?`
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
  // 七段：今天沒有待辦（空狀態）、還沒問的位數、還沒結案的天數、簽療程單那一句（「請客人
  // 簽療程單（N 段）」是資料）、她壓表時記的那一句、壓表登記那兩句（資料）。
  // 2026-09-24 收掉三段（ADR-0110）：兩張抽屜上「哪一段…就點它一下」—— 換成 ✓／✗
  // 兩顆圖示之後按鈕自己講完了；「這一天到現在還是『待確認』」收進 `?`（她：「太占版面了」）
  'ui/views/home.js': 7,
  // 五段：沒有剩餘次數了（空狀態）、月份讀不出來（錯誤）、去記時間那顆按鈕、
  // 「併進同一天」（紅線 5）
  'ui/views/schedule.js': 5,
  // 「不逐課程設定」那一句長在一摺 `<details>` 底下 —— 展開才看得到，
  // 本來就不是常駐說明，而 `<summary>` 是互動元素，裡面放不了 `tip()`
  'ui/views/settings.js': 1,
};

/**
 * `muted dim` 她也點名了，而盤完之後**一段都沒有收** —— 那不是漏掉，
 * 是它十四處全部都是**資料的第二行**，不是說明：
 *
 *   額度到期日、「來自方案 X」、「單項加購」、營養品的名字提示、
 *   確認面板上她自己寫的那一句備註、待辦那一天列不完時的筆數、
 *   排在這裡的理由（那是算出來的）
 *
 * 收起來等於把資料藏進一顆 `?`。這一份清單就是那次盤點的紀錄 ——
 * **要改大之前先問：那一段真的是說明嗎？**
 */
const MUTED_DIM_KEEP = {
  'ui/components/buy.js': 1,
  'ui/views/bought.js': 1,
  'ui/views/customerDetail.js': 5,
  'ui/views/customers.js': 1,
  'ui/views/formInbox.js': 2,
  'ui/views/home.js': 3,
  'ui/views/schedule.js': 1,
};

/**
 * 這一輪真的收起來的那幾段字：**每一段都要出現在某一支的 `tip()` 呼叫裡，
 * 而且不可以再出現在那幾個 class 底下**（issue 09 的判準）。
 *
 * 抽樣而不是全列：全列等於把每一句話抄兩份，而抄錯的那一份會安靜地放行。
 */
const MOVED = [
  ['ui/views/settings.js', '診間與治療師都在這裡自己加，沒有寫死在程式碼裡。'],
  ['ui/views/health.js', '發現的問題只會顯示出來。'],
  ['ui/views/bulkCancel.js', '出國或請假的時候，一次把那幾段收掉。'],
  ['ui/views/eventEditor.js', '不綁客戶、不產生任務、不扣次數。'],
  ['ui/views/audit.js', '每一次寫入都會留下一筆，改不掉也刪不掉。'],
  ['ui/views/trash.js', '系統從不真的刪除資料。'],
  ['ui/views/preferences.js', '分數 = w1×限制 + w2×喜好 + w3×急迫 + w4×間隔。'],
  ['ui/views/report.js', '把資料排成試算表的樣子'],
];

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

  test('`muted dim` 那十四處是資料不是說明', () => {
    const now3 = counts(['muted dim']);
    for (const [file, max] of Object.entries(MUTED_DIM_KEEP)) {
      assert.ok((now3[file] ?? 0) <= max, `${file} 現在有 ${now3[file]} 段（上限 ${max}）`);
    }
    const extra = Object.keys(now3).filter((f) => !(f in MUTED_DIM_KEEP));
    assert.deepEqual(extra, [], '這幾支長出了新的 `muted dim` —— 它是資料的第二行，不是說明');
  });

  test('收起來的那幾段字真的在 tip() 裡，而且不在原本那個 class 底下', () => {
    for (const [file, phrase] of MOVED) {
      const src = readFileSync(fromRoot(`public/js/${file}`), 'utf8');
      assert.ok(src.includes(phrase), `${file} 裡找不到「${phrase}」—— 這一條要跟著改`);
      const at = src.indexOf(phrase);
      const before = src.slice(Math.max(0, at - 400), at);
      assert.ok(before.includes('tip('),
        `${file} 的「${phrase}」不在 tip() 的呼叫裡`);
      for (const c of CLASSES) {
        assert.ok(!before.includes(`class="${c}"`),
          `${file} 的「${phrase}」還掛在 .${c} 底下`);
      }
    }
  });

  test('總數只准往下', () => {
    const total = Object.values(now).reduce((a, b) => a + b, 0);
    const cap = Object.values(KEEP).reduce((a, b) => a + b, 0);
    assert.ok(total <= cap, `現在 ${total} 段，上限 ${cap} 段`);
  });
});
