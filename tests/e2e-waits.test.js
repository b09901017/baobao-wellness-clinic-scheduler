// 「E2E 不准用固定等待」的守衛。
//
// `page.waitForTimeout(N)` 兩邊都錯：模擬器順的時候那 N 毫秒是白等的
// （2026-09-09 量到 217 個呼叫加起來是純睡 216 秒），而它慢一拍的時候 N 不夠 ——
// 接下來那一句斷言讀到的是還沒重畫的畫面，於是那一支變成「重跑就過」的 flaky。
// **兩種症狀都不會指向這一行**，所以靠人記得是不行的。
//
// 該用的是 locator 的狀態：
//
//   等一層推上來        `await app.layer('選擇器')`
//   等一次寫入結束      `await app.saved()`（讀 toast 的狀態機，失敗會大聲）
//   等一頁畫完          `await app.settled()`
//   等一顆丸子被按下    `await expect(chip).toHaveAttribute('aria-pressed', 'true')`
//   等一摺打開          `await expect(fold).toHaveAttribute('open', '')`
//
// **這張豁免表只准變短。** 每一支清完就把它從表上刪掉；一支都不准新增
// —— 新加的那一行必須寫得出「這裡等的是真實時間本身」那種理由（例如按住
// 手勢的長度、或者 `PENDING_MS` 那種產品行為要求的逾時）。
// 待清的名單與作法在 `.scratch/e2e-speed/issues/02-drop-fixed-waits.md`。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fromRoot, toPosix } from './helpers/paths.js';

const SPEC_DIR = fromRoot('tests-e2e/specs');

/**
 * 還沒清完的那幾支。**數字是上限，只准往下調。**
 * 清完一支就整列刪掉 —— 留著 0 等於留一個可以偷偷長回去的位子。
 */
const PENDING = {
  '02-examine-chain.spec.js': 12,
  '03-health-and-counts.spec.js': 1,
  '04-journey-a-happy.spec.js': 15,
  '06-time-travel.spec.js': 6,
  '07-chaos.spec.js': 1,
  '08-ux-audit.spec.js': 12,
  '09-sheet-and-import.spec.js': 4,
  '10-offline.spec.js': 7,
  '11-todo-drawer.spec.js': 5,
  '12-ask-by-month.spec.js': 5,
  '14-clinical-alert.spec.js': 3,
  '15-playbook.spec.js': 3,
  '16-record-task.spec.js': 1,
  '17-settings-fields.spec.js': 11,
  '18-memo-paste-and-emoji.spec.js': 5,
  '21-pool-assignment.spec.js': 10,
  '22-bulk-cancel.spec.js': 19,
  '23-naming-read-first.spec.js': 2,
  '24-layout-reach.spec.js': 6,
};

const CALL = /page\.waitForTimeout\s*\(/g;

const count = (src) => (src.match(CALL) ?? []).length;

test('清過的 spec 不准把固定等待加回去', () => {
  const offenders = [];
  for (const f of readdirSync(SPEC_DIR).filter((n) => n.endsWith('.spec.js'))) {
    if (f in PENDING) continue;
    const n = count(readFileSync(join(SPEC_DIR, f), 'utf8'));
    if (n > 0) offenders.push(`${f} 有 ${n} 個 page.waitForTimeout()`);
  }
  assert.deepEqual(
    offenders, [],
    `這幾支已經清過了，不要再放固定等待進去：\n  ${offenders.join('\n  ')}\n`
    + '該用的是 app.layer() / app.saved() / app.settled()，見這支測試的檔頭。',
  );
});

test('還沒清完的那幾支只准變少', () => {
  const grew = [];
  for (const [f, cap] of Object.entries(PENDING)) {
    const n = count(readFileSync(join(SPEC_DIR, f), 'utf8'));
    if (n > cap) grew.push(`${f}：${n} 個，上限是 ${cap}`);
  }
  assert.deepEqual(
    grew, [],
    `這幾支的固定等待變多了：\n  ${grew.join('\n  ')}\n`
    + '這張表只准往下調。真的需要等一段真實時間（按住手勢、PENDING_MS）'
    + '就在那一行寫出理由，並把上限一起調。',
  );
});

test('清完的那幾支不要留在豁免表上', () => {
  const done = [];
  for (const [f, cap] of Object.entries(PENDING)) {
    if (count(readFileSync(join(SPEC_DIR, f), 'utf8')) === 0 && cap > 0) done.push(f);
  }
  assert.deepEqual(
    done, [],
    `這幾支已經清乾淨了，把它們從 PENDING 刪掉：${done.join('、')}\n`
    + '留著等於留一個可以偷偷長回去的位子。',
  );
});

test('每一種「還在讀」的佔位字都在 fixture 的 PLACEHOLDERS 裡', () => {
  // `settled()` 判「畫完了沒」靠的是「畫面上沒有這幾個字」。少認一個的症狀
  // 特別壞：斷言讀到的是那三四個字，錯誤訊息長得像 app 壞了，其實是問太早。
  // 2026-09-09 就是這樣紅了六支 —— 資料健檢那一頁用的是「掃描中…」，
  // 而 fixture 只認得「載入中…」。
  const src = readFileSync(fromRoot('tests-e2e/fixtures/app.js'), 'utf8');
  const known = new Set(
    [...src.matchAll(/const PLACEHOLDERS = \[([^\]]*)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])),
  );
  assert.ok(known.size > 0, 'fixture 裡找不到 PLACEHOLDERS —— 改名了？');

  const missing = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.js')) continue;
      // **只找真的畫進標籤裡的**（`<p class="muted">掃描中…</p>`）。
      // toast 那一族（`{ pending: '送出中…' }`）不算：它們在 toast 不在 `#view`，
      // 而「等寫入結束」是 `app.saved()` 的事，混進來會讓 settled() 等錯東西。
      for (const m of readFileSync(full, 'utf8').matchAll(/>\s*([一-鿿]{2,4}中…)\s*</g)) {
        if (!known.has(m[1])) missing.set(m[1], toPosix(full));
      }
    }
  };
  walk(fromRoot('public/js'));

  const lines = [...missing].map(([w, at]) => `${w}（${at}）`).join('\n  ');
  assert.deepEqual(
    [...missing.keys()], [],
    `這幾個佔位字沒有登記在 fixtures/app.js 的 PLACEHOLDERS 裡：\n  ${lines}\n`
    + '沒登記的話 settled() 會停在那幾個字上，而斷言看起來像 app 壞了。',
  );
});

test('fixture 自己一個固定等待都沒有', () => {
  const src = readFileSync(fromRoot('tests-e2e/fixtures/app.js'), 'utf8');
  // 檔頭的說明裡會提到這個名字，所以只數真的呼叫
  assert.equal(
    count(src), 0,
    '`fixtures/app.js` 是每一支都吃得到的路 —— 這裡一個固定等待，'
    + `全跑就是幾百次。目前的檔案：${toPosix(fromRoot('tests-e2e/fixtures/app.js'))}`,
  );
});
