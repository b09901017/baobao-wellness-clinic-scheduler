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

// 她 2026-09-08：「就請讓我只能修改這一個時段的東西，而不是讓我還可以新增
// 還可以修其他時段的東西」。
//
// 每一條進得了編輯器的路**本來就知道是哪一段**（日／週那一列的 `data-open`
// 從 ADR-0080 起就是三格），只是進去之後把那個數字丟掉了。
describe('改一筆來訪＝改那一段（issue 07）', () => {
  const CAL = readFileSync(
    new URL('../public/js/ui/views/calendar.js', import.meta.url), 'utf8',
  );

  test('mountEdit() 收得到 slotIndex', () => {
    assert.match(SRC, /export async function mountEdit\(el, \{ visitId, slotIndex = null/);
  });

  test('讀取卡片上的鉛筆把她點的那一段帶過去', () => {
    const at = CAL.indexOf("kind: 'visit', visitId: visit.id, date: visit.date, backDate: date");
    assert.ok(at > 0, '找不到讀取卡片的鉛筆');
    assert.match(CAL.slice(at, at + 120), /slotIndex: focus/);
  });

  test('長按選單的「改這一筆」也帶', () => {
    const at = CAL.indexOf("if (action === 'edit')");
    assert.ok(at > 0);
    assert.match(CAL.slice(at, at + 300), /slotIndex/);
  });

  test('抽屜那一層轉手時不可以掉', () => {
    assert.match(CAL, /visitEditor\.mountEdit\(host, \{ visitId: spec\.visitId, slotIndex: spec\.slotIndex/);
  });

  test('沒畫出來的那一段整個回原本那一個物件，不是重組一份', () => {
    const at = SRC.indexOf('function readDraft(');
    const body = SRC.slice(at, at + 1600);
    assert.match(body, /if \(!isEditable\(ctx, i\)\) return slot;/,
      '重組的話 attended／status 那幾格會被底下寫死的 null 清掉');
  });

  test('只畫一段時「＋新增一個時段」不出現', () => {
    assert.match(SRC, /ctx\.canAddSlots \? `/);
    assert.match(SRC, /canAddSlots: !existing/);
  });

  test('整筆的狀態卡與危險區只在整筆都在畫面上時出現', () => {
    assert.match(SRC, /const wholeVisit = !isNew && !ctx\.editSlots;/);
    assert.match(SRC, /\$\{wholeVisit \? statusCard\(/);
    assert.match(SRC, /\$\{wholeVisit \? dangerZone\(/);
  });
});

// 她 2026-09-08：「為什麼同一個人可以來訪一次裡面有兩項 然後又可以同一天
// 再來訪一次然後一項？」—— 壓表會併、日曆不查，同一件事兩種樣子。
describe('一人一天一筆（issue 04）', () => {
  const SCH = readFileSync(
    new URL('../public/js/ui/views/schedule.js', import.meta.url), 'utf8',
  );

  test('日曆新增時先找同一天那一筆', () => {
    assert.match(SRC, /sameDayVisitFor\(customerVisits, customer\.id/);
  });

  test('壓表走同一支，不自己比一份狀態清單', () => {
    const at = SCH.indexOf('function sameDayVisit(row, date)');
    assert.ok(at > 0);
    const body = SCH.slice(at, SCH.indexOf('\n}', at));
    assert.match(body, /sameDayVisitFor\(/);
    assert.ok(!body.includes('acceptsMoreSlots('), '兩份判斷遲早有一份漏掉一個狀態');
  });

  test('併進來時只有新加的那一段改得動', () => {
    assert.match(SRC, /merging \? \[base\.slots\.length\] : null/);
  });

  test('Abovee 那一道問的是「有沒有新的時段」，不是「這筆來訪是新的」', () => {
    assert.match(SRC, /if \(hasNewSlots\(ctx, draft\)\) \{/);
    assert.ok(!SRC.includes('if (isNew) {'), 'isNew 在併進來的時候是 false，那一道會整個不問');
  });

  test('確認框只列這一次新加的那幾段', () => {
    assert.match(SRC, /draft\.slots\.slice\(ctx\.storedSlotCount \?\? 0\)/);
  });

  test('那顆 × 逐段問「存過了沒」，不是問整筆', () => {
    const at = SRC.indexOf('function slotXButton(');
    const body = SRC.slice(at, SRC.indexOf(String.fromCharCode(10) + '}', at))
      // 註解裡照樣講得到 `ctx.isNew` —— 那一段就是在解釋為什麼不能問它
      .split(String.fromCharCode(10))
      .filter((l) => !l.trim().startsWith('//'))
      .join(String.fromCharCode(10));
    assert.match(body, /i < \(ctx\.storedSlotCount \?\? 0\)/);
    assert.ok(!body.includes('ctx.isNew'), '新加的那一段走取消那條路會長出一張假的「取消 Abovee」');
  });
});
