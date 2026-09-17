// 「連點兩下會不會長出兩筆」的守衛。
//
// `ui/toast.js` 的 `withSaveState()` 收一個 `key`，同一個 key 還在飛的時候
// 第二次呼叫**接到的是同一趟**。沒有 key 的路完全沒有保護：「儲存中…」只是
// 一條 toast，既不遮蔽也不鎖表單，而她在公司大樓裡用行動網路，慢一拍就多按
// 一下是常態。離線時更糟 —— 那一趟永遠不會回來（見 `tests-e2e/specs/10-offline`）。
//
// **這種 bug 一次都抓不到現行犯。** 它留下的是一筆重複資料，而且要等到幾天後
// 她在別的畫面看到兩份一樣的東西才會發現。2026-09-01 那份體檢報告 §2.2 列出
// 三條，寫這支測試的時候它又抓到另外三條（客戶詳情的隨手記、確認動線、
// 來訪編輯器的狀態鈕）—— 所以這件事靠人記得是不行的。
//
// 判準只有一條：**這一趟會不會建立新資料**（`.create()` / `.take()` / `.save()`），
// 會的話就要有 `key`，除非它在下面那張豁免表裡而且寫得出理由。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { fromRoot, toPosix } from './helpers/paths.js';

const UI_ROOT = fromRoot('public/js/ui/');

/**
 * 會長出新資料的呼叫。`update` / `setDone` / `remove` 這種不算 ——
 * 做兩次結果一樣，而**全域鎖住一次一個寫入會更糟**：她連續勾三筆待辦時
 * 後兩筆會安靜地不見（`ui/toast.js` 的檔頭記過這個判斷）。
 */
const CREATES = /\.(create|take|save)\s*\(/;

/**
 * 豁免。**每一條都要寫得出理由**，而且理由要是「這條路本來就防得住」，
 * 不是「還沒空補」。這張表跟 `tests/shell-cache.test.js` 的排除清單同一個
 * 用意：有測試盯著它不會愈長愈長。
 */
const ALLOWED = [
  {
    at: 'views/home.js',
    contains: 'invitesData.revoke',
    why: '「重發連結」走二次確認框。confirmAction() 一按下去就把整個對話框節點'
       + '移除，後面幾下落在不存在的元素上（07-chaos.spec.js 的 C12／C13 靠的就是這個）',
  },
  {
    at: 'views/home.js',
    contains: 'setFollowupNote',
    why: '「禮拜一再問問」那一句是 update 不是 create —— 存兩次結果一模一樣。'
       + '它會被掃到只是因為同一個函式裡還有別的呼叫',
  },
];

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * 把每一個 `withSaveState(...)` 的完整呼叫文字挖出來。
 *
 * 用括號配對而不是正規表示式：那個呼叫常常跨十幾行、裡面還有物件與樣板字串，
 * 一行一行掃會在第一個換行就斷掉。
 */
function callsIn(src) {
  const out = [];
  let i = 0;
  while ((i = src.indexOf('withSaveState(', i)) !== -1) {
    let depth = 0;
    let j = i + 'withSaveState'.length;
    const start = j;
    for (; j < src.length; j += 1) {
      const c = src[j];
      if (c === '(') depth += 1;
      else if (c === ')') {
        depth -= 1;
        if (depth === 0) { j += 1; break; }
      }
    }
    out.push({ text: src.slice(start, j), line: src.slice(0, i).split('\n').length });
    i = j;
  }
  return out;
}

/** 掃出來的每一個「會建新資料但沒有 key」的呼叫。 */
function offenders() {
  const found = [];
  for (const file of filesUnder(UI_ROOT)) {
    const rel = toPosix(file.slice(UI_ROOT.length));
    const src = readFileSync(file, 'utf8');

    for (const call of callsIn(src)) {
      if (!CREATES.test(call.text)) continue;
      if (/\bkey:/.test(call.text)) continue;
      if (ALLOWED.some((a) => a.at === rel && call.text.includes(a.contains))) continue;
      found.push(`${rel}:${call.line}  ${call.text.replace(/\s+/g, ' ').slice(0, 100)}`);
    }
  }
  return found;
}

describe('會建立新資料的寫入一定要防連點', () => {
  test('沒有任何一個漏掉 key', () => {
    const bad = offenders();
    assert.deepEqual(
      bad,
      [],
      '這幾個呼叫會建立新資料，但沒有傳 key，連點兩下就是兩筆：\n'
      + `${bad.join('\n')}\n\n`
      + '要嘛補上 key，要嘛在 tests/save-guards.test.js 的 ALLOWED 裡寫清楚'
      + '「這條路本來就防得住」的理由。',
    );
  });

  test('豁免表沒有指到不存在的檔案 —— 死掉的豁免等於默默放行', () => {
    const files = filesUnder(UI_ROOT).map((f) => toPosix(f.slice(UI_ROOT.length)));
    const stale = ALLOWED.filter((a) => !files.includes(a.at)).map((a) => a.at);
    assert.deepEqual(stale, [], `豁免表指到不存在的檔案：${stale.join(', ')}`);
  });

  test('每一條豁免都寫得出理由', () => {
    for (const a of ALLOWED) {
      assert.ok(a.why && a.why.length > 20, `${a.at} 的豁免沒有寫理由`);
    }
  });
});

// ---------------------------------------------------------------------------
// 底下這幾支盯的是體檢報告 §2.2 點名的那幾條，**指名道姓**。
//
// 上面那支通用的守衛已經涵蓋它們了，但通用守衛有一個弱點：有人只要在
// ALLOWED 裡加一行就能讓它閉嘴。這幾支要拿掉得動到測試本身，比較顯眼。
// ---------------------------------------------------------------------------

const read = (rel) => readFileSync(fromRoot(`public/js/ui/${rel}`), 'utf8');

describe('報告 §2.2 點名的那幾條路', () => {
  const cases = [
    ['views/formInbox.js', 'response:take:', '收件匣「收下」—— 連點會變成同一個月兩份可用性，而 ADR-0053 明訂不自動合併'],
    ['views/home.js', 'invite:create:', '待辦中心「產生連結」—— 連點會讓客戶手上有兩條連結'],
    ['views/customerDetail.js', 'invite:create:', '客戶詳情的「產生連結」，跟上面那個是同一件事的兩個入口'],
    ['views/home.js', 'note:create:', '右下角快速記事泡泡'],
    ['views/customerDetail.js', 'note:create:', '客戶詳情的隨手記 —— 四個入口的第四個'],
    ['views/calendar.js', 'visit:save:', '日曆的長按選單，而改一筆來訪只有日曆這一個入口（ADR-0056）'],
    ['views/visitEditor.js', 'visit:save:', '來訪編輯器的狀態按鈕'],
    ['views/home.js', 'confirm:', '確認動線 —— 程式自己註記為「這條動線唯一一次不可逆的寫入」'],
  ];

  for (const [file, key, why] of cases) {
    test(`${file} 還留著 \`${key}\`（${why}）`, () => {
      assert.ok(read(file).includes(`key: \`${key}`), `${file} 的 ${key} key 不見了`);
    });
  }
});

// ---------------------------------------------------------------------------
// 等太久時換上的那一句（`toast.js` 的 `queued()`）說「已經存在這台裝置上了，連上網路會自動補送」。
// **那只對 Firestore 成立**（寫入先進本機快取）。照片是傳到 Storage：傳到一半的照片不在這台裝置上，
// 她這時候收起來就沒了 —— 而確認層收起來前問的正是「照片不會留著」，兩句話互相打架。
// ---------------------------------------------------------------------------

describe('傳照片的寫入，等太久時不可以說「已經存在這台裝置上了」', () => {
  const UPLOADS = /sheetsData\.(create|replace)\s*\(/;

  test('每一個包著傳照片的 withSaveState 都自己帶 slow 那一句', () => {
    const bad = [];
    let seen = 0;
    for (const file of filesUnder(UI_ROOT)) {
      const rel = toPosix(file.slice(UI_ROOT.length));
      for (const call of callsIn(readFileSync(file, 'utf8'))) {
        if (!UPLOADS.test(call.text)) continue;
        seen += 1;
        // `slow: '…'` 或簡寫的 `slow,`
        if (!/\bslow\s*[:,}]/.test(call.text)) bad.push(`${rel}:${call.line}`);
      }
    }
    assert.ok(seen > 0, '一個傳照片的寫入都沒掃到 —— 這支測試盯錯東西了');
    assert.deepEqual(bad, [], `這幾個傳照片的寫入等太久時會說「已經存在這台裝置上了」：\n${bad.join('\n')}`);
  });
});
