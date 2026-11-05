// 試算表推送變快（.scratch/sheet-push-gaps 的 02、03）：`.gs` 改成先讀完再寫、同一種動作收成一次，
// **畫出來的長相一個像素都不變**。
//
// 判準：**這一行會不會讓畫出來的跟改前不一樣？會不會讓一次推送叫 Google 的次數又跟頁數成正比、而且讀寫交錯？**
//
// 怎麼證明「一模一樣」：底下幾包（手造的，不經過 `syncBundle()` —— 那一支別輪會改）拿改前的 `.gs`
// （develop `3dd2ee12`，排版版號 1）在替身裡跑一串推送，每一步把整份試算表收成一份（`snapshotOf()`：
// 值、每一格的格式、合併、框線、欄寬、列高、凍結、鎖），雜湊釘在這裡。改後的 `.gs` 跑出來要是同一個雜湊。
// **哪天刻意改畫法**（LAYOUT_VERSION 加一）就換掉這裡的雜湊 —— 但先用 `scripts/sheet-gs-compare.mjs` 看清楚哪幾格變了。
// 例子一律假名、1234。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { loadAppsScript, snapshotOf } from './helpers/appsScriptStub.js';
import { callCounter } from './helpers/countGsCalls.js';

const LEGEND = '✓ 做完　△ 排了還沒做　○ 待確認　✗ 沒來';
const NOTICE = '⚠ 這張表由系統自動產生，請不要在這裡改資料 —— 改了也不會回到 app';

const dates = (n) => Array.from({ length: n }, (_, i) => `${1 + Math.floor(i / 28)}/${1 + (i % 28)}`);
const marksFor = (n, every, mark) => Array.from({ length: n }, (_, i) => (i % every === 0 ? mark : ''));

/** 什麼都有的一頁：額度好幾列、器材與記一句的註記列、二返註記、買過什麼、營養品（一筆沒給完）、備註、來訪紀錄、TODO、FINISHED。 */
function rich(name, fp) {
  const d = dates(8);
  return {
    name,
    fingerprint: fp,
    chartNo: '1234',
    source: '8萬方案',
    membershipExpiresAt: '2027-03-01',
    dateLabels: d,
    rows: [
      { label: '復能-三選一(60)', total: 10, done: 3, booked: 2, remaining: 5, marks: ['✓', '', '✓', '△', '', '✓', '○', '△'] },
      { label: '健檢', total: 2, done: 1, booked: 0, remaining: 1, marks: ['', '✓', '', '', '', '', '', ''] },
      { label: 'ILIB(60)', total: 4, done: 4, booked: 0, remaining: 0, marks: ['', '', '', '', '✓', '✓', '✓', '✓'] },
      { label: 'EECP(60)', total: 3, done: 3, booked: 1, remaining: -1, marks: ['✗', '', '', '', '', '', '', '△'] },
      { label: '三返（不算次數）', total: '—', done: 1, booked: 0, remaining: '—', marks: ['', '', '', '', '', '', '✓', ''] },
    ],
    equipmentNotes: [{ rowIndex: 0, label: '器材', cells: [{ dateIndex: 1, text: 'SIS' }, { dateIndex: 3, text: 'INDIBA' }, { dateIndex: 99, text: '表外' }] }],
    slotNotes: [
      { rowIndex: 0, label: '記一句', cells: [{ dateIndex: 1, text: '左肩比較緊' }] },
      { rowIndex: 3, label: '記一句', cells: [{ dateIndex: 8, text: '改期' }] },
    ],
    followupNotes: [{ dateIndex: 1, text: '8/12 二返(某明)' }, { dateIndex: 40, text: '表外' }],
    purchases: ['2026-08-01　8萬方案 ×1', '2026-09-10　ILIB(60) ×4'],
    products: [
      { label: '營養品A', amount: 12000, months: 3, items: ['魚油', '益生菌'], deliveredAt: '2026-09-01', delivery: '給了 1／3', done: false },
      { label: '營養品B', amount: null, months: null, items: [], deliveredAt: null, delivery: '都給了', done: true },
    ],
    flags: ['體內金屬', '孕'],
    notes: '住附近\n偏好早上',
    log: [
      { label: '9/1(二)', items: [{ status: '✓', time: '10:00', course: '復能', equipment: 'SIS', ivProduct: null, room: '治3', bed: 'A', therapist: '某明', doctor: null, note: null }] },
      { label: '9/8(二)', items: [
        { status: '✓', time: '10:00', course: '健檢', equipment: null, ivProduct: null, room: '.8', bed: null, therapist: null, doctor: '某華', note: null },
        { status: '△', time: '11:00', course: '營養點滴', equipment: null, ivProduct: '雪', room: '點滴8A', bed: null, therapist: null, doctor: null, note: '記得帶單子' },
      ] },
    ],
    tasks: {
      todo: [{ label: '9/8 健檢', kind: '追蹤健檢報告', dueDate: '2026-09-15' }, { label: '9/8 營養點滴', kind: 'Examine', dueDate: '2026-09-07' }],
      finished: [
        { label: '9/1 復能', kind: '寫紀錄', doneAt: '2026-09-01T10:00:00Z' },
        { label: '9/1 復能', kind: 'Abovee', doneAt: null },
        { label: '8/20 健檢', kind: '寄報告', doneAt: '2026-08-21T02:00:00Z' },
      ],
    },
    totals: { total: 19, done: 11, booked: 3, remaining: 5 },
  };
}

/** 什麼都沒有的一頁：0 筆額度、0 個日期、沒有營養品、沒買過、沒有待辦、沒有來訪、沒有備註。 */
function empty(name, fp) {
  return {
    name, fingerprint: fp, chartNo: null, dateLabels: [], rows: [], log: [],
    tasks: { todo: [], finished: [] }, totals: { total: 0, done: 0, booked: 0, remaining: 0 },
  };
}

/** 日期很多（矩陣比 FINISHED 那一欄還寬、超過預設 26 欄）、TODO 比 FINISHED 長、只有 FINISHED 沒有 TODO 的反過來在 rich。 */
function wide(name, fp) {
  const n = 40;
  return {
    name, fingerprint: fp, chartNo: '0012', source: '', dateLabels: dates(n),
    rows: [
      { label: '復能-SIS(30)', total: 40, done: 20, booked: 10, remaining: 10, marks: marksFor(n, 2, '✓') },
      { label: '營養點滴', total: 5, done: 0, booked: 5, remaining: 0, marks: marksFor(n, 7, '△') },
      { label: '功醫門診（體驗）', total: '—', done: 0, booked: 0, remaining: '—', marks: marksFor(n, 13, '○') },
    ],
    equipmentNotes: [],
    slotNotes: [{ rowIndex: 2, label: '記一句', cells: [{ dateIndex: 39, text: '最後一天' }] }],
    followupNotes: [],
    purchases: [],
    products: [],
    flags: [],
    notes: '',
    log: [{ label: '1/1(四)', items: [] }],
    tasks: { todo: [1, 2, 3, 4].map((i) => ({ label: `1/${i} 復能`, kind: 'Abovee', dueDate: `2027-01-0${i}` })), finished: [] },
    totals: { total: 45, done: 20, booked: 15, remaining: 10 },
  };
}

const bundleOf = (sheets, generatedAt = '2026/11/05 上午10:00:00') => ({
  format: 8, generatedAt, legend: LEGEND, notice: NOTICE, sheets,
});

const hashOf = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const propsOf = (app) => Object.fromEntries([...app.docProps].map(([k, v]) => [k, v.replace(/\|\d+$/, '')]));

/**
 * 一串推送：她自己的同名分頁、上一次留下來的一頁、名字有斜線的一頁 →
 * ① 第一次（全部畫）② 都沒變 ③ 一頁的資料變了、一位刪掉了 ④ 整份重畫。每一步拍一張。
 */
function story(source) {
  const app = loadAppsScript({ source, sheetNames: ['王小明', '舊的一位'] });
  app.ss.getSheetByName('王小明').set(1, 1, '我自己的表');
  app.ss.getSheetByName('舊的一位').set(1, 1, `${NOTICE}`);
  const shots = [];
  const step = (body) => {
    const reply = app.post({ token: 'secret', ...body });
    shots.push(hashOf({ reply, snap: snapshotOf(app.ss), props: propsOf(app) }));
  };
  const one = [rich('客戶A', 'a1'), empty('客戶B', 'b1'), wide('客戶C(高能/sis)', 'c1'), empty('王小明', 'w1')];
  step({ bundle: bundleOf(one) });
  step({ bundle: bundleOf(one, '2026/11/05 下午3:00:00') });
  const two = [rich('客戶A', 'a2'), wide('客戶C(高能/sis)', 'c1'), empty('王小明', 'w1')];
  two[0].rows[0].marks[1] = '✓';
  step({ bundle: bundleOf(two, '2026/11/05 下午4:00:00') });
  step({ bundle: bundleOf(two, '2026/11/05 下午5:00:00'), force: true });
  return shots;
}

describe('改後的 .gs 畫出來跟釘住的一樣（版號 3 只多了字級、版號 4 是第三輪的版面，見底下的註解）', () => {
  // 改前的 `.gs`（develop 3dd2ee12）在這個替身裡跑出來的雜湊是
  // ['324e92a670b8f085', 'ffc86214b0c6a1eb', 'a964e79459f34747', 'bc298f86f2acf2ae']（排版版號 1、2）。
  // **排版版號 3 刻意改了字級**（sheet-push-gaps 05：名字 14 號、第 3 列與註記列 9 號，以前被 `finish()` 整頁蓋成 11）——
  // 換之前用 `scripts/sheet-gs-compare.mjs` 跟版號 2 比過：正式站那一包四步都只有字級不一樣（1,100 格），值、底色、合併、框線、鎖一格都沒變。
  // 之後藏起來的 `_data` 分頁 B1 多一行「計時」（sheet-push-gaps 05 之二；替身的時鐘固定在 0，所以每次一樣）—— 客戶那幾頁一格都沒變
  // **排版版號 4 是第三輪的版面**（sheet-push-gaps 08～12，她看過示意圖）：一支 issue 換一次，每一次先用 `scripts/sheet-gs-compare.mjs`
  // 跟上一支的 `.gs` 比正式站那一包，變的只有那一支要變的（數字寫在那一支 issue 的「做完時留下的」）
  // 08：日期欄 78、數字四欄淡灰＋粗線、格線藏起來、名字 18 號、抬頭只有號碼、待辦區日期是文字
  // 09：凍結五列五欄、合併只到剩餘那一欄、折行的列照字數估高
  // 10：每一位的療程項目照「已完成＋已排未上」多到少排
  const BEFORE = ['ed17d5720679bba0', 'e70b915575bc8886', 'f10427a95998fa02', '2c6f6ad9ece09250'];

  test('四步，每一步整份試算表都一樣（值、格式、合併、框線、欄寬、列高、凍結、鎖、指紋）', () => {
    assert.deepEqual(story(null), BEFORE);
  });
});

describe('一次推送叫 Google 幾次（替身數的，scripts/sheet-gs-calls.mjs 同一套數法）', () => {
  const pages = (n) => Array.from({ length: n }, (_, i) => rich(`客戶${i}`, `f${i}`));

  test('都沒變的那一次：寫完又馬上讀接近 0，讀的次數不再一頁好幾次', () => {
    const app = loadAppsScript();
    const count = callCounter(app);
    app.post({ token: 'secret', bundle: bundleOf(pages(10)) });
    const stats = count(() => app.post({ token: 'secret', bundle: bundleOf(pages(10), '2026/11/05 下午') }));
    assert.equal(stats.result.kept, 10);
    // 改前（develop 3dd2ee12）：讀 47、寫 20、寫完又讀 14、文件屬性 11（一頁問一次指紋）
    assert.equal(stats.writeThenRead, 0, `寫完又馬上讀 ${stats.writeThenRead} 次`);
    // 一開始每一張分頁問名字與第一列那一格（10 位＋原始資料那一頁），其餘是固定的幾次（原始資料那一頁的鎖、藏起來了沒）
    assert.ok(stats.reads <= 2 * 11 + 7, `讀了 ${stats.reads} 次`);
    assert.equal(stats.props, 1, `文件屬性 ${stats.props} 次：一開始讀一次全部，沒變的不寫`);
    assert.ok(!stats.byName['Sheet.getLastRow'], '認不認得只看第一列那一格');
  });

  test('整份重畫：一頁固定幾十次（不再跟格子數成正比），寫完又讀一頁一次（上鎖時問誰能改）', () => {
    const app = loadAppsScript();
    const count = callCounter(app);
    app.post({ token: 'secret', bundle: bundleOf(pages(10)) });
    const stats = count(() => app.post({ token: 'secret', bundle: bundleOf(pages(10)), force: true }));
    assert.equal(stats.result.sheets, 10);
    // 改前（develop 3dd2ee12）同一包：讀 187、寫 1,980、寫完又讀 84（一頁約 200 次寫）；改後 讀 78、寫 452、寫完又讀 10
    assert.ok(stats.writes <= 10 * 50, `寫了 ${stats.writes} 次`);
    assert.ok(stats.writeThenRead <= 10, `寫完又馬上讀 ${stats.writeThenRead} 次`);
    for (const one of ['Range.setValue', 'Range.setBackground', 'Range.setWrap', 'Range.setVerticalAlignment', 'Sheet.setColumnWidth', 'Sheet.getLastRow']) {
      assert.ok(!stats.byName[one], `${one} 叫了 ${stats.byName[one]} 次：畫法要先畫在草稿紙上（Canvas）`);
    }
  });
});
