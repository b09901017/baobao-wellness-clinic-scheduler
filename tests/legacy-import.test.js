// 舊試算表匯入的解析與比對報告。
//
// 這裡的 fixture 全部是編出來的匿名資料。真實的工作表含客戶姓名與健康資訊，
// 一個字都不可以進版控（SPEC.md 第 10 節）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDelimited,
  parseSheet,
  parseSheetDate,
  parseIvBreakdown,
  readCheckbox,
  planForSheet,
  summarize,
  reportText,
} from '../public/js/domain/legacyImport.js';
import { SEED } from '../public/js/domain/seed.js';

const CTX = {
  courses: SEED.courses,
  equipment: SEED.equipment,
  ivProducts: SEED.ivProducts,
  plans: SEED.plans,
  existingCustomers: [],
  year: 2026,
  importedAt: '2026-08-18T00:00:00.000Z',
};

// A       B                  C              D   E   F(8/1) G(8/11) H(8/18)
const SHEET = [
  '客戶名稱,,,應有次數,實際次數,8/1,8/11,8/18',
  '客戶A,0522 顧客會-8,Inbody,4,1,FALSE,TRUE,FALSE',
  ',,復健門診,2,0,FALSE,FALSE,FALSE',
  ',,物理諮詢,4,0,FALSE,FALSE,FALSE',
  ',,營養諮詢,4,0,FALSE,FALSE,FALSE',
  ',,體適能分析,4,0,FALSE,FALSE,FALSE',
  ',,復能(1小時),20,2,TRUE,TRUE,FALSE',
  ',,ILIB 60mins,12,1,TRUE,FALSE,FALSE',
  ',,0.75萬健檢,1,0,FALSE,FALSE,FALSE',
  ',,EECP,3,0,FALSE,FALSE,FALSE',
  ',護肝排毒x11+雪顏亮彩x22,營養點滴,33,1,FALSE,FALSE,TRUE',
  ',夜態美+速膳淨,營養品(12000),1,0,FALSE,FALSE,FALSE',
  ',,,,,,7/17 二返(夏),',
  ',,,,,,,護肝',
].join('\n');

const plan = (overrides = {}) =>
  planForSheet(parseSheet(SHEET, { sheetName: '客戶A' }), { ...CTX, ...overrides });

const labels = (p) => p.entitlements.map((e) => e.doc.label);
const why = (p) => p.problems.map((x) => `${x.where}｜${x.raw}｜${x.why}`);

// ---------- 分隔文字 ----------

test('CSV 與 TSV 都吃，引號裡的逗號與換行不會把欄位切斷', () => {
  const csv = 'a,"b,1",c\n"多行\n註記",e,f';
  assert.deepEqual(parseDelimited(csv), [['a', 'b,1', 'c'], ['多行\n註記', 'e', 'f']]);

  const tsv = 'a\tb,1\tc';
  assert.deepEqual(parseDelimited(tsv), [['a', 'b,1', 'c']]);
});

test('連續兩個雙引號是一個雙引號', () => {
  assert.deepEqual(parseDelimited('"她說""不行""",b'), [['她說"不行"', 'b']]);
});

// ---------- 日期 ----------

test('表頭沒有年份時補基準年', () => {
  assert.deepEqual(parseSheetDate('8/11', 2026), { date: '2026-08-11', hadYear: false });
  assert.deepEqual(parseSheetDate('8月11日', 2026), { date: '2026-08-11', hadYear: false });
  assert.deepEqual(parseSheetDate('2025/8/11', 2026), { date: '2025-08-11', hadYear: true });
});

test('讀不出來的日期回 null，不亂猜', () => {
  assert.equal(parseSheetDate('待定', 2026).date, null);
  assert.equal(parseSheetDate('2/30', 2026).date, null);
  assert.equal(parseSheetDate('13/1', 2026).date, null);
});

test('補了年份這件事一定要進報告 —— 年份錯了整批來訪就掉到別的地方', () => {
  assert.ok(why(plan()).some((w) => w.includes('沒有寫年份') && w.includes('2026')));
});

// ---------- 勾選格 ----------

test('看不懂的格子不會被當成勾選，也不會被安靜丟掉', () => {
  assert.equal(readCheckbox('TRUE'), true);
  assert.equal(readCheckbox('FALSE'), false);
  assert.equal(readCheckbox(''), false);
  assert.equal(readCheckbox('大概吧'), null);

  const messy = SHEET.replace(',,復健門診,2,0,FALSE,FALSE,FALSE', ',,復健門診,2,0,大概吧,FALSE,FALSE');
  const p = planForSheet(parseSheet(messy, { sheetName: '客戶A' }), CTX);
  assert.ok(why(p).some((w) => w.includes('大概吧') && w.includes('看不懂')));
});

// ---------- 已知陷阱 ----------

test('0.75萬健檢 的名稱原文照抄，不會變成 75', () => {
  const checkup = plan().entitlements.find((e) => e.doc.label.includes('健檢'));
  assert.equal(checkup.doc.label, '0.75萬健檢');
  assert.equal(checkup.doc.totalQty, 1);
  // 舊的 parseWan() 會把 0.75 讀成 75。那個數字不該出現在任何欄位上
  assert.ok(!Object.values(checkup.doc).includes(75));
  assert.equal(checkup.doc.courseId, 'course-checkup');
});

test('購買數量不反推進資料，只在報告上提一句', () => {
  const p = plan();
  assert.equal(p.quantityHint, '看起來是「8萬方案」');
  // 數量不是任何一筆資料上的欄位
  assert.ok(!JSON.stringify(p.customer).includes('quantity'));
  for (const e of p.entitlements) assert.ok(!('quantity' in e.doc));
  // D 欄的數字直接就是總次數，沒有再乘一次
  assert.equal(p.entitlements.find((e) => e.doc.label === 'Inbody').doc.totalQty, 4);
});

test('營養點滴依品項拆成各自計次的額度，並跟 D 欄的加總對一次', () => {
  const p = plan();
  assert.deepEqual(
    p.entitlements.filter((e) => e.productName).map((e) => [e.doc.label, e.doc.totalQty]),
    [['營養點滴 - 護肝排毒', 11], ['營養點滴 - 雪顏亮彩', 22]],
  );
  // 11 + 22 = 33，跟 D11 對得起來，所以不該有「對不起來」的提醒
  assert.ok(!why(p).some((w) => w.includes('對不起來')));

  const bad = SHEET.replace('營養點滴,33,1', '營養點滴,30,1');
  const p2 = planForSheet(parseSheet(bad, { sheetName: '客戶A' }), CTX);
  assert.ok(why(p2).some((w) => w.includes('加起來是 33') && w.includes('30')));
});

test('主檔沒有的品項照樣建額度，但要講出來', () => {
  // 種子資料裡沒有「雪顏亮彩」
  const p = plan();
  assert.ok(labels(p).includes('營養點滴 - 雪顏亮彩'));
  assert.ok(why(p).some((w) => w.includes('雪顏亮彩') && w.includes('主檔裡沒有')));
});

test('復能是擇一池，換的是器材不是課程', () => {
  const pool = plan().entitlements.find((e) => e.doc.label.startsWith('復能'));
  assert.equal(pool.doc.type, 'pool');
  assert.equal(pool.doc.courseId, null);
  assert.deepEqual(pool.doc.optionEquipmentIds, ['eq-indiba', 'eq-sis', 'eq-laser']);
});

test('營養品只進備註，不建額度也不排班', () => {
  const p = plan();
  assert.ok(!labels(p).some((l) => l.startsWith('營養品')));
  assert.ok(p.customer.notes.includes('營養品(12000)：夜態美+速膳淨'));
});

test('二返註記原文帶進備註，不自動建來訪', () => {
  const p = plan();
  assert.ok(p.customer.notes.includes('7/17 二返(夏)'));
  assert.ok(!p.visits.some((v) => v.slots.some((s) => s.courseName === '二返')));
});

test('E 欄的實際次數跟勾選數對不起來時以勾選為準，但要講出來', () => {
  const bad = SHEET.replace(',,復能(1小時),20,2,', ',,復能(1小時),20,5,');
  const p = planForSheet(parseSheet(bad, { sheetName: '客戶A' }), CTX);
  assert.ok(why(p).some((w) => w.includes('E 欄') && w.includes('5') && w.includes('2 個')));
});

test('對不到課程的療程列不匯入，並且說得出是哪一列', () => {
  const bad = SHEET.replace(',,EECP,3,0,', ',,太空艙,3,0,');
  const p = planForSheet(parseSheet(bad, { sheetName: '客戶A' }), CTX);
  assert.ok(!labels(p).includes('太空艙'));
  assert.ok(why(p).some((w) => w.includes('第 10 列') && w.includes('太空艙')));
});

// ---------- 來訪 ----------

test('同一天的多個勾選合成一次來訪，一個時段一個課程', () => {
  const p = plan();
  assert.deepEqual(p.visits.map((v) => v.date), ['2026-08-01', '2026-08-11', '2026-08-18']);
  assert.deepEqual(p.visits.map((v) => v.slots.length), [2, 2, 1]);
  assert.deepEqual(p.visits[0].slots.map((s) => s.courseName), ['復能', '靜脈']);
});

test('匯入的來訪一律是已完成，而且時間、器材、診間、治療師都不詳', () => {
  for (const visit of plan().visits) {
    assert.equal(visit.status, 'done');
    assert.equal(visit.importedFrom.source, 'legacy-sheet');
    for (const slot of visit.slots) {
      assert.equal(slot.startsAt, null);
      assert.equal(slot.endsAt, null);
      assert.equal(slot.roomId, null);
      assert.equal(slot.therapistId, null);
      assert.equal(slot.attended, true);
    }
  }
  // 擇一池那一格：舊表沒寫用了哪一種器材
  const poolSlot = plan().visits[0].slots[0];
  assert.equal(poolSlot.equipmentId, null);
});

test('第 14 列的簡寫決定那天扣哪一份品項額度', () => {
  const p = plan();
  const ivVisit = p.visits.find((v) => v.date === '2026-08-18');
  const liver = p.entitlements.find((e) => e.productName === '護肝排毒');
  assert.equal(ivVisit.slots[0].entitlementKey, liver.key);
  assert.equal(ivVisit.slots[0].ivProductId, 'iv-liver');
});

test('簡寫對不到品項時不猜，那一格不匯入並列進報告', () => {
  const bad = SHEET.replace(",,,,,,,護肝", ',,,,,,,某個看不懂的字');
  const p = planForSheet(parseSheet(bad, { sheetName: '客戶A' }), CTX);
  assert.ok(!p.visits.some((v) => v.date === '2026-08-18'));
  assert.ok(why(p).some((w) => w.includes('不知道要扣哪一份額度')));
});

test('讀不出日期的那一欄，勾選不會被安靜丟掉', () => {
  const bad = SHEET.replace('8/1,8/11,8/18', '8/1,待定,8/18');
  const p = planForSheet(parseSheet(bad, { sheetName: '客戶A' }), CTX);
  assert.deepEqual(p.visits.map((v) => v.date), ['2026-08-01', '2026-08-18']);
  assert.ok(why(p).some((w) => w.includes('待定') && w.includes('讀不出日期')));
});

// ---------- 整張表的取捨 ----------

test('同名客戶已經在系統裡就整張跳過，不會建出第二份', () => {
  const p = plan({ existingCustomers: [{ id: 'c1', name: '客戶A' }] });
  assert.ok(p.skip.includes('客戶A'));
  assert.equal(p.customer, null);
  assert.deepEqual(p.entitlements, []);
  assert.deepEqual(p.visits, []);
});

test('已刪除的同名客戶不算數', () => {
  const p = plan({ existingCustomers: [{ id: 'c1', name: '客戶A', deletedAt: 'x' }] });
  assert.equal(p.skip, null);
});

test('沒有客戶名稱的工作表整張跳過', () => {
  const p = planForSheet(parseSheet(SHEET.replace('客戶A,0522', ',0522'), {}), CTX);
  assert.equal(p.skip, '沒有客戶名稱');
});

test('客戶的購買名稱帶過去，不含任何指回範本的欄位', () => {
  const p = plan();
  assert.equal(p.customer.source, '0522 顧客會-8');
  for (const e of p.entitlements) {
    assert.equal(e.doc.sourcePlanName, null);
    assert.ok(!('sourcePlanId' in e.doc));
  }
});

// ---------- 比對報告 ----------

test('報告數得出會建立幾位客戶、幾筆額度、幾筆來訪', () => {
  const one = plan();
  const skipped = plan({ existingCustomers: [{ id: 'c1', name: '客戶A' }] });
  const report = summarize([one, skipped]);

  assert.equal(report.sheets, 2);
  assert.equal(report.customers, 1);
  assert.equal(report.entitlements, 11);
  assert.equal(report.visits, 3);
  assert.equal(report.slots, 5);
  assert.equal(report.skipped.length, 1);
  assert.ok(report.problems > 0);
});

test('比對報告講得出總計、每一位建了什麼、以及每一個要看的地方', () => {
  const text = reportText([plan(), plan({ existingCustomers: [{ id: 'c1', name: '客戶A' }] })], {
    generatedAt: '2026-08-18 10:00',
    year: 2026,
  });

  assert.ok(text.includes('還沒有寫入任何東西'));
  assert.ok(text.includes('會建立 1 位客戶、11 筆額度、3 筆來訪（5 個時段）'));
  assert.ok(text.includes('沒寫年份的日期一律當成：2026 年'));
  assert.ok(text.includes('0.75萬健檢 1 次'));
  assert.ok(text.includes('營養點滴 - 護肝排毒 11 次'));
  assert.ok(text.includes('整張跳過'));
  assert.ok(text.includes('雪顏亮彩'));
});

test('勾得比買的還多照樣匯進去，但先講一聲資料健檢會報額度超用', () => {
  const bad = SHEET.replace('Inbody,4,1,FALSE,TRUE,FALSE', 'Inbody,1,1,TRUE,TRUE,TRUE');
  const p = planForSheet(parseSheet(bad, { sheetName: '客戶A' }), CTX);
  assert.equal(p.entitlements.find((e) => e.doc.label === 'Inbody').doc.totalQty, 1);
  assert.equal(p.visits.reduce((n, v) => n + v.slots.filter((s) => s.courseName === '身體組成分析').length, 0), 3);
  assert.ok(why(p).some((w) => w.includes('額度超用')));
});
