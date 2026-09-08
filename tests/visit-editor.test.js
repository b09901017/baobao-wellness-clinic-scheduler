// 來訪編輯器的版面不變量。
//
// 這一支盯的是**畫面上長不長得出來**，不是業務規則 —— 規則在
// `domain/visits.js`，而且已經有 `tests/visits.test.js` 盯著。
// 這裡防的是「規則對了，但那一排沒有被畫出來／被畫成空的」那一類 bug，
// 而那一類在瀏覽器上看起來跟做對了很像。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { chips } from '../public/js/ui/components/form.js';

const SRC = readFileSync(
  new URL('../public/js/ui/views/visitEditor.js', import.meta.url), 'utf8',
);

/** 那一段時段卡的原始碼。 */
const slotCard = SRC.slice(SRC.indexOf('function slotCard('), SRC.indexOf('function slotXButton('));

// 她 2026-09-08：「我選復能四選一 三選一什麼的 為什麼會多一個空白的『課程』」
//
// 擇一池的課程是從器材推出來的（ADR-0075），所以 `coursesForEntitlement()`
// 那一排刻意是空的。而那一行只問了 `length === 1`，於是 `[]` 走進去畫了
// 一個「課程」標籤加一列什麼都沒有的丸子。
//
// 上面那段註解自己寫著這一條當初是為了 n返 加的 —— 修的時候只補了 `nth` 那一半。
describe('一排零顆的丸子畫不出來（issue 08）', () => {
  test('沒有選項就整排不畫 —— 一個標籤底下什麼都沒有看起來像壞掉', () => {
    assert.equal(chips({ name: 'x', label: '課程', value: null, options: [] }), '');
  });

  test('options 沒給也一樣', () => {
    assert.equal(chips({ name: 'x', label: '課程', value: null }), '');
  });

  test('一顆照樣畫得出來 —— 這一支不是「少於兩顆就不畫」', () => {
    const out = chips({ name: 'x', label: '課程', value: 'a', options: [{ value: 'a', label: 'A' }] });
    assert.match(out, /data-chip="x"/);
  });

  test('課程那一排的判斷是「不到兩個選項就不畫」', () => {
    assert.match(slotCard, /courseChoices\.length <= 1/,
      '=== 1 的話擇一池的空陣列會走進去畫一排空的');
  });
});

// 她 2026-09-08：「我選器材也沒有跟著產生選治療師或診間？…為什麼壓表那邊可以，
// 但這邊卻不行？他們的不是共用同一個邏輯嗎？」
//
// **domain 確實共用**（兩邊都呼叫 `assignsFor()`，`tests/visits.test.js` 還有
// 一條掃描盯著沒有人自己比 `assigns`）。壞掉的是它什麼時候被重算：
// 器材那一排掛著 `quiet: true`，而 `quiet` 的意思就是「選了不派 change」，
// 於是 `paint()` 不跑，那一排永遠不出現。
//
// 那個 `quiet` 是 `<select>` 時代留下來的 —— ADR-0075 讓器材開始決定課程
// 之後就錯了，只是沒人回頭改。同一個原因也讓禁忌提醒不會跟著換。
describe('換器材要重畫（issue 09）', () => {
  const equipmentField = SRC.slice(
    SRC.indexOf('function equipmentField('), SRC.indexOf('function doctorField('),
  );

  test('器材那一排不可以 quiet —— 課程、指派、禁忌提醒三件事都跟著它', () => {
    assert.match(equipmentField, /name: `s\$\{i\}-equip`/);
    assert.ok(!equipmentField.includes('quiet: true'),
      'quiet = 不派 change = paint() 不跑 = 治療師那一排永遠不出現');
  });

  test('額度那一排本來就沒有 quiet，維持不動', () => {
    const ent = slotCard.slice(slotCard.indexOf('name: `s${i}-ent`'));
    assert.ok(!ent.slice(0, 200).includes('quiet'));
  });

  for (const [what, name] of [['治療師', 's${i}-staff'], ['醫師', 's${i}-doc'], ['診間', 's${i}-room']]) {
    test(`${what}那一排照樣 quiet —— 換它不影響任何別的欄位（ADR-0038）`, () => {
      const at = SRC.indexOf(`name: \`${name}\``);
      assert.ok(at > 0, `找不到 ${name}`);
      assert.match(SRC.slice(at, at + 260), /quiet: true/);
    });
  }
});

// 空的理由分兩種，而它們該長得不一樣。
describe('那一排為什麼是空的', () => {
  test('沒有選項也沒有 hint → 整排不畫（擇一池的課程）', () => {
    assert.equal(chips({ name: 'x', label: '課程', options: [] }), '');
  });

  test('沒有選項但有 hint → 標籤與那一句留著（主檔裡還沒有人）', () => {
    const out = chips({ name: 'x', label: '治療師', options: [], hint: '主檔裡還沒有治療師' });
    assert.match(out, /治療師/);
    assert.match(out, /主檔裡還沒有治療師/);
    assert.ok(!out.includes('data-chip='), '一顆丸子都不要畫');
  });

  test('來訪編輯器的治療師那一排講得出「主檔裡還沒有」', () => {
    assert.match(slotCard, /主檔裡還沒有治療師/, '壓表那一頁講得出來，這裡也要');
  });
});
