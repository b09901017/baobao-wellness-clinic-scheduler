// 合併檔 v9：舊表的備註分到該去的地方（2026-10-20，`.scratch/merge-v9-notes/`）。
//
// 她的原話：
//
// > 通常我試算表，A B 底下放的都是這個客戶的整體備註，然後F 之後的療程內容最底下的在往下一排都是當天的那個時段的備註，
// > 如果那一整排有日期單是沒勾最下面寫得像是她忘記，就是她取消的理由，請不要全部都放入這個客戶的備註之中，
// > 如果有你判斷是長備註，也可以幫我變成長備註
//
// v8 只帶得了客戶的短備註。v9 多四格（都選填）：段的 `note`、段的 `status`（只收已取消／未到）＋`cancelReason`、客戶的 `longNotes`。
// 名字一律假名。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { FORMAT, FORMATS, validateFile, planForCustomer } from '../public/js/domain/mergeImport.js';
import { SEED } from '../public/js/domain/seed.js';

const TODAY = '2026-10-20';
const CTX = {
  courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts,
  rooms: SEED.rooms, staff: SEED.staff, existingCustomers: [], today: TODAY,
};
const ILIB = { key: 'r8', type: 'single', label: 'ILIB 60mins', totalQty: 20, durationMin: 60, courseName: 'ILIB', optionEquipmentNames: [], productName: null };
const slot = (over = {}) => ({ entitlementKey: 'r8', courseName: 'ILIB', startsAt: '10:00', endsAt: '11:00', roomName: null, therapistName: null, equipmentName: null, ivProductName: null, confidence: 'high', evidence: null, ...over });
const entry = (over = {}) => ({ sheetName: '王小明', name: '王小明', notes: '', marks: [], entitlements: [ILIB], visits: [], ...over });
const file = (customers) => ({ format: FORMAT, calendar: { file: 'x', span: [], events: 0 }, customers, futureVisits: [], missingFromSheet: [], eventCandidates: [] });
const errorsOf = (c) => validateFile(file([c])).errors;

describe('契約：baobao-merge/v9', () => {
  test('一律寫 v9；v1～v8 照收', () => {
    assert.equal(FORMAT, 'baobao-merge/v9');
    for (const v of [1, 2, 3, 4, 5, 6, 7, 8, 9]) assert.ok(FORMATS.includes(`baobao-merge/v${v}`), `v${v}`);
  });
});

describe('段的「記一句」（issue 02）', () => {
  test('帶 note 的那一段寫進 slot.note（去頭尾空白），其他段 null', () => {
    const plan = planForCustomer(entry({
      visits: [{ date: '2026-10-16', status: 'done', slots: [slot({ note: '  遲到15分鐘 ' }), slot({ startsAt: '11:15', endsAt: '12:15' })] }],
    }), CTX);
    assert.deepEqual(plan.problems, []);
    assert.equal(plan.visits[0].slots[0].note, '遲到15分鐘');
    assert.equal(plan.visits[0].slots[1].note, null);
  });

  test('v8 那種沒有 note 的段：note 是 null（讀的那一側都先 ?? 空字串，跟沒有那一格一樣）', () => {
    const plan = planForCustomer(entry({ visits: [{ date: '2026-10-16', status: 'done', slots: [slot()] }] }), CTX);
    assert.equal(plan.visits[0].slots[0].note, null);
  });

  test('note 不是字串、或超過 200 字 → 整份拒收（不是安靜截掉）', () => {
    const bad = (note) => errorsOf(entry({ visits: [{ date: '2026-10-16', status: 'done', slots: [slot({ note })] }] }));
    assert.equal(bad('遲到').length, 0);
    assert.equal(bad(null).length, 0);
    assert.ok(bad(42).length);
    assert.ok(bad('字'.repeat(201)).length);
  });
});
