// 2026-09-14 那一批舊表的新寫法（`.scratch/merge-answers-2026-09-14/issues/01`）。
//
// 例子是那份 xlsx 的**形狀**，名字與註記全部換掉了 —— 真實客戶姓名與健康資訊
// 一個字都不進版控（CLAUDE.md）。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePurchaseCell, parseSheet, planForSheet, rowShape, IV_SHORTHAND,
} from '../public/js/domain/legacyImport.js';
import { SEED } from '../public/js/domain/seed.js';
import { MAX_MARK_LENGTH } from '../public/js/domain/customerMarks.js';

const CTX = {
  courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts, plans: SEED.plans,
  clinicalFlags: SEED.clinicalFlags, partners: SEED.partners,
  existingCustomers: [], year: 2026, importedAt: '2026-09-15T00:00:00.000Z',
};
const p = (raw) => parsePurchaseCell(raw, 2026);

const LABELS = ['Inbody', '復健門診', '物理諮詢', '營養諮詢', '體適能分析', '復能(1小時)', 'ILIB 60mins'];

/**
 * 一張舊表，用 tab 分隔（手寫註記裡有逗號）。
 *
 * - `checks`：第 2–8 列的勾選，`{ 'ILIB 60mins': [true] }`
 * - `rows`：第 9 列開始 `{ a, detail, label, qty, cells }`，cells 對齊 dates（true = 勾、字串 = 那一格寫的字）
 * - `row13`／`row14`：日期欄底下那兩列；`extra13` 是最後一個日期欄右邊再一格
 */
function tsv({ b2 = '', d = [0, 0, 0, 0, 0, 0, 0], dates = ['8/1'], checks = {}, rows = [], row13 = [], row14 = [], extra13 = null }) {
  const cellsOf = (cells = []) => dates.map((_, i) => (cells[i] === true ? 'TRUE' : (cells[i] ?? 'FALSE')));
  const out = [['客戶名稱', '購買名稱', '療程內容', '應有次數', '實際次數', ...dates].join('\t')];
  LABELS.forEach((label, i) => out.push([i ? '' : '客戶A', i ? '' : b2, label, d[i], 0, ...cellsOf(checks[label])].join('\t')));
  for (const r of rows) out.push([r.a ?? '', r.detail ?? '', r.label ?? '', r.qty ?? '', r.label ? 0 : '', ...cellsOf(r.cells)].join('\t'));
  while (out.length < 12) out.push(['', '', '', '', '', ...dates.map(() => '')].join('\t'));
  out.push(['', '', '', '', '', ...dates.map((_, i) => row13[i] ?? ''), ...(extra13 ? [extra13] : [])].join('\t'));
  out.push(['', '', '', '', '', ...dates.map((_, i) => row14[i] ?? ''), 'x'].join('\t'));
  return out.join('\n');
}

const planOf = (opts) => planForSheet(parseSheet(tsv(opts), { sheetName: '客戶A' }), CTX);
const said = (plan) => (plan.purchaseProblems ?? []).join('\n');
const why = (plan) => plan.problems.map((x) => x.why).join('\n');
const ent = (plan, label) => plan.entitlements.find((e) => e.doc.label === label);
const idsOf = (...names) => names.map((n) => SEED.equipment.find((e) => e.name === n).id).sort();
const sorted = (ids) => [...(ids ?? [])].sort();
const texts = (plan) => plan.customer.marks.map((m) => m.text);

describe('B2 讀漏的兩種', () => {
  test('日期後面先一個破折號再接「新」', () => {
    const out = p('0824-新顧客會-8');
    assert.equal(out.date, '2026-08-24');
    assert.equal(out.channel, '顧客會');
    assert.deepEqual(out.plan, { newTemplate: true, sets: 1 });
    assert.equal(out.leftover, '', '不可以多出一則「新 -8」的備註');
  });

  test('健檢寫全（5萬健檢），括號裡的尾款照樣是 leftover', () => {
    const out = p('0909 新顧客會-8+8+5萬健檢（尾款欠20萬）');
    assert.deepEqual(out.plan, { newTemplate: true, sets: 2 });
    assert.deepEqual(out.exams, ['5萬']);
    assert.equal(out.leftover, '尾款欠20萬');
  });

  test('寫了「新」卻沒有方案數字不再每一批都問（她 9/13：那是打錯）', () => {
    const out = p('0820新 - 顧客會-only sis(60)x10');
    assert.equal(out.plan, null);
    assert.deepEqual(out.problems, []);
    assert.equal(out.newWithoutPlan, true, '留一個旗子，D 欄剛好是新範本時還是要講');
  });
});

describe('列名帶時長與形狀：rowShape()', () => {
  const cases = [
    ['SIS(60min)', { kind: 'pool', course: '復能', only: 'SIS', set: null, undecided: false, durationMin: 60 }],
    ['INDIBA(30)', { kind: 'pool', course: '復能', only: 'INDIBA', set: null, undecided: false, durationMin: 30 }],
    ['高能(60min)', { kind: 'pool', course: '復能', only: '高能量雷射', set: null, undecided: false, durationMin: 60 }],
    ['ILIB (60mins)', { kind: 'single', course: 'ILIB', only: null, set: null, undecided: false, durationMin: 60 }],
    ['ILIB 60mins', { kind: 'single', course: 'ILIB', only: null, set: null, undecided: false, durationMin: 60 }],
    ['ILIB 30', { kind: 'single', course: 'ILIB', only: null, set: null, undecided: false, durationMin: 30 }],
    ['復能(1小時)', { kind: 'pool', course: '復能', only: null, set: null, undecided: false, durationMin: 60 }],
    ['復能(30分）', { kind: 'pool', course: '復能', only: null, set: null, undecided: false, durationMin: 30 }],
    ['復能(30min)', { kind: 'pool', course: '復能', only: null, set: null, undecided: false, durationMin: 30 }],
    ['任選(30min)', { kind: 'pool', course: '復能', only: null, set: null, undecided: true, durationMin: 30 }],
    ['復能四選一(30)', { kind: 'pool', course: '復能', only: null, set: 'all', undecided: false, durationMin: 30 }],
    ['復能三選一(60)', { kind: 'pool', course: '復能', only: null, set: 'home', undecided: false, durationMin: 60 }],
  ];
  for (const [label, want] of cases) {
    test(label, () => assert.deepEqual(rowShape(label), want));
  }

  test('不是這幾種的列回 null（照舊走課程對照）', () => {
    for (const label of ['EECP', '5萬健檢(腸道)', '營養點滴', '心臟門診', 'Inbody']) {
      assert.equal(rowShape(label), null, label);
    }
  });
});

describe('新寫法進額度', () => {
  test('SIS(60min)：只有 SIS 一台的池，時長 60，勾選照樣變成時段', () => {
    const plan = planOf({ rows: [{ label: 'SIS(60min)', qty: 10, cells: [true] }] });
    const e = ent(plan, 'SIS(60min)');
    assert.equal(e.doc.type, 'pool');
    assert.deepEqual(sorted(e.doc.optionEquipmentIds), idsOf('SIS'));
    assert.equal(e.doc.durationMin, 60);
    assert.equal(plan.visits[0].slots[0].entitlementKey, e.key);
    assert.equal(plan.visits[0].slots[0].courseName, '復能');
    assert.doesNotMatch(why(plan), /對不到任何課程/);
  });

  test('ILIB 30：ILIB 那個課程，時長 30', () => {
    const plan = planOf({ rows: [{ label: 'ILIB 30', qty: 2 }] });
    const e = ent(plan, 'ILIB 30');
    assert.equal(e.doc.type, 'single');
    assert.equal(e.doc.courseId, SEED.courses.find((c) => c.name === 'ILIB').id);
    assert.equal(e.doc.durationMin, 30);
  });

  test('復能(30分）：三選一，時長 30，不必問', () => {
    const plan = planOf({ rows: [{ label: '復能(30分）', qty: 6 }] });
    const e = ent(plan, '復能(30分）');
    assert.deepEqual(sorted(e.doc.optionEquipmentIds), idsOf('INDIBA', 'SIS', '高能量雷射'));
    assert.equal(e.doc.durationMin, 30);
    assert.doesNotMatch(said(plan), /三選一還是四選一/);
  });

  test('任選(30min)：先照三選一，但要講一聲（還沒定）', () => {
    const plan = planOf({ rows: [{ label: '任選(30min)', qty: 15 }] });
    assert.deepEqual(sorted(ent(plan, '任選(30min)').doc.optionEquipmentIds), idsOf('INDIBA', 'SIS', '高能量雷射'));
    assert.match(said(plan), /三選一還是四選一/);
  });

  test('B2 字裡寫四選一、那一列只寫復能(30min)：照 B2 組成四台，而且不報假警報', () => {
    const plan = planOf({
      b2: '0821新 - 顧客會-8+復能四選一(30)x10堂', d: [4, 6, 4, 4, 4, 12, 20],
      rows: [{ label: '復能(30min)', qty: 10 }],
    });
    assert.deepEqual(sorted(ent(plan, '復能(30min)').doc.optionEquipmentIds), idsOf('INDIBA', 'SIS', '高能量雷射', 'ILIB'));
    assert.doesNotMatch(said(plan), /找不到/);
    assert.doesNotMatch(said(plan), /沒提到/);
  });

  test('營養針是營養點滴、營養素是營養品（9/7 回答過）', () => {
    const plan = planOf({ rows: [{ label: '營養針', qty: 4, cells: [true] }, { label: '營養素', qty: 1, cells: [true] }] });
    const drip = ent(plan, '營養針');
    assert.equal(drip.doc.courseId, SEED.courses.find((c) => c.name === '營養點滴').id);
    assert.equal(ent(plan, '營養素'), undefined, '營養品不建額度');
    assert.ok(texts(plan).some((t) => t.includes('營養素')), JSON.stringify(texts(plan)));
    assert.equal(plan.visits[0].slots.length, 1);
  });
});

describe('一個字的點滴品項', () => {
  test('雪、肝、腸', () => {
    assert.deepEqual({ ...IV_SHORTHAND }, { 雪: '雪顏亮彩', 肝: '護肝排毒', 腸: '腸道修復' });
  });

  test('第 14 列寫「肝」扣護肝排毒那一份', () => {
    const plan = planOf({ rows: [{ label: '營養點滴', detail: '護肝排毒x3+雪顏亮彩x3', qty: 6, cells: [true] }], row14: ['肝'] });
    assert.equal(plan.visits[0].slots[0].entitlementKey, 'r9:護肝排毒');
    assert.doesNotMatch(why(plan), /對不到任何一個品項/);
  });

  test('第 14 列空著、第 13 列寫了一個字：那是品項，不是二返註記', () => {
    const plan = planOf({
      dates: ['9/1', '9/10'], rows: [{ label: '營養針', qty: 2, cells: [true, true] }],
      row13: ['腸', '肝'], extra13: '腸',
    });
    const iv = (id) => SEED.ivProducts.find((x) => x.id === id)?.name;
    assert.deepEqual(plan.visits.map((v) => iv(v.slots[0].ivProductId)), ['腸道修復', '護肝排毒']);
    assert.ok(!texts(plan).some((t) => /腸|肝/.test(t)), JSON.stringify(texts(plan)));
    assert.match(why(plan), /沒有日期/, '多寫的那一格要講，不是安靜丟掉');
  });
});

describe('日期欄裡的字不會被安靜丟掉', () => {
  test('沒有療程名稱那一列的字進備註，前面加日期', () => {
    const plan = planOf({ dates: ['9/7'], rows: [{ label: 'EECP', qty: 0 }, { label: '', cells: ['欠30'] }] });
    assert.ok(texts(plan).includes('9/7 欠30'), JSON.stringify(texts(plan)));
  });

  test('第 14 列寫的不是品項（那天也沒有點滴）→ 進備註', () => {
    const plan = planOf({ dates: ['8/11'], rows: [{ label: 'EECP', qty: 1 }], row14: ['某某體驗'] });
    assert.ok(texts(plan).includes('8/11 某某體驗'), JSON.stringify(texts(plan)));
  });
});

describe('長備註照句子切（她 9/15：照句號、驚嘆號、分號）', () => {
  const noteAt11 = (text) => planOf({ rows: [{ label: 'EECP', qty: 0 }, { label: '' }, { a: text, label: '' }] });

  test('每一則都存得下，接起來還是原文', () => {
    const long = '先生很健談很健談很健談很健談很健談很健談。每次都要提早到很久很久很久很久很久很久！住得很遠很遠很遠很遠很遠很遠很遠很遠；年';
    const plan = noteAt11(long);
    const pieces = texts(plan).filter((t) => long.includes(t));
    assert.ok(pieces.length >= 3, JSON.stringify(pieces));
    assert.ok(pieces.every((t) => t.length <= MAX_MARK_LENGTH));
    assert.equal(pieces.join(''), long);
    assert.ok(!pieces.includes('年'), '太短的碎片接回前一則');
    assert.doesNotMatch(why(plan), /40/);
  });

  test('一整句沒有句號：照逗號裝箱', () => {
    const long = `${'甲'.repeat(15)}，${'乙'.repeat(15)}，${'丙'.repeat(15)}`;
    const pieces = texts(noteAt11(long)).filter((t) => long.includes(t));
    assert.ok(pieces.every((t) => t.length <= MAX_MARK_LENGTH), JSON.stringify(pieces));
    assert.equal(pieces.join(''), long);
  });
});

describe('警示與合作機構自動帶（她 9/7；否定句不算）', () => {
  const flagsOf = (a) => planOf({ rows: [{ label: 'EECP', qty: 0 }, { label: '' }, { a, label: '' }] }).customer;

  test('金屬類 → 體內金屬', () => {
    assert.deepEqual(flagsOf('膝蓋有金屬，只能某台').flags, ['體內金屬']);
    assert.deepEqual(flagsOf('左膝換過鈦合金關節').flags, ['體內金屬']);
  });

  test('否定句一個都不長', () => {
    for (const a of ['兩個人都無金屬', '沒有金屬', '確定無金屬，其他沒問題', '手術的金屬已取出', '鋼板拿掉了']) {
      assert.deepEqual(flagsOf(a).flags, [], a);
    }
  });

  test('寫在購買名稱裡也算', () => {
    const plan = planOf({ b2: '0604 顧客會-膝蓋有金屬，只能某台' });
    assert.deepEqual(plan.customer.flags, ['體內金屬']);
  });

  test('血管類 → 血管難打（寫在第 13 列也讀得到）', () => {
    const plan = planOf({ row13: ['血管細，很難上針'] });
    assert.deepEqual(plan.customer.flags, ['血管難打']);
  });

  test('合作機構名出現就帶', () => {
    assert.deepEqual(flagsOf('想跟自然美一起約').partners, ['自然美']);
  });

  test('什麼都沒寫就是空的', () => {
    const c = planOf({}).customer;
    assert.deepEqual(c.flags, []);
    assert.deepEqual(c.partners, []);
  });
});
