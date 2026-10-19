// 試算表只重畫有變的那幾頁（before-golive-2026-10-19/10，ADR-0161）。
//
// 她：「試算表改成只推有改動的分頁，我覺得這可以做，但一樣要確保是正確的喔」；
// 「沒變的那幾頁……照樣更新成這一次推送的時間」；「設定頁加一顆『整份重畫』，有疑慮時可以按」；
// 「試算表每一頁的抬頭那一行要加『病歷號 1234』」。
//
// **指紋記在試算表那一側**（8/27 寫的「手機記指紋」不照做）：她有手機與 iPad 兩台，各記各的會安靜地錯。
// app 照舊送整包、每一頁附一個指紋；`.gs` 比它跟那一頁上次畫的，一樣就只改第三列的產生時間。
// 判準：**這一行會不會讓試算表某一頁跟 app 不一樣、而畫面上看起來推好了？** 例子一律假名、1234。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { loadAppsScript } from './helpers/appsScriptStub.js';
import {
  syncBundle, sheetFingerprint, SYNC_FORMAT, READONLY_NOTICE, customerReport, describeSync, pushedSay, skippedPushSay,
} from '../public/js/domain/sheetReport.js';
import { MARK_LEGEND } from '../public/js/domain/visits.js';

const ent = (id, totalQty = 12) => ({ id, label: 'ILIB(60)', courseId: 'il', totalQty });
const done = (id, date) => ({ id, date, status: 'done', slots: [{ entitlementId: 'e1', courseId: 'il', courseName: 'ILIB', startsAt: '10:00', endsAt: '11:00', status: 'done' }] });
const master = { courses: [{ id: 'il', name: 'ILIB' }], staff: [] };

/** 兩位客戶：客戶A 有一段、王小明 什麼都沒有。 */
const base = (over = {}) => ({
  customers: [{ id: 'a', name: '客戶A', chartNo: '1234' }, { id: 'w', name: '王小明' }],
  entitlementsBy: { a: [ent('e1')], w: [ent('e1', 6)] },
  visitsBy: { a: [done('v1', '2026-10-01')] },
  today: '2026-10-19',
  master,
  generatedAt: '2026/10/19 上午10:00:00',
  ...over,
});
const fpOf = (bundle, name) => bundle.sheets.find((s) => s.name === name).fingerprint;

describe('syncBundle()：每一頁一個指紋、一個病歷號', () => {
  test('格式 8', () => assert.equal(SYNC_FORMAT, 8));

  test('同樣的資料、不同的產生時間 → 指紋一樣（產生時間每一次都換，不算）', () => {
    const one = syncBundle(base());
    const two = syncBundle(base({ generatedAt: '2026/10/19 下午3:00:00' }));
    assert.match(fpOf(one, '客戶A'), /^[0-9a-z]{12,}$/);
    assert.equal(fpOf(one, '客戶A'), fpOf(two, '客戶A'));
  });

  test('改了一位的來訪：那一位的指紋變了，另一位一樣', () => {
    const one = syncBundle(base());
    const two = syncBundle(base({ visitsBy: { a: [done('v1', '2026-10-01'), done('v2', '2026-10-08')] } }));
    assert.notEqual(fpOf(one, '客戶A'), fpOf(two, '客戶A'));
    assert.equal(fpOf(one, '王小明'), fpOf(two, '王小明'));
  });

  test('第一列的提醒、第三列的符號說明、格式版本都算進去', () => {
    const sheet = syncBundle(base()).sheets[0];
    const { fingerprint, ...rest } = sheet;
    const ctx = { format: SYNC_FORMAT, notice: READONLY_NOTICE, legend: MARK_LEGEND };
    assert.equal(sheetFingerprint(rest, ctx), fingerprint);
    assert.notEqual(sheetFingerprint(rest, { ...ctx, legend: `${MARK_LEGEND}　改了` }), fingerprint);
    assert.notEqual(sheetFingerprint(rest, { ...ctx, notice: '別的話' }), fingerprint);
    assert.notEqual(sheetFingerprint(rest, { ...ctx, format: 9 }), fingerprint);
  });

  test('跨年那一天：去年的日期多了年份前綴 → 那一頁指紋變了；沒有來訪的那一頁一樣', () => {
    const dec = syncBundle(base({ today: '2026-12-31' }));
    const jan = syncBundle(base({ today: '2027-01-01' }));
    assert.notEqual(fpOf(dec, '客戶A'), fpOf(jan, '客戶A'));
    assert.equal(fpOf(dec, '王小明'), fpOf(jan, '王小明'));
  });

  test('病歷號：那一格、還寫成短備註的照樣認、沒有就是 null', () => {
    const b = syncBundle(base({
      customers: [
        { id: 'a', name: '客戶A', chartNo: '1234' },
        { id: 'b', name: '客戶B', marks: [{ text: '病歷號 4321', color: 'grey' }] },
        { id: 'w', name: '王小明' },
      ],
    }));
    assert.deepEqual(Object.fromEntries(b.sheets.map((s) => [s.name, s.chartNo])), { 客戶A: '1234', 客戶B: '4321', 王小明: null });
  });
});

// ---------- `.gs` 那一側 ----------

const push = (app, bundle, extra = {}) => {
  const reply = app.post({ token: 'secret', bundle, ...extra });
  assert.equal(reply.ok, true, reply.error);
  return reply;
};
const sheetOf = (app, name) => app.ss.getSheetByName(name);

describe('.gs：沒變的那幾頁只改產生時間', () => {
  test('同一包推兩次：第二次一頁都不重畫、回報 kept 2、第三列換成這一次的時間', () => {
    const app = loadAppsScript();
    assert.deepEqual(push(app, syncBundle(base())), { ok: true, sheets: 2, kept: 0, skipped: [] });
    const clears = sheetOf(app, '客戶A').clears;
    const reply = push(app, syncBundle(base({ generatedAt: '2026/10/19 下午3:00:00' })));
    assert.deepEqual([reply.sheets, reply.kept], [0, 2]);
    assert.equal(sheetOf(app, '客戶A').clears, clears);
    assert.match(sheetOf(app, '客戶A').at('A3'), /^產生時間 2026\/10\/19 下午3:00:00/);
    assert.match(sheetOf(app, '王小明').at('A3'), /^產生時間 2026\/10\/19 下午3:00:00/);
  });

  test('改了一位：只重畫那一位', () => {
    const app = loadAppsScript();
    push(app, syncBundle(base()));
    const w = sheetOf(app, '王小明').clears;
    const reply = push(app, syncBundle(base({ visitsBy: { a: [done('v1', '2026-10-01'), done('v2', '2026-10-08')] } })));
    assert.deepEqual([reply.sheets, reply.kept], [1, 1]);
    assert.equal(sheetOf(app, '王小明').clears, w);
  });

  test('兩台裝置交替推、資料改回原樣 → 每一頁照舊對（指紋只在這一側，app 沒有狀態）', () => {
    const app = loadAppsScript();
    const a = syncBundle(base());
    const b = syncBundle(base({ entitlementsBy: { a: [ent('e1', 20)], w: [ent('e1', 6)] } }));
    push(app, a); // 手機
    push(app, b); // iPad
    const back = push(app, syncBundle(base())); // 手機：資料改回 A 的樣子
    assert.equal(back.sheets, 1, '客戶A 那一頁要重畫回 A 版');
    const row = (sheet) => Array.from({ length: 12 }, (_, c) => sheet.at(`${String.fromCharCode(65 + c)}6`)).join('|');
    const fresh = loadAppsScript();
    push(fresh, a);
    assert.equal(row(sheetOf(app, '客戶A')), row(sheetOf(fresh, '客戶A')));
  });

  test('刪掉一位：那一頁照舊被刪，指紋也拿掉', () => {
    const app = loadAppsScript();
    push(app, syncBundle(base()));
    push(app, syncBundle(base({ customers: [{ id: 'a', name: '客戶A', chartNo: '1234' }] })));
    assert.equal(sheetOf(app, '王小明'), null);
    assert.ok(!app.docProps.has('fp:王小明'));
  });

  test('她手動刪了一頁、或清空一頁 → 下一次推送那一頁重畫', () => {
    const app = loadAppsScript();
    push(app, syncBundle(base()));
    app.ss.deleteSheet(sheetOf(app, '王小明'));
    sheetOf(app, '客戶A').cells.clear();
    const reply = push(app, syncBundle(base()));
    assert.deepEqual([reply.sheets, reply.kept], [2, 0]);
    assert.match(sheetOf(app, '王小明').at('A1'), /系統自動產生/);
    assert.match(sheetOf(app, '客戶A').at('A1'), /系統自動產生/);
  });

  // 段四審查：以前每一次推送整頁重畫，所以 onEdit 那一句「下次同步就會被蓋掉」一定成立。現在沒變的那一頁不重畫 ——
  // 她選一塊格子按刪除（多格編輯沒有 oldValue，onEdit 只能清成空的）、或刪了幾列，那一頁會一直停在改壞的樣子
  test('她在沒變的那一頁手動改過（onEdit）→ 下一次推送那一頁照樣重畫', () => {
    const app = loadAppsScript();
    push(app, syncBundle(base()));
    const sheet = sheetOf(app, '客戶A');
    // 多格編輯：Apps Script 給的事件沒有 oldValue
    app.context.onEdit({ range: sheet.getRange(6, 2), source: { getActiveSheet: () => sheet } });
    const reply = push(app, syncBundle(base()));
    assert.deepEqual([reply.sheets, reply.kept], [1, 1], '改過的那一頁重畫、另一頁照舊沒變');
  });

  test('整份重畫（force）＝以前的行為：每一頁都重畫', () => {
    const app = loadAppsScript();
    push(app, syncBundle(base()));
    const reply = push(app, syncBundle(base()), { force: true });
    assert.deepEqual([reply.sheets, reply.kept], [2, 0]);
  });

  test('這一份指令碼的排版版號加一 → 每一頁重畫', () => {
    const app = loadAppsScript();
    push(app, syncBundle(base()));
    app.context.LAYOUT_VERSION += 1;
    assert.deepEqual(push(app, syncBundle(base())).kept, 0);
  });

  test('畫到一半出事：畫好的那幾頁已經上鎖、記了指紋；下一次只畫沒畫完的', () => {
    const app = loadAppsScript();
    const bundle = syncBundle(base());
    const [first, second] = bundle.sheets.map((s) => s.name);
    const real = app.context.renderCustomer;
    app.context.renderCustomer = (ss, data, b) => {
      if (data.name === second) throw new Error('逾時');
      return real(ss, data, b);
    };
    assert.equal(app.post({ token: 'secret', bundle }).ok, false);
    assert.ok(app.docProps.has(`fp:${first}`));
    assert.ok(!app.docProps.has(`fp:${second}`));
    assert.ok(sheetOf(app, first).protections.length > 0, '畫好的那一頁要已經鎖了');
    app.context.renderCustomer = real;
    const reply = push(app, syncBundle(base()));
    assert.deepEqual([reply.sheets, reply.kept], [1, 1]);
  });

  test('她自己的同名分頁照舊不動、照舊回報跳過', () => {
    const app = loadAppsScript({ sheetNames: ['王小明'] });
    sheetOf(app, '王小明').set(1, 1, '我自己的表');
    const reply = push(app, syncBundle(base()));
    assert.deepEqual(reply.skipped, ['王小明']);
    assert.equal(sheetOf(app, '王小明').at('A1'), '我自己的表');
    assert.equal(push(app, syncBundle(base())).skipped.length, 1);
  });

  test('抬頭那一行印「病歷號 1234」；沒有病歷號的那一頁不寫那一段', () => {
    const app = loadAppsScript();
    push(app, syncBundle(base()));
    assert.match(sheetOf(app, '客戶A').at('C2'), /^病歷號 1234　·　/);
    assert.doesNotMatch(sheetOf(app, '王小明').at('C2'), /病歷號/);
  });
});

describe('sheetPlan()：拿不準一律重畫', () => {
  const { context } = loadAppsScript();
  const ok = { force: false, exists: true, ours: true, stored: 'x|1', mark: 'x|1' };
  test('全部對得上才留著', () => assert.equal(context.sheetPlan(ok), 'keep'));
  for (const [why, over] of [
    ['按了整份重畫', { force: true }], ['分頁不在', { exists: false }], ['第一列那句提醒不在', { ours: false }],
    ['沒記過指紋', { stored: null }], ['app 沒給指紋', { mark: null }], ['指紋不一樣', { stored: 'y|1' }],
  ]) test(why, () => assert.equal(context.sheetPlan({ ...ok, ...over }), 'draw'));
});

// 改了 `.gs` 的畫法卻忘了把 `LAYOUT_VERSION` 加一 → 沒變的那幾頁永遠停在舊的畫法。
// 這裡釘著「拿掉註解與空白之後的程式碼」的雜湊：一改就紅，提醒加一並換掉這裡的數字。
test('.gs 的程式碼改了，LAYOUT_VERSION 要跟著加一（然後換掉這裡的雜湊）', () => {
  const src = readFileSync(new URL('../sheets/readonly-report.gs', import.meta.url), 'utf8');
  const version = Number(src.match(/var LAYOUT_VERSION = (\d+);/)[1]);
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/var LAYOUT_VERSION = \d+;/, '')
    .replace(/\s+/g, ' ');
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 12);
  assert.deepEqual({ version, hash }, { version: 1, hash: '9f20527f7294' },
    '改了 sheets/readonly-report.gs：畫法變了的話 LAYOUT_VERSION 加一；兩種都把這裡換成新的 version 與 hash');
});

// ---------- app 那一側：設定頁的字、手動貼上、推送那一支 ----------

describe('設定頁那幾句', () => {
  test('pushedSay()：分得出重畫了幾頁、幾頁沒變；舊的 .gs（沒有 kept）照舊那一句', () => {
    assert.equal(pushedSay({ sheets: 1, kept: 30 }), '推好了：重畫了 1 張分頁、30 張沒變（只改了產生時間）');
    assert.equal(pushedSay({ sheets: 0, kept: 31 }), '推好了，31 張分頁都沒變（只改了產生時間）');
    assert.equal(pushedSay({ sheets: 31, kept: 0 }), '推好了：重畫了 31 張分頁');
    assert.equal(pushedSay({ sheets: 31, kept: null }), '推好了，試算表更新了 31 張分頁');
  });

  test('讀到的不是全部、這一趟沒推：不講「被拒絕」、不講要重貼', () => {
    const { tone, lines } = describeSync({
      configured: true, lastAtLabel: '昨天', dirty: true, error: '網路不穩，讀到的不是全部的資料', errorAtLabel: '剛剛', partial: true,
    });
    assert.equal(tone, 'waiting');
    assert.ok(lines.some((l) => l.startsWith('上次沒推（剛剛）：網路不穩')));
    assert.ok(!lines.some((l) => /被拒絕|重新貼/.test(l)), lines.join('｜'));
  });
});

test('手動貼上那條路也印病歷號（那一格、還沒搬的短備註都認）', () => {
  const row = (customer) => customerReport({ customer, entitlements: [], visits: [] }).rows.find((r) => r[0] === '病歷號');
  assert.deepEqual(row({ id: 'a', name: '客戶A', chartNo: '1234' }), ['病歷號', '1234']);
  assert.deepEqual(row({ id: 'b', name: '客戶B', marks: [{ text: '病歷號 4321' }] }), ['病歷號', '4321']);
  assert.deepEqual(row({ id: 'w', name: '王小明' }), ['病歷號', '']);
});

describe('sheetSync.js（原始碼）', () => {
  const src = readFileSync(new URL('../public/js/data/sheetSync.js', import.meta.url), 'utf8');

  test('buildBundle()：讀到快取或離線就丟 IncompleteReadError（中途發現 2，同 listBetweenWhole() 那一套）', () => {
    const body = src.slice(src.indexOf('export async function buildBundle'), src.indexOf('export function push'));
    assert.match(body, /const since = repo\.cacheReads\(\);/);
    assert.match(body, /readsIncomplete\(\{\s*offline: globalThis\.navigator\?\.onLine === false,\s*sources: \[readSource\(repo\.cacheReads\(\) !== since\)\],/);
    assert.match(body, /throw new IncompleteReadError\(/);
  });

  test('run()：接住它、這一趟不推、留著待推標記（noteFailure 寫 DIRTY），回 partial', () => {
    assert.match(src, /err\?\.name === 'IncompleteReadError'\) return \{ \.\.\.noteFailure\(err\.message, \{ partial: true \}\), partial: true \}/);
  });

  test('整份重畫不被一般推送的去重併掉：路上那一份不是 force 就等它回來再推一份 force', () => {
    assert.match(src, /inFlight\?\.at === version && \(inFlight\.force \|\| !force\)/);
    assert.match(src, /inFlight = \{ at, force, promise \}/);
    assert.match(src, /force \? \{ token, bundle, force: true \}/);
  });
});

// 段四審查：讀到快取、這一趟沒推（中途發現 2）—— 設定頁講「上次沒推」，首頁那一行沒傳 `partial`，照樣紅字「上次推失敗了」。
// 同一件事兩個入口（lessons 一）：每一個叫 `describeSync()` 的畫面都要傳
test('每一個叫 describeSync() 的畫面都傳 partial', () => {
  for (const rel of ['public/js/ui/views/home.js', 'public/js/ui/views/report.js']) {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
    const calls = [...src.matchAll(/describeSync\(\{[^}]*\}\)/g)].map((m) => m[0]);
    assert.ok(calls.length > 0, rel);
    for (const call of calls) assert.match(call, /partial:/, rel);
  }
});

// 段四審查：有幾張沒更新時那一句以前只讀 `sheets` —— 其他分頁都沒變的時候講「推好了 0 張，但有 1 張沒有更新」
test('skippedPushSay()：沒變的那幾頁也講出來，再講哪幾張沒更新', () => {
  const say = skippedPushSay({ sheets: 0, kept: 30, skipped: ['王小明'] });
  assert.doesNotMatch(say, /推好了 0 張/);
  assert.match(say, /30 張分頁都沒變/);
  assert.match(say, /1 張沒有更新：王小明/);
  assert.match(skippedPushSay({ sheets: 2, kept: null, skipped: ['王小明'] }), /更新了 2 張分頁.*1 張沒有更新/);
});
