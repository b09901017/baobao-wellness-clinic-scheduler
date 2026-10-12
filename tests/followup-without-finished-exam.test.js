// 二返沒接到健檢：那一句提醒要講清楚（verified-bugs-2026-10-07/issues/01；ADR-0145 之後排著的健檢也接得上）。
//
// 她 2026-10-07：
//
// > 我想選(A) 排定二返時：在日曆／壓表存檔時，若沒有連結到已完成的健檢就觸發。+僅提醒，仍可繼續操作
//
// 決定不動：沒接到健檢只提醒、不擋（舊資料沒有那個連結，ADR-0011 的原則）。以前那一句一律是
// 「還沒指定是哪一次健檢的」—— 同一天排健檢＋二返時那一排一顆都按不下去，她會以為是自己漏按，
// 也看不出之後簽療程單照樣會扣一次二返。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validateVisit, visitStatusFrom } from '../public/js/domain/visits.js';

const COURSES = [
  { id: 'c-exam', name: '健檢', assigns: 'none', doctorPick: 'none', followupCourseId: 'c-fu' },
  { id: 'c-fu', name: '二返', assigns: 'none', doctorPick: 'none' },
];
const ENTS = [
  { id: 'e-exam', type: 'single', label: '健檢', courseId: 'c-exam', totalQty: 4 },
  { id: 'e-fu', type: 'single', label: '二返', courseId: 'c-fu', totalQty: 4, followupForEntitlementId: 'e-exam' },
];

const examSlot = (status, o = {}) => ({
  entitlementId: 'e-exam', courseId: 'c-exam', courseName: '健檢', startsAt: '09:00', endsAt: '10:00', status, ...o,
});
const fuSlot = (o = {}) => ({
  entitlementId: 'e-fu', courseId: 'c-fu', courseName: '二返', startsAt: '11:00', endsAt: '11:30',
  status: 'pending_confirm', followupForVisitId: null, ...o,
});

const visitOf = (id, date, slots) => {
  const v = { id, customerId: 'c1', customerName: '客戶A', date, slots };
  return { ...v, status: visitStatusFrom(v) };
};

const ask = (visit, customerVisits = [], o = {}) => validateVisit(visit, {
  customer: { id: 'c1', flags: [] }, entitlements: ENTS, courses: COURSES, equipment: [],
  rooms: [], staff: [], ivProducts: [], customerVisits, sameDayVisits: [], ...o,
});

const about = (warnings) => warnings.filter((w) => w.includes('健檢'));

describe('二返沒接到健檢時，那一句講得出為什麼', () => {
  test('有做完的健檢可以選、她沒選：照舊那一句', () => {
    const done = visitOf('v-exam', '2026-09-20', [examSlot('done')]);
    const { errors, warnings } = ask(visitOf(null, '2026-10-07', [fuSlot()]), [done]);
    assert.deepEqual(errors, []);
    assert.deepEqual(about(warnings), ['第 1 個時段：二返 還沒指定是哪一次健檢的']);
  });

  // 2026-10-09 起排著的健檢也接得上（ADR-0145）：同一筆裡剛加、還沒存的那一段才選不到
  test('同一天排健檢＋二返（還沒存）：講出要先存好健檢、之後照樣會扣', () => {
    const draft = visitOf(null, '2026-10-07', [examSlot('pending_confirm'), fuSlot()]);
    const { errors, warnings } = ask(draft, []);
    assert.deepEqual(errors, [], '只提醒不擋');
    const [said, ...rest] = about(warnings);
    assert.deepEqual(rest, [], warnings.join('｜'));
    assert.match(said, /^第 2 個時段：二返 還沒接到健檢 —— 這一天的健檢存好之後才接得上/);
    assert.match(said, /照樣會扣一次二返/);
  });

  test('健檢排在別天、還沒做：接得上了，所以是「還沒指定」', () => {
    const booked = visitOf('v-exam', '2026-10-01', [examSlot('confirmed')]);
    const [said] = about(ask(visitOf(null, '2026-10-07', [fuSlot()]), [booked]).warnings);
    assert.equal(said, '第 1 個時段：二返 還沒指定是哪一次健檢的');
  });

  test('一次健檢都沒有', () => {
    const [said] = about(ask(visitOf(null, '2026-10-07', [fuSlot()]), []).warnings);
    assert.match(said, /還沒接到健檢 —— 這位客戶還沒有約過健檢/);
    assert.match(said, /照樣會扣一次二返/);
  });

  test('健檢只有取消的、沒來的', () => {
    const gone = [
      visitOf('v1', '2026-09-01', [examSlot('cancelled')]),
      visitOf('v2', '2026-09-08', [examSlot('no_show')]),
    ];
    const [said] = about(ask(visitOf(null, '2026-10-07', [fuSlot()]), gone).warnings);
    assert.match(said, /約過的健檢都取消或沒來/);
  });

  test('接得上的那一次已經約了別場二返', () => {
    const done = visitOf('v-exam', '2026-09-20', [examSlot('done')]);
    const other = visitOf('v-fu', '2026-09-27', [fuSlot({ status: 'confirmed', followupForVisitId: 'v-exam' })]);
    const [said] = about(ask(visitOf(null, '2026-10-07', [fuSlot()]), [done, other]).warnings);
    assert.match(said, /接得上的健檢都已經約了二返/);
  });

  test('接好了就不講', () => {
    const done = visitOf('v-exam', '2026-09-20', [examSlot('done')]);
    const draft = visitOf(null, '2026-10-07', [fuSlot({ followupForVisitId: 'v-exam' })]);
    const { errors, warnings } = ask(draft, [done]);
    assert.deepEqual(errors, []);
    assert.deepEqual(about(warnings), []);
  });
});

describe('舊資料照樣存得下去（ADR-0011 的原則）', () => {
  test('存著的那一段二返本來就沒有連結，她只改時間：沒有 error', () => {
    const stored = visitOf('v-old', '2026-10-07', [fuSlot({ status: 'confirmed' })]);
    const edited = { ...stored, slots: [{ ...stored.slots[0], startsAt: '15:00', endsAt: '15:30' }] };
    const { errors, warnings } = ask(edited, [stored]);
    assert.deepEqual(errors, []);
    assert.equal(about(warnings).length, 1);
  });

  // 審查指出的（ADR-0070）：後果那半句是未來式，結掉的段不可以講
  test('已完成的舊二返沒有連結：講得出沒接到，但不講「簽療程單時照樣會扣」', () => {
    const stored = visitOf('v-old', '2026-09-01', [fuSlot({ status: 'done' })]);
    const { errors, warnings } = ask(stored, [stored]);
    assert.deepEqual(errors, []);
    const [said] = about(warnings);
    assert.match(said, /還沒接到健檢/);
    assert.doesNotMatch(said, /照樣會扣/);
  });

  test('配對的那一筆健檢額度查不到：不猜原因，退回原本那一句', () => {
    const ents = [ENTS[1]];
    const [said] = about(ask(visitOf(null, '2026-10-07', [fuSlot()]), [], { entitlements: ents }).warnings);
    assert.equal(said, '第 1 個時段：二返 還沒指定是哪一次健檢的');
  });

  test('取消掉的那一段二返不講（它不會發生）', () => {
    const v = visitOf('v-x', '2026-10-07', [fuSlot({ status: 'cancelled' }), examSlot('confirmed')]);
    assert.deepEqual(about(ask(v, [v]).warnings), []);
  });
});
