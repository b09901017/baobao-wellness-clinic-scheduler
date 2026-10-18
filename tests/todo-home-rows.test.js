// 待辦首頁每一列「一直顯示／有才顯示／不顯示」（staging-polish 07，ADR-0151）。
//
// 她：「我希望所有的待辦……都可以在設定打開或隱藏或呈現……即使沒有人有這個待辦，也可以呈現他」。
// 判斷「這一列畫不畫、畫成什麼樣」只有 `todoFlow.js` 一支；畫面不自己比。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  HOME_ROWS, ROW_SHOWS, rowShowOf, rowView, homeLoaders, storedRowShows, STAGES, stageOf, orderOf,
  NON_TASK_ROWS, rowLabel,
} from '../public/js/domain/todoFlow.js';

test('名單照流程的順序、每一列都在某一段裡', () => {
  assert.deepEqual(HOME_ROWS.map((r) => r.id), [
    'ask', 'forms', 'book', 'confirm', 'Examine', '耀聖', 'close',
    '寫紀錄', '追蹤健檢報告', '寄報告給醫師', '約二返', 'cancel',
  ]);
  for (const r of HOME_ROWS) {
    assert.ok(STAGES.some((s) => s.id === stageOf(r.id)), r.id);
    assert.ok(Number.isFinite(orderOf(r.id)), r.id);
    assert.ok(r.label, r.id);
  }
});

test('已經拿掉的種類、她手動加的不在名單上（等於永遠「有才顯示」）', () => {
  const ids = HOME_ROWS.map((r) => r.id);
  assert.ok(!ids.includes('打電話'));
  assert.ok(!ids.includes('Abovee'));
  assert.equal(rowShowOf('打電話', { todoRows: { 打電話: 'hidden' } }), 'auto');
  assert.equal(rowShowOf('她自己加的', {}), 'auto');
});

test('預設：問這輪的時間、壓表登記不顯示，其餘有才顯示', () => {
  assert.deepEqual(ROW_SHOWS, ['always', 'auto', 'hidden']);
  const defaults = Object.fromEntries(HOME_ROWS.map((r) => [r.id, rowShowOf(r.id, {})]));
  assert.equal(defaults.ask, 'hidden');
  assert.equal(defaults.book, 'hidden');
  for (const [id, v] of Object.entries(defaults)) {
    if (id !== 'ask' && id !== 'book') assert.equal(v, 'auto', id);
  }
  // 沒有設定（還沒讀到、沒存過）一樣
  assert.equal(rowShowOf('ask', undefined), 'hidden');
});

test('她存過的照她的；看不懂的值退回預設', () => {
  const s = { todoRows: { ask: 'auto', 寫紀錄: 'always', Examine: 'hidden', 耀聖: 'weird' } };
  assert.equal(rowShowOf('ask', s), 'auto');
  assert.equal(rowShowOf('寫紀錄', s), 'always');
  assert.equal(rowShowOf('Examine', s), 'hidden');
  assert.equal(rowShowOf('耀聖', s), 'auto');
});

test('畫不畫、畫成什麼樣：三種 × 有沒有東西 × 還沒載完', () => {
  const s = (v) => ({ todoRows: { 寫紀錄: v } });
  assert.equal(rowView('寫紀錄', 0, s('auto')), null);
  assert.deepEqual(rowView('寫紀錄', 2, s('auto')), { empty: false });
  assert.deepEqual(rowView('寫紀錄', 0, s('always')), { empty: true });
  assert.deepEqual(rowView('寫紀錄', 3, s('always')), { empty: false });
  assert.equal(rowView('寫紀錄', 3, s('hidden')), null);
  // 還沒載完（null）：哪一種都先不畫，等資料回來再補
  assert.equal(rowView('寫紀錄', null, s('always')), null);
});

test('要跑哪幾支 loader：預設只有客戶填好的時間；設成顯示才讀', () => {
  assert.deepEqual(homeLoaders({}), ['forms']);
  assert.deepEqual(homeLoaders(undefined), ['forms']);
  assert.deepEqual(homeLoaders({ todoRows: { ask: 'always', book: 'auto', forms: 'hidden' } }), ['ask', 'book']);
});

test('只存她改過的：跟預設一樣的那一格不存（之後改預設她沒動過的會跟著）', () => {
  assert.deepEqual(storedRowShows({ ask: 'hidden', book: 'always', 寫紀錄: 'auto', Examine: 'hidden' }),
    { book: 'always', Examine: 'hidden' });
  // 名單上沒有的不存
  assert.deepEqual(storedRowShows({ 打電話: 'always', ask: 'nope' }), {});
});

test('畫面不自己比 todoRows：home.js 只問 rowView／homeLoaders', () => {
  const src = readFileSync(new URL('../public/js/ui/views/home.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /todoRows/);
  assert.match(src, /rowView\(/);
  assert.match(src, /homeLoaders\(/);
});

test('首頁那幾列的名字只寫在 todoFlow.js 一份：home.js 不自己寫字、不自己列哪幾列不是任務種類', () => {
  // 設定 → 待辦首頁 讀 HOME_ROWS 的名字；首頁自己再寫一份的話，改了一邊兩頁就叫不同的名字
  const src = readFileSync(new URL('../public/js/ui/views/home.js', import.meta.url), 'utf8');
  for (const id of NON_TASK_ROWS) {
    const label = HOME_ROWS.find((r) => r.id === id).label;
    assert.ok(!src.includes(`'${label}'`), `home.js 自己寫了「${label}」`);
  }
  assert.ok(!src.includes("new Set(['ask'"), 'home.js 自己列了哪幾列不是任務種類');
  assert.equal(rowLabel('close'), '簽療程單');
  assert.equal(rowLabel('寫紀錄'), '寫紀錄');
});

test('「待辦首頁顯示哪幾列」在稽核上是中文', async () => {
  const { fieldLabel } = await import('../public/js/domain/audit.js');
  assert.notEqual(fieldLabel('todoRows'), 'todoRows');
});
