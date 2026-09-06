// 舊試算表匯入的解析與比對報告。
//
// 這裡的 fixture 全部是編出來的匿名資料。真實的工作表含客戶姓名與健康資訊，
// 一個字都不可以進版控（SPEC.md 第 10 節）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  parseDelimited,
  parseSheet,
  parseSheetDate,
  parseIvBreakdown,
  readCheckbox,
  planForSheet,
} from '../public/js/domain/legacyImport.js';
import { statusFor } from '../public/js/domain/mergeImport.js';
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
  // 她在 B 欄寫的品項不一定建過主檔。額度照建（原文照抄），但要在報告上講一聲，
  // 否則每次來訪的品項會靜靜地留空。用一個確定不在種子資料裡的名字測。
  const sheet = SHEET.replace('護肝排毒x11+雪顏亮彩x22', '護肝排毒x11+還沒建的品項x22');
  const p = planForSheet(parseSheet(sheet, { sheetName: '客戶A' }), CTX);
  assert.ok(labels(p).includes('營養點滴 - 還沒建的品項'));
  assert.ok(why(p).some((w) => w.includes('還沒建的品項') && w.includes('主檔裡沒有')));
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
  assert.deepEqual(p.visits[0].slots.map((s) => s.courseName), ['復能', 'ILIB']);
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

// ---------- 拿真的舊表跑過之後補的 ----------
//
// 下面這些是 2026-08-18 拿到真檔案（21 位客戶）跑 dry-run 才發現的落差。
// 每一條都對應 docs/legacy/README.md 第 6 節裡的一項，以及
// .scratch/legacy-import/issues/01-real-sheet-parse-gaps.md。
//
// fixture 一樣全部是編的。真實的樣本在 docs/legacy/samples/，那份已經去識別化。

/** 沒有第 11、12 列的表：TODO 區塊直接接在第 10 列後面，落在第 13 列。 */
const SHORT_SHEET = [
  '客戶名稱,購買名稱,療程內容,應有次數,實際次數,8/1,8/11',
  '客戶B,0522 顧客會-8,Inbody,4,0,FALSE,FALSE',
  ',,復健門診,2,0,FALSE,FALSE',
  ',,物理諮詢,4,0,FALSE,FALSE',
  ',,營養諮詢,4,0,FALSE,FALSE',
  ',,體適能分析,4,0,FALSE,FALSE',
  ',,復能(1小時),20,1,TRUE,FALSE',
  ',,ILIB 60mins,12,0,FALSE,FALSE',
  ',,x萬健檢,0,0,FALSE,FALSE',
  ',,EECP,0,0,FALSE,FALSE',
  ',,,,,,',
  ',,,,,,',
  'TODO,,,,,,,,,,FINISH',
  '8/1復能(1小時),Abovee,FALSE,打電話,FALSE',
].join('\n');

const shortPlan = () => planForSheet(parseSheet(SHORT_SHEET, { sheetName: '客戶B' }), CTX);

test('TODO 區塊落在第 13 列時不會被當成二返註記寫進備註', () => {
  // 21 張真表裡有 14 張是這樣。備註欄長出「TODO FINISH」六個字，
  // 而那不是她寫的任何東西。
  assert.equal(shortPlan().customer.notes.includes('TODO'), false);
  assert.equal(shortPlan().customer.notes.includes('FINISH'), false);
});

test('TODO 區塊裡的任務列不會被當成療程列', () => {
  const labels = shortPlan().entitlements.map((e) => e.doc.label);
  assert.equal(labels.some((l) => l.includes('Abovee')), false);
  assert.deepEqual(labels,
    ['Inbody', '復健門診', '物理諮詢', '營養諮詢', '體適能分析', '復能(1小時)', 'ILIB 60mins']);
});

test('健檢後面再接項目也對得到課程，名稱照樣原文照抄', () => {
  // 真表寫的是 `5萬健檢(心臟)`、`5萬健檢(腸道)` —— 「健檢」不在結尾，
  // 用 endsWith 判斷會把整列丟掉，那位客戶的健檢就不見了。
  const sheet = SHEET.replace('0.75萬健檢,1,0', '5萬健檢(心臟),1,0');
  const p = planForSheet(parseSheet(sheet, { sheetName: '客戶C' }), CTX);
  const found = p.entitlements.find((e) => e.doc.label === '5萬健檢(心臟)');
  assert.ok(found, '5萬健檢(心臟) 應該要建出額度');
  assert.equal(found.doc.courseId, 'course-checkup');
  assert.equal(p.problems.some((x) => x.why.includes('對不到任何課程')), false);
});

test('營養點滴後面再接項目也對得到課程', () => {
  const sheet = SHEET.replace(',護肝排毒x11+雪顏亮彩x22,營養點滴,33,1', ',,營養點滴（腸道）,0,1');
  const p = planForSheet(parseSheet(sheet, { sheetName: '客戶D' }), CTX);
  const found = p.entitlements.find((e) => e.doc.label === '營養點滴（腸道）');
  assert.ok(found, '營養點滴（腸道） 應該要建出額度');
  assert.equal(found.doc.courseId, 'course-iv-drip');
});

test('營養點滴的 D 欄是 0 時退回勾選數，不是整列丟掉', () => {
  // 真表上「營養點滴（腸道）」就是 D 欄留 0、日期欄勾了五格。
  const sheet = SHEET.replace(',護肝排毒x11+雪顏亮彩x22,營養點滴,33,1', ',,營養點滴,0,1');
  const p = planForSheet(parseSheet(sheet, { sheetName: '客戶D' }), CTX);
  const found = p.entitlements.find((e) => e.doc.label === '營養點滴');
  assert.equal(found.doc.totalQty, 1);
  assert.ok(p.problems.some((x) => x.why.includes('D 欄沒有次數')));
});

test('第 11 列拿來放別的加購時照對照表對課程', () => {
  const sheet = SHEET.replace(',護肝排毒x11+雪顏亮彩x22,營養點滴,33,1', ',,心臟門診,2,1');
  const p = planForSheet(parseSheet(sheet, { sheetName: '客戶E' }), CTX);
  const found = p.entitlements.find((e) => e.doc.label === '心臟門診');
  assert.ok(found, '心臟門診 應該對到主檔的「心臟科評估」');
  assert.equal(found.doc.courseId, 'course-cardio');
});

test('同一天有兩個日期欄時合併成一筆來訪，並在報告上講一聲', () => {
  // 格子不夠寫就再開一欄，這在真表上有兩位。一欄一筆會讓那天長出兩筆來訪，
  // 而那等於說她那天來了兩趟 —— 舊表沒說過這件事。
  const sheet = [
    '客戶名稱,購買名稱,療程內容,應有次數,實際次數,8/1,8/1',
    '客戶F,0522 顧客會-8,Inbody,4,0,FALSE,FALSE',
    ',,復健門診,2,0,FALSE,FALSE',
    ',,物理諮詢,4,0,FALSE,FALSE',
    ',,營養諮詢,4,0,FALSE,FALSE',
    ',,體適能分析,4,0,FALSE,FALSE',
    ',,復能(1小時),20,2,TRUE,TRUE',
    ',,ILIB 60mins,12,1,TRUE,FALSE',
  ].join('\n');
  const p = planForSheet(parseSheet(sheet, { sheetName: '客戶F' }), CTX);

  assert.equal(p.visits.length, 1);
  assert.equal(p.visits[0].date, '2026-08-01');
  assert.equal(p.visits[0].slots.length, 3, '復能兩次 + ILIB 一次');
  assert.ok(p.problems.some((x) => x.why.includes('合併成一筆來訪')));
});

test('姓名格裡的編號與括號註記另外解析進備註，但名字原文不動', () => {
  // 真表的 A2 是「名字3157」或「名字\n(高能/sis)3157」——
  // 拆錯名字比留著多餘的字嚴重，所以名字照抄，多的另外記一份。
  const sheet = SHEET.replace('客戶A,0522', '客戶A (高能/sis)3157,0522');
  const p = planForSheet(parseSheet(sheet, { sheetName: '客戶G' }), CTX);

  assert.equal(p.customer.name, '客戶A (高能/sis)3157');
  assert.ok(p.customer.notes.includes('病歷號 3157'));
  assert.ok(p.customer.notes.includes('姓名欄的註記：高能/sis'));
});

test('營養品的勾選不會在每一個日期再報一次「沒有建出額度」', () => {
  const sheet = SHEET.replace(
    ',夜態美+速膳淨,營養品(12000),1,0,FALSE,FALSE,FALSE',
    ',夜態美+速膳淨,營養品(12000),1,0,TRUE,TRUE,TRUE',
  );
  const p = planForSheet(parseSheet(sheet, { sheetName: '客戶H' }), CTX);
  assert.equal(p.problems.filter((x) => x.why.includes('沒有建出額度')).length, 0);
  assert.equal(p.problems.filter((x) => x.why.includes('營養品不排班')).length, 1);
});

// ---------- 手寫註記與對帳 ----------
//
// 使用者實測時抓到的兩件事（.scratch/legacy-import/issues/03）：
// A11 的「目前只要SIS」這類手寫註記整格被丟掉，而且**丟掉了也看不出來** ——
// 要確認一張表讀得對不對，只能回試算表一格一格核對，二十幾位客戶沒有人做得到。

/** 手寫註記散在 A11、B14、A15，全部不在匯入器認得的欄位上。 */
const NOTE_SHEET = [
  '客戶名稱,購買名稱,療程內容,應有次數,實際次數,8/1,8/11',
  '客戶N,0522 顧客會-8,Inbody,4,0,FALSE,FALSE',
  ',,復健門診,2,0,FALSE,FALSE',
  ',,物理諮詢,4,0,FALSE,FALSE',
  ',,營養諮詢,4,0,FALSE,FALSE',
  ',,體適能分析,4,0,FALSE,FALSE',
  ',,復能(1小時),20,1,TRUE,FALSE',
  ',,ILIB 60mins,12,0,FALSE,FALSE',
  ',,x萬健檢,0,0,FALSE,FALSE',
  ',,EECP,0,0,FALSE,FALSE',
  '目前只要SIS,,,,,,',
  ',,,,,FALSE,FALSE',
  ',,,,,,7/17 二返(夏)',
  ',寄紙本報告,,,,,',
  '和妻同一天賦能,,,,,,',
  'TODO,,,,,,,,,,FINISH',
  '8/1復能(1小時),Abovee,FALSE,打電話,FALSE',
].join('\n');

const notePlan = () => planForSheet(parseSheet(NOTE_SHEET, { sheetName: '客戶N' }), CTX);

test('沒有欄位可放的手寫註記原文收進備註，一個字都不改寫', () => {
  const notes = notePlan().customer.notes;
  assert.ok(notes.includes('目前只要SIS'), 'A11 的器材偏好');
  assert.ok(notes.includes('寄紙本報告'), 'B14 的待辦');
  assert.ok(notes.includes('和妻同一天賦能'), 'A15 的排班習慣');
});

test('看起來像限制或喜好的註記不自動寫進任何欄位', () => {
  // 「只要SIS」是器材偏好，但「五不行」到底是禮拜五還是五號，app 看不出來，
  // 那是她的判斷（ADR-0002）。所以原文留著，不代填。
  const p = notePlan();
  assert.deepEqual(p.customer.flags, [], '永久限制不可以自動填');
  assert.ok(p.customer.notes.includes('目前只要SIS'), '原文一定要留著');
});

test('排在日期欄外面的空勾選框與 TODO 區塊不算手寫註記', () => {
  const cells = notePlan().leftovers.map((x) => x.cell);
  assert.deepEqual(cells, ['A11', 'B14', 'A15']);
});

// ---------- 醫療禁忌與沒填完的健檢等級 ----------
//
// 舊表沒有「永久限制」這個欄位，那句話寫在購買名稱裡。匯進來之後 flags 是空的，
// 而醫療禁忌的阻擋是拿 flags 去比對的（domain/contraindications.js）——
// 沒有設定，超磁場與高能量雷射就不會被擋下來，而那是唯一會造成實際傷害的一條。
//
// 注意：`docs/legacy/samples/` 測不到這一段，那些樣本裡的禁忌字眼已經被
// 去識別化抹掉了。所以這裡的 fixture 才是這條路唯一的守門員。

const METAL_SHEET = SHEET.replace(
  '客戶A,0522 顧客會-8',
  '客戶A,0604 顧客會-手有金屬，只能INDIBA',
);
const metalPlan = () => planForSheet(parseSheet(METAL_SHEET, { sheetName: '客戶M' }), CTX);

test('購買名稱裡的醫療禁忌字眼會被認出來，並說得出沒設定會漏擋哪幾台', () => {
  const hit = metalPlan().contraindications;
  assert.equal(hit.length, 1);
  assert.equal(hit[0].where, 'B2 購買名稱');
  assert.equal(hit[0].term, '體內金屬');
  assert.deepEqual(hit[0].blocks.sort(), ['超磁場', '高能量雷射']);
});

test('要找的字從主檔的器材推出來，不寫死在匯入器裡', () => {
  // 她之後新增一台有別的禁忌的器材，這裡要自動就會找那個字。
  const equipment = [
    ...SEED.equipment,
    { id: 'eq-x', name: '震波', contraindications: ['懷孕'] },
  ];
  const sheet = SHEET.replace('客戶A,0522 顧客會-8', '客戶A,0522 顧客會-懷孕中先不要排');
  const p = planForSheet(parseSheet(sheet, { sheetName: '客戶P' }), { ...CTX, equipment });

  assert.equal(p.contraindications.length, 1);
  assert.equal(p.contraindications[0].term, '懷孕');
  assert.deepEqual(p.contraindications[0].blocks, ['震波']);
});

test('認出禁忌字眼也不會自動設定永久限制', () => {
  // 「手有金屬」是禁忌，「金屬已取出」不是，兩句話都含有「金屬」。
  // 那是她的判斷，不是匯入器的（ADR-0002）。
  assert.deepEqual(metalPlan().customer.flags, []);
});

test('金額等級還沒填的健檢照樣建額度，但要講一聲', () => {
  // `x萬健檢` 的 x 是還沒決定的等級，不是打錯字。不講的話她會在客戶詳情頁
  // 看到一筆叫「x萬健檢」的額度，那看起來像系統壞掉。
  const sheet = SHEET.replace('0.75萬健檢,1,0', 'x萬健檢,1,0');
  const p = planForSheet(parseSheet(sheet, { sheetName: '客戶Q' }), CTX);

  assert.ok(p.entitlements.some((e) => e.doc.label === 'x萬健檢'), '額度照建，名稱原文照抄');
  assert.ok(p.problems.some((x) => x.why.includes('健檢的金額等級還沒填')));
});

test('金額填好的健檢不會被當成沒填', () => {
  assert.equal(
    plan().problems.some((x) => x.why.includes('金額等級還沒填')),
    false,
  );
});

// ---------- planForSheet() 的 done 現在由誰負責（.scratch/first-real-import/issues/07） ----------

test('這一支一律吐已完成，而狀態是在匯入的那一刻才決定的', () => {
  // 這一條原本綁的是「貼舊試算表」那一頁的兩句文案。**那條路 2026-08-23 拿掉了**，
  // 所以 `planForSheet()` 現在只剩一個消費者：`.claude/skills/calendar-sheet-merge`
  // 的 `merge.mjs`，它把結果寫進合併檔的 `customers[].visits`。
  //
  // 於是這裡寫死 `done` 從「一個等著出事的假設」變成「對的分工」：
  // 產檔那側不知道她哪一天會貼，狀態一律由 `domain/mergeImport.js` 的
  // `statusFor()` 在匯入當下依日期重判（ADR-0029）。**這條測試盯的就是那個分工** ——
  // 哪天這裡開始吐 `confirmed`，就表示有人在產檔那側猜「未來」，而那個猜測會過期。
  const future = SHEET
    .replace('8/1,8/11,8/18', '8/1,8/11,12/31')
    .replace(/,FALSE$/gm, ',TRUE');
  const p = planForSheet(parseSheet(future, { sheetName: '客戶A' }), CTX);

  assert.ok(p.visits.length >= 2, 'fixture 要真的產出好幾天的來訪');
  assert.ok(
    p.visits.some((v) => v.date > '2026-08-21'),
    'fixture 要包含一筆日期在未來的來訪，否則這條測試什麼都沒驗到',
  );
  assert.deepEqual(
    [...new Set(p.visits.map((v) => v.status))],
    ['done'],
    '這一支一律 done，日期在未來的那幾筆由 mergeImport 的 statusFor() 改成 confirmed',
  );

  // 而那個「改成 confirmed」真的會發生 —— 不然上面那條斷言只是在描述一個 bug。
  assert.equal(statusFor('done', '2026-12-31', '2026-08-23'), 'confirmed');
  assert.equal(statusFor('done', '2026-08-11', '2026-08-23'), 'done');
});
