// 合併檔 v10：客戶可以帶 LINE 名字（2026-10-20 晚，`.scratch/merge-v10-line-names/`）。
//
// 她的原話：
//
// > 對了你可以順便幫我匯入line名稱嗎 ? 我整理好了一些人的了，大部分用三個字全名，少部分用兩個名子
//
// `customer.lineId` 存的是她 LINE 好友清單上看到的名字（ADR-0157），「打開 LINE 對話」照那個名字找人。
// 名字一律假名。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { FORMAT, FORMATS, validateFile, planForCustomer, summarize } from '../public/js/domain/mergeImport.js';
import { SEED } from '../public/js/domain/seed.js';
import { noteItems } from '../public/js/domain/customerNotes.js';

const CTX = {
  courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts,
  rooms: SEED.rooms, staff: SEED.staff, existingCustomers: [], today: '2026-10-20',
};
const entry = (over = {}) => ({ sheetName: '王小明', name: '王小明', notes: '', marks: [], entitlements: [], visits: [], ...over });
const file = (customers) => ({ format: FORMAT, calendar: { file: 'x', span: [], events: 0 }, customers, futureVisits: [], missingFromSheet: [], eventCandidates: [] });

describe('契約：baobao-merge/v10', () => {
  test('一律寫 v10；v1～v9 照收；認不得的版本整份拒收', () => {
    assert.equal(FORMAT, 'baobao-merge/v10');
    for (const v of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) assert.ok(FORMATS.includes(`baobao-merge/v${v}`), `v${v}`);
    assert.equal(validateFile({ format: 'baobao-merge/v11', customers: [] }).errors.length, 1);
  });
});

describe('客戶的 LINE 名字', () => {
  test('v9 那種沒有 lineId 的：每一位都是 null（跟以前一樣）', () => {
    assert.equal(planForCustomer(entry(), CTX).customer.lineId, null);
  });

  test('帶著的寫進 customer.lineId：去頭尾空白，空的是 null；兩個字的叫法照存（不換成全名）', () => {
    assert.equal(planForCustomer(entry({ lineId: '  小明  ' }), CTX).customer.lineId, '小明');
    assert.equal(planForCustomer(entry({ lineId: '王小明' }), CTX).customer.lineId, '王小明');
    assert.equal(planForCustomer(entry({ lineId: '   ' }), CTX).customer.lineId, null);
    assert.equal(planForCustomer(entry({ lineId: null }), CTX).customer.lineId, null);
  });

  test('不是字串整份拒收（不是安靜丟掉）', () => {
    for (const bad of [123, { name: '小明' }, ['小明'], true]) {
      const { errors } = validateFile(file([entry({ lineId: bad })]));
      assert.equal(errors.length, 1, JSON.stringify(bad));
      assert.match(errors[0], /LINE/);
    }
    for (const ok of ['小明', '', null, undefined]) {
      assert.deepEqual(validateFile(file([entry({ lineId: ok })])).errors, [], String(ok));
    }
  });

  test('摘要卡數得到幾位帶 LINE 名字；同名跳過的那一位不算', () => {
    const plans = [
      planForCustomer(entry({ lineId: '小明' }), CTX),
      planForCustomer(entry({ name: '李小華', sheetName: '李小華', lineId: '小華' }), CTX),
      planForCustomer(entry({ name: '張大同', sheetName: '張大同' }), CTX),
      planForCustomer(entry({ name: '陳小美', sheetName: '陳小美', lineId: '小美' }), { ...CTX, existingCustomers: [{ id: 'c1', name: '陳小美' }] }),
    ];
    assert.ok(plans[3].skip, '同名的那一位跳過');
    assert.equal(summarize(plans).lines, 2);
  });

  test('匯進來之後備註那一排：LINE 排在病歷號後面（ADR-0163）', () => {
    const { customer } = planForCustomer(entry({
      lineId: '小明', phone: '0912000111',
      marks: [{ text: '病歷號 1234', color: null }, { text: '喜歡靠窗', color: null }],
    }), CTX);
    assert.deepEqual(noteItems(customer).map((it) => it.kind), ['chartNo', 'line', 'mark', 'phone']);
  });
});
