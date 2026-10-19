// 病歷號是一格（`customer.chartNo`，ADR-0160；before-golive-2026-10-19 issue 04）。
//
// 她 10/19：「她一樣在備註阿，只是多了個icon」—— 畫面上它在備註那一段（一顆丸子、可以排順序），
// 資料上是一格，跟電話、LINE 一樣只在順序裡佔位置（`'chartNo'`）。舊的「病歷號 1234」短備註照樣認得，
// 由匯入與資料健檢搬進那一格。
//
// 判準：
// - 這一行會不會讓一位客人「有病歷號卻認不出來」？（新的一格、舊的短備註、兩個都有）
// - 這一行會不會讓搬家之後短備註往前錯一格？（中間那一則是病歷號時，後面每一則的顏色與先後都不變）

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { chartNosOf, identifyCustomer, chartNoInMark } from '../public/js/domain/identify.js';
import { noteItems, notesFields, chartNoMove } from '../public/js/domain/customerNotes.js';
import { readMarks } from '../public/js/domain/customerMarks.js';
import { runHealthCheck, CHECKS } from '../public/js/domain/health.js';
import { planForCustomer } from '../public/js/domain/mergeImport.js';
import { fieldLabel } from '../public/js/domain/audit.js';

const grey = (text) => ({ text, color: 'grey' });
const keys = (c) => noteItems(c).map((it) => it.key);

describe('認人：三種寫法都認得', () => {
  test('新的一格', () => {
    assert.deepEqual(chartNosOf({ chartNo: '1234' }), ['1234']);
    assert.deepEqual(chartNosOf({ chartNo: '00001234' }), ['1234']);
  });

  test('舊的短備註（兩種說法）照樣認', () => {
    assert.deepEqual(chartNosOf({ marks: [grey('病歷號 1234')] }), ['1234']);
    assert.deepEqual(chartNosOf({ marks: [grey('姓名欄的編號：4321')] }), ['4321']);
  });

  test('兩個都有：那一格排前面、一樣的不重複', () => {
    assert.deepEqual(chartNosOf({ chartNo: '1234', marks: [grey('病歷號 1234')] }), ['1234']);
    assert.deepEqual(chartNosOf({ chartNo: '1234', marks: [grey('病歷號 4321')] }), ['1234', '4321']);
  });

  test('空白的那一格不算', () => {
    assert.deepEqual(chartNosOf({ chartNo: '  ' }), []);
    assert.deepEqual(chartNosOf({ chartNo: null }), []);
  });

  test('identifyCustomer 認得那一格', () => {
    const c = { id: 'a', name: '王小明', chartNo: '1234' };
    const got = identifyCustomer({ name: '王小明', chartNo: '00001234' }, [c]);
    assert.equal(got.how, 'both');
    assert.equal(got.customer, c);
  });

  test('chartNoInMark：前綴後面的號碼，不是的回 null', () => {
    assert.equal(chartNoInMark('病歷號 1234'), '1234');
    assert.equal(chartNoInMark('姓名欄的編號：4321'), '4321');
    assert.equal(chartNoInMark('喜歡下午'), null);
    assert.equal(chartNoInMark('病歷號 '), null);
  });
});

describe('備註那一段：病歷號只佔位置', () => {
  test('沒排過：電話 → LINE → 病歷號 → 長備註 → 短備註', () => {
    const c = {
      phone: '0912', lineId: '小明', chartNo: '1234',
      longNotes: [{ id: 'n1', title: '過敏', body: '' }],
      marks: [grey('喜歡下午')],
    };
    assert.deepEqual(keys(c), ['phone', 'line', 'chartNo', 'long:n1', 'mark:0']);
    const it = noteItems(c).find((x) => x.kind === 'chartNo');
    assert.equal(it.text, '1234');
  });

  test('沒填不畫、不佔位', () => {
    assert.deepEqual(keys({ chartNo: '', marks: [grey('a')] }), ['mark:0']);
  });

  test('排過：照順序裡的 chartNo；順序裡沒有它就放最前面那一組（電話、LINE 之後）', () => {
    const c = { phone: '0912', chartNo: '1234', marks: [grey('a'), grey('b')], noteOrder: ['mark', 'chartNo', 'phone', 'mark'] };
    assert.deepEqual(keys(c), ['mark:0', 'chartNo', 'phone', 'mark:1']);
    const old = { phone: '0912', chartNo: '1234', marks: [grey('a')], noteOrder: ['mark', 'phone'] };
    assert.deepEqual(keys(old), ['chartNo', 'mark:0', 'phone']);
  });

  test('存回去：順序寫 chartNo、值不寫（值在編輯客戶的表單裡改）', () => {
    const c = { chartNo: '1234', marks: [grey('a')], noteOrder: ['mark', 'chartNo'] };
    const out = notesFields(noteItems(c));
    assert.deepEqual(out.noteOrder, ['mark', 'chartNo']);
    assert.equal('chartNo' in out, false);
  });
});

describe('搬家：短備註「病歷號 1234」→ 那一格', () => {
  test('沒排過：那一則拿掉、號碼進那一格、其餘短備註的顏色與先後不變、不寫順序', () => {
    const c = { marks: [grey('喜歡下午'), grey('病歷號 1234'), { text: '尾款', color: 'red' }] };
    const move = chartNoMove(c);
    assert.equal(move.blocked, undefined);
    assert.equal(move.changes.chartNo, '1234');
    assert.deepEqual(move.changes.marks, [grey('喜歡下午'), { text: '尾款', color: 'red' }]);
    assert.equal(move.changes.notes, '喜歡下午\n尾款');
    assert.equal('noteOrder' in move.changes, false);
    const after = { ...c, ...move.changes };
    assert.deepEqual(keys(after), ['chartNo', 'mark:0', 'mark:1']);
    assert.deepEqual(chartNosOf(after), ['1234']);
  });

  test('排過：病歷號那一格留在原本的位置，後面的短備註不往前錯', () => {
    const c = {
      phone: '0912',
      marks: [grey('a'), grey('病歷號 1234'), grey('b')],
      longNotes: [{ id: 'n1', title: 't', body: '' }],
      noteOrder: ['long:n1', 'mark', 'phone', 'mark', 'mark'],
    };
    const { changes } = chartNoMove(c);
    assert.deepEqual(changes.noteOrder, ['long:n1', 'mark', 'phone', 'chartNo', 'mark']);
    assert.deepEqual(changes.marks.map((m) => m.text), ['a', 'b']);
    const after = { ...c, ...changes };
    assert.deepEqual(noteItems(after).map((it) => it.kind === 'mark' ? it.mark.text : it.key),
      ['long:n1', 'a', 'phone', 'chartNo', 'b']);
  });

  test('舊的說法「姓名欄的編號：」也搬', () => {
    const { changes } = chartNoMove({ marks: [grey('姓名欄的編號：4321')] });
    assert.equal(changes.chartNo, '4321');
    assert.deepEqual(changes.marks, []);
  });

  test('同一個號碼寫了兩則：一起拿掉', () => {
    const { changes } = chartNoMove({ marks: [grey('病歷號 1234'), grey('姓名欄的編號：00001234')] });
    assert.equal(changes.chartNo, '1234');
    assert.deepEqual(changes.marks, []);
  });

  test('那一格已經是同一個號碼：只拿掉那一則，那一格留著她打的', () => {
    const { changes } = chartNoMove({ chartNo: '00001234', marks: [grey('病歷號 1234')] });
    assert.equal(changes.chartNo, '00001234');
    assert.deepEqual(changes.marks, []);
  });

  test('兩則不一樣、或那一格是另一個號碼：不搬（只列）', () => {
    assert.equal(chartNoMove({ marks: [grey('病歷號 1234'), grey('病歷號 4321')] }).blocked, true);
    assert.equal(chartNoMove({ chartNo: '4321', marks: [grey('病歷號 1234')] }).blocked, true);
  });

  test('前綴後面不是號碼（她自己打的一句話）：不搬', () => {
    assert.equal(chartNoMove({ marks: [grey('病歷號要再問')] }), null);
  });

  test('沒有那一則：null', () => {
    assert.equal(chartNoMove({ marks: [grey('a')] }), null);
    assert.equal(chartNoMove({ chartNo: '1234' }), null);
  });
});

describe('匯入時轉（合併檔照舊寫短備註）', () => {
  const base = {
    sheetName: '王小明', name: '王小明', marks: [grey('喜歡下午'), grey('病歷號 1234')],
    entitlements: [], visits: [],
  };
  test('建客戶時就在那一格、短備註裡沒有', () => {
    const plan = planForCustomer(base, { today: '2026-10-19' });
    assert.equal(plan.customer.chartNo, '1234');
    assert.deepEqual(readMarks(plan.customer).map((m) => m.text), ['喜歡下午']);
    assert.equal(plan.customer.notes, '喜歡下午');
  });
  test('沒有病歷號的那一位：那一格是 null', () => {
    const plan = planForCustomer({ ...base, marks: [grey('a')] }, { today: '2026-10-19' });
    assert.equal(plan.customer.chartNo, null);
  });
});

describe('資料健檢：病歷號還寫成一則短備註', () => {
  const run = (customers) => runHealthCheck({ customers, master: {} }, '2026-10-19');
  const check = (r, id) => r.checks.find((c) => c.id === id);

  test('接在 CHECKS 最後面', () => {
    assert.equal(CHECKS.at(-1).id, 'chartNoField');
  });

  test('一位一顆、改完的樣子就是 chartNoMove()', () => {
    const c = { id: 'a', name: '客戶A', marks: [grey('病歷號 1234'), grey('b')] };
    const f = check(run([c]), 'chartNoField').findings;
    assert.equal(f.length, 1);
    assert.equal(f[0].fix.kind, 'chartNoToField');
    assert.deepEqual(f[0].fix.changes, chartNoMove(c).changes);
    assert.equal(f[0].whoId, 'a');
  });

  test('兩則不一樣：只列不修', () => {
    const c = { id: 'a', name: '客戶A', marks: [grey('病歷號 1234'), grey('病歷號 4321')] };
    const f = check(run([c]), 'chartNoField').findings;
    assert.equal(f.length, 1);
    assert.equal(f[0].fix, null);
  });

  test('舊說法「姓名欄的編號：」：新的這一項收，舊的那一項跳過（不然同一批按會互相蓋）', () => {
    const c = { id: 'a', name: '客戶A', marks: [grey('姓名欄的編號：1234')] };
    const r = run([c]);
    assert.equal(check(r, 'chartNoField').findings.length, 1);
    assert.equal(check(r, 'chartNo').findings.length, 0);
  });

  test('搬不了的那一位，舊的那一項照舊改名', () => {
    const c = { id: 'a', name: '客戶A', marks: [grey('姓名欄的編號：1234'), grey('病歷號 4321')] };
    const r = run([c]);
    assert.equal(check(r, 'chartNoField').findings[0].fix, null);
    assert.equal(check(r, 'chartNo').findings.length, 1);
  });

  test('已經在那一格的：0 位', () => {
    assert.equal(check(run([{ id: 'a', name: '客戶A', chartNo: '1234', marks: [grey('b')] }]), 'chartNoField').findings.length, 0);
  });
});

test('稽核：chartNo 有中文名', () => {
  assert.equal(fieldLabel('chartNo'), '病歷號');
});
