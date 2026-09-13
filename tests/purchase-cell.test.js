// 舊試算表 B2「購買名稱」那一格（`.scratch/asks-2026-09-13/issues/07`）。
//
// 她 2026-09-13：「我寫0617 顧客會-8+5 (其中0617代表6/17買的，8代表8萬方案(8+8代表8萬方案買了兩套)
// 5(0.75/12) 代表+5(0.75/12)萬健檢」，以及「新就是新 8 萬方案」「目前B2裡的5、12、0.75、3.6
// 一律當健檢金額」。
//
// 例子是 2026-09-13 讀她那份 xlsx 時看到的**形狀**，醫療註記與人名一律換掉了。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePurchaseCell } from '../public/js/domain/legacyImport.js';

const p = (raw) => parsePurchaseCell(raw, 2026);

describe('B2 購買名稱怎麼讀', () => {
  test('0617 顧客會-8+5：日期、通路、8 萬方案一套、5 萬健檢', () => {
    const out = p('0617 顧客會-8+5');
    assert.equal(out.date, '2026-06-17');
    assert.equal(out.channel, '顧客會');
    assert.deepEqual(out.plan, { newTemplate: false, sets: 1 });
    assert.deepEqual(out.exams, ['5萬']);
    assert.deepEqual(out.extras, []);
    assert.equal(out.leftover, '');
  });

  test('破折號前面有沒有空白都一樣', () => {
    assert.deepEqual(p('0514 顧客會 -8').plan, { newTemplate: false, sets: 1 });
  });

  test('8+8+12：兩套方案加 12 萬健檢', () => {
    const out = p('0514 顧客會-8+8+12');
    assert.deepEqual(out.plan, { newTemplate: false, sets: 2 });
    assert.deepEqual(out.exams, ['12萬']);
  });

  test('只有健檢，小數也讀得到（舊的 parseWan 讀不到 0.75）', () => {
    assert.deepEqual(p('0706 H2U導客 -0.75').exams, ['0.75萬']);
    assert.deepEqual(p('0717 H2U導客 -3.6').exams, ['3.6萬']);
    assert.equal(p('0706 H2U導客 -0.75').plan, null);
    assert.equal(p('0706 H2U導客 -0.75').channel, 'H2U導客');
  });

  test('數字前面沒有破折號', () => {
    const out = p('0723顧客會12');
    assert.equal(out.date, '2026-07-23');
    assert.equal(out.channel, '顧客會');
    assert.deepEqual(out.exams, ['12萬']);
  });

  test('沒有數字：只有日期與通路', () => {
    for (const raw of ['0720 - H2U導客', '0806 H2U導客 -', '0723 顧客會']) {
      const out = p(raw);
      assert.ok(out.date, raw);
      assert.ok(out.channel, raw);
      assert.equal(out.plan, null, raw);
      assert.deepEqual(out.exams, [], raw);
      assert.equal(out.leftover, '', raw);
    }
  });

  test('日期寫在後面（新-8萬-顧客會8/24）', () => {
    const out = p('新-8萬-顧客會8/24');
    assert.equal(out.date, '2026-08-24');
    assert.equal(out.channel, '顧客會');
    assert.deepEqual(out.plan, { newTemplate: true, sets: 1 });
  });

  test('「新」＝新 8 萬方案', () => {
    assert.deepEqual(p('0821新-顧客會-8+8').plan, { newTemplate: true, sets: 2 });
  });

  test('方案加寫在字裡的加購', () => {
    const out = p('0821新 - 顧客會-8+復能任選(30)x10堂');
    assert.deepEqual(out.plan, { newTemplate: true, sets: 1 });
    assert.deepEqual(out.extras, [{ text: '復能任選(30)', qty: 10 }]);
  });

  test('只有加購（only 與 + 兩種寫法）', () => {
    assert.deepEqual(p('0820新 - 顧客會-only sis(60)x10').extras, [{ text: 'sis(60)', qty: 10 }]);
    assert.deepEqual(p('0901新 - 顧客會 sis(60)x5+ILIB(60)x5').extras,
      [{ text: 'sis(60)', qty: 5 }, { text: 'ILIB(60)', qty: 5 }]);
  });

  test('寫了「新」卻沒有方案數字 → 講出來（她說那一種應該是打錯）', () => {
    const out = p('0820新 - 顧客會-only sis(60)x10');
    assert.equal(out.plan, null);
    assert.ok(out.problems.some((x) => x.includes('新')), JSON.stringify(out.problems));
  });

  test('括號裡的微調原文留下來', () => {
    const out = p('0514 顧客會-8+8(換成某某）');
    assert.deepEqual(out.plan, { newTemplate: false, sets: 2 });
    assert.equal(out.leftover, '換成某某');
  });

  test('破折號後面是一句話不是數字 → 整句進 leftover', () => {
    const out = p('0604 顧客會-某種醫療註記，只能某台');
    assert.equal(out.channel, '顧客會');
    assert.equal(out.plan, null);
    assert.equal(out.leftover, '某種醫療註記，只能某台');
  });

  test('整格手寫、沒有日期也沒有通路 → 整句進 leftover', () => {
    const out = p('朋友介紹來的');
    assert.equal(out.date, null);
    assert.equal(out.channel, null);
    assert.equal(out.leftover, '朋友介紹來的');
  });

  test('尾款那一句也是 leftover（顏色在建備註時才決定）', () => {
    assert.equal(p('0617 顧客會-8+欠尾款3萬').leftover, '欠尾款3萬');
  });

  test('空的就是空的', () => {
    const out = p('');
    assert.equal(out.date, null);
    assert.equal(out.channel, null);
    assert.equal(out.plan, null);
    assert.equal(out.leftover, '');
  });

  test('不存在的日期不要硬湊（1332）', () => {
    assert.equal(p('1332 顧客會-8').date, null);
  });
});

// ---------------------------------------------------------------------------
// 讀出來的東西怎麼進額度與客戶（`planForSheet()`）。
//
// 她：「所有的方案課程加購都可以再用各種課程的應有次數去驗證一次，然後合併的時候也可以再問我一次」。

import { parseSheet, planForSheet } from '../public/js/domain/legacyImport.js';
import { SEED } from '../public/js/domain/seed.js';

const CTX = {
  courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts, plans: SEED.plans,
  existingCustomers: [], year: 2026, importedAt: '2026-09-13T00:00:00.000Z',
};

/** 一張舊表。`d` 是第 2–8 列的應有次數（Inbody、復健、物理、營養、體適能、復能、ILIB）。 */
function sheet(b2, d, extraRows = []) {
  const labels = ['Inbody', '復健門診', '物理諮詢', '營養諮詢', '體適能分析', '復能(1小時)', 'ILIB 60mins'];
  return [
    '客戶名稱,,,應有次數,實際次數,8/1',
    ...labels.map((label, i) => `${i === 0 ? '客戶A' : ''},${i === 0 ? b2 : ''},${label},${d[i]},0,FALSE`),
    ...extraRows,
  ].join('\n');
}
const OLD = [4, 2, 4, 4, 4, 20, 12];
const NEW = [4, 6, 4, 4, 4, 12, 20];
const times = (d, n) => d.map((x) => x * n);
const planOf = (text) => planForSheet(parseSheet(text, { sheetName: '客戶A' }), CTX);
const planRows = (p) => p.entitlements.filter((e) => e.doc.sourcePlanName);
const extraRows = (p) => p.entitlements.filter((e) => !e.doc.sourcePlanName && !e.doc.followupForEntitlementKey);
const said = (p) => (p.purchaseProblems ?? []).join('\n');

describe('B2 進額度', () => {
  test('0617 顧客會-8：第 2–8 列是舊 8 萬方案一套，帶購買日與套數', () => {
    const p = planOf(sheet('0617 顧客會-8', OLD));
    const rows = planRows(p);
    assert.equal(rows.length, 7);
    assert.ok(rows.every((e) => e.doc.sourcePlanName === '8萬方案'), JSON.stringify(rows.map((e) => e.doc.sourcePlanName)));
    assert.ok(rows.every((e) => e.doc.sourcePlanSets === 1));
    assert.ok(rows.every((e) => e.doc.purchasedAt === '2026-06-17'));
    assert.equal(p.customer.source, '顧客會', '通路，不是整格原文');
    assert.equal(p.customer.purchasedAt, '2026-06-17');
  });

  test('新 8 萬 × 2：名字是新8萬方案，sourcePlanQty 是範本 × 套數', () => {
    const p = planOf(sheet('0821新-顧客會-8+8', times(NEW, 2)));
    const pool = planRows(p).find((e) => e.doc.type === 'pool');
    assert.equal(pool.doc.sourcePlanName, '新8萬方案');
    assert.equal(pool.doc.sourcePlanSets, 2);
    assert.equal(pool.doc.sourcePlanQty, 24);
    assert.equal(pool.doc.totalQty, 24);
    assert.equal(said(p), '');
  });

  test('D 欄是新範本但 B2 沒寫「新」→ 照 D 欄，而且講出來', () => {
    const p = planOf(sheet('0721顧客會-8', NEW));
    assert.ok(planRows(p).every((e) => e.doc.sourcePlanName === '新8萬方案'));
    assert.match(said(p), /新/);
  });

  test('B2 寫兩套、D 欄是一套 → 講出來', () => {
    const p = planOf(sheet('0514 顧客會-8+8', OLD));
    assert.match(said(p), /2 套/);
  });

  test('方案裡有一項被改過 → sourcePlanQty 是範本，totalQty 是 D 欄，而且講出來', () => {
    const d = [...OLD];
    d[5] = 23;
    const p = planOf(sheet('0603 顧客會-8', d));
    const pool = planRows(p).find((e) => e.doc.type === 'pool');
    assert.equal(pool.doc.sourcePlanQty, 20);
    assert.equal(pool.doc.totalQty, 23);
    assert.match(said(p), /20.*23|23.*20/);
  });

  test('B2 沒寫方案、第 2–8 列有次數 → 那幾列是加購', () => {
    const d = [0, 0, 0, 0, 0, 29, 1];
    const p = planOf(sheet('0604 顧客會-某種註記', d));
    assert.equal(planRows(p).length, 0);
    assert.equal(extraRows(p).length, 2);
    assert.ok(extraRows(p).every((e) => e.doc.purchasedAt === '2026-06-04'));
  });

  test('寫了健檢金額卻跟第 9 列的等級對不上 → 講出來', () => {
    const p = planOf(sheet('0617 顧客會-8+5', OLD, [',,12萬健檢,1,0,FALSE']));
    assert.match(said(p), /5萬/);
  });

  test('寫在字裡的加購找得到次數一樣的那一列就不講', () => {
    const p = planOf(sheet('0901新 - 顧客會 sis(60)x5', [0, 0, 0, 0, 0, 0, 0], [',,SIS(60min),5,0,FALSE']));
    assert.doesNotMatch(said(p), /sis\(60\)/i);
  });

  test('寫在字裡的加購找不到那一列 → 講出來', () => {
    const p = planOf(sheet('0901 顧客會 sis(60)x5', [0, 0, 0, 0, 0, 0, 0], [',,EECP,40,0,FALSE']));
    assert.match(said(p), /sis\(60\)x5/);
  });

  test('D 欄有次數、B2 一個字都沒提 → 提醒一句（不是錯）', () => {
    const p = planOf(sheet('0723 顧客會', [0, 0, 0, 0, 0, 0, 0], [',,EECP,40,0,FALSE']));
    assert.match(said(p), /EECP/);
  });

  test('B2 剩下的字進備註；有「尾款」的是紅色', () => {
    const p = planOf(sheet('0617 顧客會-8+欠尾款3萬', OLD));
    const marks = p.customer.marks;
    assert.ok(marks.some((m) => m.text === '欠尾款3萬' && m.color === 'red'), JSON.stringify(marks));
  });

  test('營養品那一列進備註（她：營養品不用進抬頭，但是可以寫在備註）', () => {
    const p = planOf(sheet('0706 H2U導客 -0.75', [0, 0, 0, 0, 0, 0, 0],
      [',夜態美+速膳淨,營養品(5000),1,0,FALSE']));
    assert.ok(p.customer.marks.some((m) => m.text.includes('營養品(5000)')), JSON.stringify(p.customer.marks));
  });

  test('marks 與 notes 講的是同一件事（notes 是鏡像）', () => {
    const p = planOf(sheet('0617 顧客會-8+欠尾款3萬', OLD));
    assert.equal(p.customer.notes, p.customer.marks.map((m) => m.text).join('\n'));
  });

  test('整格手寫 → 沒有通路、沒有購買日，整句進備註', () => {
    const p = planOf(sheet('朋友介紹來的', [0, 0, 0, 0, 0, 0, 0], [',,EECP,10,0,FALSE']));
    assert.equal(p.customer.source, null);
    assert.equal(p.customer.purchasedAt, null);
    assert.ok(p.customer.marks.some((m) => m.text === '朋友介紹來的'));
  });

  test('一則備註超過 40 個字 → 照收，但報告要講（匯進去之後編輯時存不下去）', () => {
    const long = `0617 顧客會-8+${'很長的註記'.repeat(9)}`;
    const p = planOf(sheet(long, OLD));
    assert.ok(p.customer.marks.some((m) => m.text.length > 40), '原文照收，一個字都不砍');
    assert.ok(p.problems.some((x) => x.why.includes('40')), JSON.stringify(p.problems.map((x) => x.why)));
  });

  test('同一次購買共用一個 purchaseKey（方案一個、加購一個）', () => {
    const p = planOf(sheet('0617 顧客會-8', OLD, [',,EECP,40,0,FALSE']));
    const keys = new Set(planRows(p).map((e) => e.doc.purchaseKey));
    assert.equal(keys.size, 1);
    assert.ok(extraRows(p).every((e) => e.doc.purchaseKey && !keys.has(e.doc.purchaseKey)));
  });
});
