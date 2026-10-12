// 另約一次健檢時，多一顆「順便把那一場二返接到這一次」（.scratch/followup-link-before-exam/issues/13，ADR-0146）。
//
// 她 2026-10-12：
//
// > 另約健檢時，如果剛好只有一場二返還接在被取消的那一次上，確認框多一顆「順便把那一場接到這一次」。
// > 你按了才改，仍然不是自動搬
//
// ADR-0145「不自動搬連結」照舊：系統不知道這一次是不是那一次改期來的。多的是她按了才改的一顆，只動那一格。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { relinkOffer, relinkSlot, strandedFollowups, owed } from '../public/js/domain/followups.js';
import { validateVisit, visitStatusFrom } from '../public/js/domain/visits.js';
import { bookingConsequences, aboveeConsequences, relinkedSay, notRelinkedSay } from '../public/js/domain/consequences.js';
import { nthSlotFields } from '../public/js/domain/nthFollowup.js';

const COURSES = [
  { id: 'c-exam', name: '健檢', assigns: 'none', doctorPick: 'none', followupCourseId: 'c-fu' },
  { id: 'c-fu', name: '二返', assigns: 'none', doctorPick: 'none' },
  { id: 'c-exam2', name: '心臟健檢', assigns: 'none', doctorPick: 'none', followupCourseId: 'c-fu' },
  { id: 'c-sis', name: '復能', assigns: 'none', doctorPick: 'none' },
];
const coursesById = Object.fromEntries(COURSES.map((c) => [c.id, c]));
const ENTS = [
  { id: 'e-exam', type: 'single', label: '健檢', courseId: 'c-exam', totalQty: 3 },
  { id: 'e-fu', type: 'single', label: '二返', courseId: 'c-fu', totalQty: 3, followupForEntitlementId: 'e-exam' },
  { id: 'e-exam2', type: 'single', label: '心臟健檢', courseId: 'c-exam2', totalQty: 1 },
  { id: 'e-fu2', type: 'single', label: '二返（心臟健檢）', courseId: 'c-fu', totalQty: 1, followupForEntitlementId: 'e-exam2' },
  { id: 'e-sis', type: 'single', label: 'SIS', courseId: 'c-sis', totalQty: 10 },
];
const pair = { source: ENTS[0], followup: ENTS[1] };

const visitOf = (id, date, slots) => {
  const v = { id, customerId: 'c1', customerName: '客戶A', date, slots };
  return { ...v, status: visitStatusFrom(v) };
};
const examSlot = (status, o = {}) => ({
  entitlementId: 'e-exam', courseId: 'c-exam', courseName: '健檢', startsAt: '09:00', endsAt: '10:00', status, ...o,
});
const fuSlot = (status, to, o = {}) => ({
  entitlementId: 'e-fu', courseId: 'c-fu', courseName: '二返', startsAt: '11:00', endsAt: '11:30', status, followupForVisitId: to, ...o,
});
const exam = (id, date, status, o) => visitOf(id, date, [examSlot(status, o)]);
const second = (id, date, status, to, o) => visitOf(id, date, [fuSlot(status, to, o)]);
/** 還沒存的那一筆（沒有 id）：這一次要記的新健檢 */
const draft = (date, slots = [examSlot('pending_confirm')]) => ({ ...visitOf(null, date, slots), id: undefined });
const offerOf = (visit, customerVisits, o = {}) => relinkOffer({ visit, entitlements: ENTS, coursesById, customerVisits, ...o });

const gone = exam('B', '2026-10-01', 'cancelled');
const fuB = second('F', '2026-10-24', 'confirmed', 'B');

describe('什麼時候有那一顆：剛好一場還開著的二返、接在接不上的健檢上、配的就是這一段健檢', () => {
  test('健檢取消、另約一天：有，講得出是哪一場、原本接在哪一次', () => {
    const out = offerOf(draft('2026-10-10'), [gone, fuB]);
    assert.deepEqual(out, {
      visitId: 'F', slotIndex: 0, date: '2026-10-24', entitlementId: 'e-fu',
      fromVisitId: 'B', fromDate: '2026-10-01', fromStatus: 'cancelled', ahead: false,
    });
  });

  test('健檢未到也算（那一次不會有報告）；二返待確認也算', () => {
    const noShow = exam('B', '2026-10-01', 'no_show');
    const out = offerOf(draft('2026-10-10'), [noShow, second('F', '2026-10-24', 'pending_confirm', 'B')]);
    assert.equal(out?.fromStatus, 'no_show');
    assert.equal(out?.visitId, 'F');
  });

  test('併進那一天既有的來訪（有 id）：照樣有，認得出新加的是哪一段', () => {
    const day = visitOf('D', '2026-10-10', [
      { entitlementId: 'e-sis', courseId: 'c-sis', courseName: '復能', startsAt: '14:00', endsAt: '15:00', status: 'confirmed' },
      examSlot('pending_confirm'),
    ]);
    assert.equal(offerOf(day, [gone, fuB, visitOf('D', '2026-10-10', [day.slots[0]])], { added: [1] })?.visitId, 'F');
    // 這一次新加的不是健檢（健檢是那一天原本就有的）：不問
    assert.equal(offerOf(day, [gone, fuB], { added: [0] }), null);
  });

  test('這一次沒有新的健檢段：沒有', () => {
    const other = draft('2026-10-10', [{ entitlementId: 'e-sis', courseId: 'c-sis', courseName: '復能', startsAt: '09:00', endsAt: '10:00', status: 'pending_confirm' }]);
    assert.equal(offerOf(other, [gone, fuB]), null);
  });

  test('沒有接不上的二返（健檢還排著、或二返自己取消了）：沒有', () => {
    assert.equal(offerOf(draft('2026-10-10'), [exam('B', '2026-10-01', 'confirmed'), fuB]), null);
    assert.equal(offerOf(draft('2026-10-10'), [gone, second('F', '2026-10-24', 'cancelled', 'B')]), null);
  });

  test('兩場都接不上：不替她挑哪一場，沒有那一顆', () => {
    const gone2 = exam('B2', '2026-10-03', 'cancelled');
    const fuB2 = second('F2', '2026-10-28', 'confirmed', 'B2');
    assert.equal(strandedFollowups(ENTS, coursesById, [gone, fuB, gone2, fuB2]).length, 2);
    assert.equal(offerOf(draft('2026-10-10'), [gone, fuB, gone2, fuB2]), null);
  });

  test('接不上的是 n返：沒有（她說的是二返）；二返＋n返 各一場也沒有', () => {
    const third = visitOf('T', '2026-10-30', [{
      ...nthSlotFields({ nth: 3, examVisitId: 'B', courseId: 'c-fu' }), startsAt: '11:00', endsAt: '11:30', status: 'confirmed',
    }]);
    assert.equal(strandedFollowups(ENTS, coursesById, [gone, third]).length, 1);
    assert.equal(offerOf(draft('2026-10-10'), [gone, third]), null);
    assert.equal(offerOf(draft('2026-10-10'), [gone, fuB, third]), null);
  });

  test('那一場二返已經做完（鎖著）：沒有 —— 更正走日曆', () => {
    assert.equal(strandedFollowups(ENTS, coursesById, [gone, second('F', '2026-10-24', 'done', 'B')]).length, 1);
    assert.equal(offerOf(draft('2026-10-10'), [gone, second('F', '2026-10-24', 'done', 'B')]), null);
  });

  test('那一場二返配的是另一筆健檢額度：沒有（接過來存不下去）', () => {
    const goneHeart = visitOf('H', '2026-10-01', [examSlot('cancelled', { entitlementId: 'e-exam2', courseId: 'c-exam2', courseName: '心臟健檢' })]);
    const fuHeart = visitOf('FH', '2026-10-24', [fuSlot('confirmed', 'H', { entitlementId: 'e-fu2' })]);
    assert.equal(strandedFollowups(ENTS, coursesById, [goneHeart, fuHeart]).length, 1);
    assert.equal(offerOf(draft('2026-10-10'), [goneHeart, fuHeart]), null, '這一次約的是一般健檢');
    const heart = draft('2026-10-10', [examSlot('pending_confirm', { entitlementId: 'e-exam2', courseId: 'c-exam2', courseName: '心臟健檢' })]);
    assert.equal(offerOf(heart, [goneHeart, fuHeart])?.visitId, 'FH', '約的是心臟健檢就有');
  });

  test('那一場二返就在正要存的這一筆裡：沒有（同一筆裡的連結去日曆改）', () => {
    const stored = visitOf('D', '2026-10-10', [fuSlot('confirmed', 'B')]);
    const day = visitOf('D', '2026-10-10', [fuSlot('confirmed', 'B'), examSlot('pending_confirm')]);
    assert.equal(offerOf(day, [gone, stored], { added: [1] }), null);
  });

  test('接過來之後二返會排在這一次健檢之前：ahead（別天比日期、同一天比開始時間）', () => {
    assert.equal(offerOf(draft('2026-10-30'), [gone, fuB])?.ahead, true);
    assert.equal(offerOf(draft('2026-10-24', [examSlot('pending_confirm', { startsAt: '13:00', endsAt: '14:00' })]), [gone, fuB])?.ahead, true);
    assert.equal(offerOf(draft('2026-10-24'), [gone, fuB])?.ahead, false, '同一天、健檢 09:00 在二返 11:00 之前');
  });
});

describe('存檔前那一道：那一顆與它的字由 consequences.js 一起回', () => {
  const ask = (visit, customerVisits, o = {}) => bookingConsequences({ visit, coursesById, customerVisits, entitlements: ENTS, ...o });

  test('有那一顆：回 relink（哪一場、按鈕的字），那一句改講「下面那一顆」，去日曆改的路照樣講', () => {
    const said = ask(draft('2026-10-10'), [gone, fuB]);
    assert.equal(said.relink?.visitId, 'F');
    assert.equal(said.relink?.label, '記錄，順便把那一場二返接到這一次');
    const line = said.lines.find((l) => l.includes('還接在'));
    assert.match(line, /10\/24\(六\) 那一場二返還接在「已取消」的 10\/1\(四\) 健檢上/);
    assert.match(line, /按「順便把那一場二返接到這一次」/, '把那一顆的字講出來 —— 三顆直排，「下面那一顆」指不到是哪一顆');
    assert.ok(said.relink.label.includes('順便把那一場二返接到這一次'), '那一句引的就是那一顆上的字');
    assert.match(line, /去日曆點那一場二返改「這是哪一次健檢的」/);
  });

  test('沒有那一顆：relink 是 null，那一句一個字都沒變', () => {
    const gone2 = exam('B2', '2026-10-03', 'cancelled');
    const said = ask(draft('2026-10-10'), [gone, fuB, gone2, second('F2', '2026-10-28', 'confirmed', 'B2')]);
    assert.equal(said.relink, null);
    const lines = said.lines.filter((l) => l.includes('還接在'));
    assert.equal(lines.length, 2);
    assert.ok(lines.every((l) => l.endsWith('要接到這一次的話，存好之後去日曆點那一場二返改「這是哪一次健檢的」')), lines.join('｜'));
    assert.equal(ask(draft('2026-10-10'), []).relink, null);
  });

  test('接過來之後二返排在健檢之前：多一句講出來（那一場在健檢簽好之前簽不了）', () => {
    const said = ask(draft('2026-10-30'), [gone, fuB]);
    assert.ok(said.lines.some((l) => /接過來之後.*10\/24\(六\).*之前/.test(l)), said.lines.join('｜'));
    assert.ok(!ask(draft('2026-10-10'), [gone, fuB]).lines.some((l) => l.includes('接過來之後')));
  });

  test('拍 Abovee 那一道：不給那一顆，那一句照舊', () => {
    const fresh = draft('2026-10-10');
    const { lines } = aboveeConsequences({
      groups: [{ customerId: 'c1', customerName: '客戶A', date: '2026-10-10', visit: fresh, items: [{}], reopened: false }],
      coursesById, entitlementsBy: { c1: ENTS }, visitsBy: { c1: [gone, fuB] },
    });
    const line = lines.find((l) => l.includes('還接在'));
    assert.ok(line?.endsWith('要接到這一次的話，存好之後去日曆點那一場二返改「這是哪一次健檢的」'), line);
    assert.ok(!line.includes('順便'));
  });

  test('存完那兩句：接過來了／沒有接過來（那一場叫什麼照主檔上那門課的名字，不印快照）', () => {
    const { relink } = ask(draft('2026-10-10'), [gone, fuB]);
    assert.equal(relink.name, '二返');
    assert.equal(relinkedSay(relink, '2026-10-10'), '10/24(六) 那一場二返接到 10/10(六) 這一次健檢了');
    assert.match(notRelinkedSay(relink), /^健檢記好了；10\/24\(六\) 那一場二返沒有接過來/, '先講健檢那一半記好了');
    assert.match(notRelinkedSay(relink), /去日曆/);
    assert.match(notRelinkedSay(relink, ['指定的那一次健檢已經接了另一場']), /指定的那一次健檢已經接了另一場/);

    const renamed = { ...coursesById, 'c-fu': { ...coursesById['c-fu'], name: '回診聽報告' } };
    const said = bookingConsequences({ visit: draft('2026-10-10'), coursesById: renamed, customerVisits: [gone, fuB], entitlements: ENTS });
    assert.equal(said.relink.label, '記錄，順便把那一場回診聽報告接到這一次');
  });
});

describe('按了之後：只動那一格', () => {
  const saved = exam('N', '2026-10-10', 'pending_confirm');
  const offer = offerOf(draft('2026-10-10'), [gone, fuB]);

  test('那一段只有 followupForVisitId 變了，其餘每一格（連別段）一模一樣', () => {
    const two = visitOf('F', '2026-10-24', [
      fuSlot('confirmed', 'B', { doctorId: 'd1', note: '記一句', minutes: 30 }),
      { entitlementId: 'e-sis', courseId: 'c-sis', courseName: '復能', startsAt: '14:00', endsAt: '15:00', status: 'confirmed' },
    ]);
    const next = relinkSlot([gone, two, saved], offer, 'N');
    assert.equal(next.slots[0].followupForVisitId, 'N');
    assert.deepEqual({ ...next.slots[0], followupForVisitId: 'B' }, two.slots[0]);
    assert.deepEqual(next.slots[1], two.slots[1]);
    assert.deepEqual({ ...next, slots: two.slots }, two, '整筆的狀態、日期一個字都沒動');
    assert.equal(two.slots[0].followupForVisitId, 'B', '原本那一份沒有被改到');
  });

  test('接過來之後：存檔驗證過得去、不再是接不上的、那一場不算約掉別次的', () => {
    const next = relinkSlot([gone, fuB, saved], offer, 'N');
    const { errors } = validateVisit(next, {
      customer: { id: 'c1', flags: [] }, entitlements: ENTS, courses: COURSES, equipment: [], rooms: [], staff: [], ivProducts: [],
      customerVisits: [gone, fuB, saved], sameDayVisits: [],
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(strandedFollowups(ENTS, coursesById, [gone, next, saved]), []);
    assert.equal(owed(pair, [gone, next, saved]), owed(pair, [gone, fuB, saved]), '兩邊都是接在還沒做完的健檢上，還欠幾次不變');
  });

  test('那一場在這之間被改過：不動（回 null）', () => {
    assert.equal(relinkSlot([gone, saved], offer, 'N'), null, '那一筆不見了');
    assert.equal(relinkSlot([gone, second('F', '2026-10-24', 'confirmed', 'X'), saved], offer, 'N'), null, '她已經自己換了連結');
    assert.equal(relinkSlot([gone, second('F', '2026-10-24', 'cancelled', 'B'), saved], offer, 'N'), null, '取消了');
    assert.equal(relinkSlot([gone, second('F', '2026-10-24', 'done', 'B'), saved], offer, 'N'), null, '結案了');
    assert.equal(relinkSlot([gone, visitOf('F', '2026-10-24', [fuSlot('confirmed', 'B', { entitlementId: 'e-fu2' })]), saved], offer, 'N'), null, '換了額度');
    assert.equal(relinkSlot([gone, fuB, saved], offer, null), null, '沒有要接的那一筆（健檢沒存成）');
  });
});

describe('兩個入口都接上了；拍 Abovee 刻意沒有', () => {
  const read = (p) => readFileSync(new URL(`../public/js/${p}`, import.meta.url), 'utf8');

  test('壓表與日曆新增存完之後都叫同一支；兩頁都不自己判斷有沒有那一顆', () => {
    for (const file of ['ui/views/schedule.js', 'ui/views/visitEditor.js']) {
      const src = read(file);
      assert.match(src, /relinkAfterSave\(/, `${file} 沒有接上`);
      assert.match(src, /said\.relink/, `${file} 要讀 bookingConsequences() 回的那一格`);
      assert.doesNotMatch(src, /relinkOffer\(/, `${file} 不自己判斷（只寫在 domain）`);
    }
  });

  test('拍 Abovee 那一層沒有那一顆', () => {
    assert.doesNotMatch(read('ui/components/aboveeConfirm.js'), /relinkAfterSave|relinkOffer/);
  });
});
