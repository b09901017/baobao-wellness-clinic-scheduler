// 資料健檢。SPEC 第 6.6 節。
//
// 這一支盯的是兩件事：
// 1. 每一項檢查真的各自抓得到它該抓的東西，而且不會互相汙染
// 2. 只有次數對帳與「缺二返額度」給得出 fix，其餘一律 fix 為 null
//    （ADR-0007、ADR-0023）
//
// 檢查本身的算法不在這裡重測（那是 entitlements / taskRules / availability
// / visitTime 各自的測試），這裡測的是「有沒有正確地把它們接起來」。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { runHealthCheck, healthBadge, CHECKS, SEVERITIES } from '../public/js/domain/health.js';

const TODAY = '2026-09-15';

const MASTER = {
  courses: [
    { id: 'c-recovery', name: '復能', requiresEquipment: true },
    { id: 'c-checkup', name: '健檢', durationMin: 120, followupCourseId: 'c-followup' },
    { id: 'c-followup', name: '二返', durationMin: 30 },
  ],
  rooms: [{ id: 'r-3', name: '治3' }],
  staff: [{ id: 's-1', name: '治療師甲' }],
  equipment: [{ id: 'eq-indiba', name: 'INDIBA' }],
  ivProducts: [{ id: 'iv-1', name: '護肝排毒' }],
};

const customer = (over = {}) => ({ id: 'cus-1', name: '客戶一', active: true, ...over });

const ent = (over = {}) => ({
  id: 'e1', customerId: 'cus-1', type: 'pool', label: '復能', totalQty: 12,
  doneCount: 0, bookedCount: 0, ...over,
});

const slot = (over = {}) => ({
  entitlementId: 'e1', courseId: 'c-recovery', equipmentId: 'eq-indiba',
  therapistId: 's-1', startsAt: '10:30', endsAt: '11:30', ...over,
});

const visit = (over = {}) => ({
  id: 'v1', customerId: 'cus-1', customerName: '客戶一',
  date: '2026-09-10', status: 'done', slots: [slot()], ...over,
});

const task = (over = {}) => ({
  id: 't1', visitId: 'v1', customerId: 'cus-1', customerName: '客戶一',
  kind: 'Abovee', dueDate: '2026-09-09', done: true, ...over,
});

/** 只給要測的那部分，其餘補空 —— 每支測試才不用重複寫七個空陣列。 */
function snapshot(over = {}) {
  return {
    customers: [customer()],
    entitlements: [],
    visits: [],
    tasks: [],
    availability: [],
    master: MASTER,
    ...over,
  };
}

const run = (over) => runHealthCheck(snapshot(over), TODAY);
const findingsOf = (result, id) => result.checks.find((c) => c.id === id).findings;

describe('形狀', () => {
  test('十項檢查都在，順序固定', () => {
    const result = run();
    assert.equal(result.checks.length, 10);
    assert.deepEqual(result.checks.map((c) => c.id), CHECKS.map((c) => c.id));
  });

  test('乾淨的資料庫一項都不報', () => {
    const result = run({
      entitlements: [ent({ doneCount: 1, bookedCount: 0 })],
      visits: [visit()],
      tasks: [task()],
      availability: [{
        id: 'a1', customerId: 'cus-1', collectedAt: '2026-09-01',
        validFrom: '2026-09-01', validTo: '2026-09-30', rawText: '都可以', rules: [],
      }],
    });
    assert.equal(result.totals.findings, 0, JSON.stringify(result.checks, null, 2));
    assert.equal(healthBadge(result), null);
  });

  test('沒有資料也不會爆，也不會憑空報東西', () => {
    const empty = runHealthCheck({}, TODAY);
    assert.equal(empty.totals.findings, 0);
  });

  test('只有次數對帳與補二返額度給得出一鍵修正（ADR-0007、ADR-0023）', () => {
    // 故意做一份每一項都中的資料
    const result = run({
      customers: [customer(), customer({ id: 'cus-2', name: '客戶二' })],
      entitlements: [ent({ doneCount: 9 }), ent({ id: 'e2', customerId: 'cus-2', totalQty: 1 })],
      visits: [
        visit(),
        visit({ id: 'v2', date: '2026-09-01', status: 'confirmed' }),
        visit({ id: 'v3', date: '2026-09-10', slots: [slot({ courseId: 'gone' })] }),
        visit({ id: 'v4', customerId: 'cus-2', customerName: '客戶二', date: '2026-09-10',
          status: 'confirmed',
          slots: [slot({ entitlementId: 'e2' }), slot({ entitlementId: 'e2' })] }),
      ],
      tasks: [task({ done: false })],
    });

    for (const check of result.checks) {
      for (const f of check.findings) {
        assert.ok(SEVERITIES.includes(f.severity), `${check.id} 用了沒定義的嚴重度`);
        if (check.id === 'counts') assert.ok(f.fix, '次數對帳要給得出修正');
        // 二返那一項有兩種 finding：缺額度（可以補）與次數對不上（要她判斷）
        else if (check.id === 'followups') {
          assert.equal(Boolean(f.fix), f.severity === 'mismatch',
            '缺的可以一鍵補，次數對不上的不給修正');
        } else if (check.id === 'chartNo') {
          assert.ok(f.fix, '改字有明確正解，給得出修正（ADR-0050）');
        } else assert.equal(f.fix, null, `${check.id} 不該給修正`);
      }
    }
    assert.equal(result.totals.fixable, findingsOf(result, 'counts').length);
  });
});

describe('備註寫著舊的說法（ADR-0050）', () => {
  const withMarks = (marks) => run({ customers: [customer({ marks })] });

  test('「姓名欄的編號：3157」列出來，而且給得出改成什麼', () => {
    const result = withMarks([{ text: '姓名欄的編號：3157', color: 'grey' }]);
    const [f] = findingsOf(result, 'chartNo');
    assert.ok(f, '應該要報');
    assert.equal(f.fix.kind, 'renameChartNo');
    assert.deepEqual(f.fix.changes.marks, [{ text: '病歷號 3157', color: 'grey' }]);
    // notes 是那幾則接起來的純文字，試算表報表讀的是它 —— 兩個欄位要一起寫
    assert.equal(f.fix.changes.notes, '病歷號 3157');
  });

  test('顏色與其他備註原封不動', () => {
    const result = withMarks([
      { text: '喜歡下午', color: 'blue' },
      { text: '姓名欄的編號：9001', color: 'red' },
    ]);
    const [f] = findingsOf(result, 'chartNo');
    assert.deepEqual(f.fix.changes.marks, [
      { text: '喜歡下午', color: 'blue' },
      { text: '病歷號 9001', color: 'red' },
    ]);
  });

  test('已經是新說法的不報 —— 改過一次就不該再出現', () => {
    const result = withMarks([{ text: '病歷號 3157', color: 'grey' }]);
    assert.equal(findingsOf(result, 'chartNo').length, 0);
  });

  test('沒有備註的不報', () => {
    assert.equal(findingsOf(run(), 'chartNo').length, 0);
  });
});

describe('次數對帳', () => {
  test('計數欄位與重算對不起來就報，並帶著改成什麼的內容', () => {
    const result = run({
      entitlements: [ent({ doneCount: 3, bookedCount: 1 })],
      visits: [visit()], // 一次 done
    });

    const [f] = findingsOf(result, 'counts');
    assert.equal(f.severity, 'mismatch');
    assert.deepEqual(f.fix.from, { done: 3, booked: 1 });
    assert.deepEqual(f.fix.to, { done: 1, booked: 0 });
    assert.equal(f.fix.customerId, 'cus-1');
    assert.equal(f.fix.entitlementId, 'e1');
    assert.equal(f.link, '#/customers/cus-1');
  });

  test('對得起來就不報', () => {
    const result = run({ entitlements: [ent({ doneCount: 1 })], visits: [visit()] });
    assert.equal(findingsOf(result, 'counts').length, 0);
  });

  test('已刪除的客戶與額度不對帳 —— 它們本來就不該再被維護', () => {
    const result = run({
      customers: [customer({ deletedAt: 'x' })],
      entitlements: [ent({ doneCount: 99 })],
    });
    assert.equal(findingsOf(result, 'counts').length, 0);

    const result2 = run({ entitlements: [ent({ doneCount: 99, deletedAt: 'x' })] });
    assert.equal(findingsOf(result2, 'counts').length, 0);
  });

  test('已刪除的來訪不算進重算值（counts 自己會濾）', () => {
    const result = run({
      entitlements: [ent({ doneCount: 0 })],
      visits: [visit({ deletedAt: 'x' })],
    });
    assert.equal(findingsOf(result, 'counts').length, 0);
  });
});

describe('孤兒資料', () => {
  test('指向不存在的課程是 mismatch，指向已刪除的是 attention', () => {
    const missing = run({
      entitlements: [ent()],
      visits: [visit({ slots: [slot({ courseId: 'nope' })] })],
    });
    const [a] = findingsOf(missing, 'orphans');
    assert.equal(a.severity, 'mismatch');
    assert.match(a.detail, /不存在/);

    const deleted = run({
      entitlements: [ent()],
      visits: [visit()],
      master: { ...MASTER, courses: [{ id: 'c-recovery', name: '復能', deletedAt: 'x' }] },
    });
    const [b] = findingsOf(deleted, 'orphans');
    assert.equal(b.severity, 'attention');
    assert.match(b.detail, /已被刪除/);
  });

  test('沒填的欄位不是孤兒 —— 診間與治療師本來就不是每個課程都要', () => {
    const result = run({
      entitlements: [ent()],
      visits: [visit({ slots: [slot({ roomId: null, therapistId: null, ivProductId: null })] })],
    });
    assert.equal(findingsOf(result, 'orphans').length, 0);
  });

  test('指向不存在的醫師也會被抓到 —— 二返有醫師沒有治療師（ADR-0026）', () => {
    const result = run({
      entitlements: [ent()],
      visits: [visit({ slots: [slot({ doctorId: 'st-gone' })] })],
    });
    assert.ok(findingsOf(result, 'orphans').some((f) => /醫師/.test(f.what ?? f.detail)));

    const empty = run({
      entitlements: [ent()],
      visits: [visit({ slots: [slot({ doctorId: null })] })],
    });
    assert.equal(findingsOf(empty, 'orphans').length, 0, '沒填不是孤兒');
  });

  test('指向不存在的額度會被抓到', () => {
    const result = run({
      entitlements: [ent()],
      visits: [visit({ slots: [slot({ entitlementId: 'e-gone' })] })],
    });
    assert.ok(findingsOf(result, 'orphans').some((f) => /額度/.test(f.detail)));
  });

  test('任務指向不存在的來訪會被抓到，獨立待辦不會', () => {
    const orphan = run({ tasks: [task({ visitId: 'v-gone' })] });
    assert.equal(findingsOf(orphan, 'orphans').length, 1);

    const standalone = run({ tasks: [task({ visitId: null })] });
    assert.equal(findingsOf(standalone, 'orphans').length, 0);
  });
});

describe('狀態異常', () => {
  test('日期已過還是 confirmed 要報', () => {
    const result = run({ visits: [visit({ date: '2026-09-01', status: 'confirmed' })] });
    const [f] = findingsOf(result, 'visitStatus');
    assert.equal(f.severity, 'attention');
    assert.equal(f.link, '#/visits/v1');
  });

  test('日期已過還在等回覆也要報', () => {
    const result = run({ visits: [visit({ date: '2026-09-01', status: 'pending_confirm' })] });
    assert.equal(findingsOf(result, 'visitStatus').length, 1);
  });

  test('今天與未來的不報，已結案的不報', () => {
    const result = run({
      visits: [
        visit({ id: 'v1', date: TODAY, status: 'confirmed' }),
        visit({ id: 'v2', date: '2026-09-20', status: 'pending_confirm' }),
        visit({ id: 'v3', date: '2026-09-01', status: 'done' }),
        visit({ id: 'v4', date: '2026-09-01', status: 'no_show' }),
        visit({ id: 'v5', date: '2026-09-01', status: 'cancelled' }),
      ],
    });
    assert.equal(findingsOf(result, 'visitStatus').length, 0);
  });

  test('標成已完成卻一段都沒做要報 —— 次數看起來扣了，其實一次都沒扣', () => {
    // closeVisit() 產不出這種東西（一段都沒做就是整筆未到），
    // 所以出現就代表有人繞過前端改了資料。ADR-0025。
    const result = run({
      visits: [visit({
        date: '2026-09-01', status: 'done',
        slots: [slot({ attended: false }), slot({ attended: false })],
      })],
    });
    const [f] = findingsOf(result, 'visitStatus');
    assert.equal(f.severity, 'mismatch');
    assert.match(f.detail, /一次都沒扣/);
  });

  test('做了一半是正常的，不要報', () => {
    // 客人做了一段就走 —— 那是她會遇到的正常情況，不是資料壞了
    const result = run({
      visits: [visit({
        date: '2026-09-01', status: 'done',
        slots: [slot({ attended: true }), slot({ attended: false })],
      })],
    });
    assert.equal(findingsOf(result, 'visitStatus').length, 0);
  });

  test('舊資料沒有 attended 也不要報', () => {
    const result = run({ visits: [visit({ date: '2026-09-01', status: 'done' })] });
    assert.equal(findingsOf(result, 'visitStatus').length, 0);
  });

  test('繞過前端寫進來的非法狀態是 mismatch（ADR-0006）', () => {
    const result = run({ visits: [visit({ status: '亂寫的' })] });
    const [f] = findingsOf(result, 'visitStatus');
    assert.equal(f.severity, 'mismatch');
    assert.match(f.detail, /不在合法清單內/);
  });
});

describe('額度超用', () => {
  test('已排 + 已完成超過總次數就報', () => {
    const result = run({
      entitlements: [ent({ totalQty: 1, doneCount: 1 })],
      visits: [visit({ slots: [slot(), slot({ startsAt: '13:00', endsAt: '14:00' })] })],
    });
    const [f] = findingsOf(result, 'overused');
    assert.match(f.detail, /超出 1 次/);
    assert.equal(f.fix, null);
  });

  test('看的是重算值，不是計數欄位 —— 欄位歪掉時不能冤枉也不能漏', () => {
    // 欄位說超用（9+9 > 12），但來訪只有一次
    const looksOver = run({
      entitlements: [ent({ totalQty: 12, doneCount: 9, bookedCount: 9 })],
      visits: [visit()],
    });
    assert.equal(findingsOf(looksOver, 'overused').length, 0);

    // 欄位說沒事，但來訪其實排了兩次而總數只有一次
    const reallyOver = run({
      entitlements: [ent({ totalQty: 1, doneCount: 0, bookedCount: 0 })],
      visits: [
        visit({ id: 'v1' }),
        visit({ id: 'v2', date: '2026-09-11' }),
      ],
    });
    assert.equal(findingsOf(reallyOver, 'overused').length, 1);
  });
});

describe('衝突殘留', () => {
  const other = (over = {}) => visit({
    id: 'v2', customerId: 'cus-2', customerName: '客戶二', status: 'confirmed', ...over,
  });

  test('同一天同治療師時間重疊會被抓到', () => {
    const result = run({ visits: [visit({ status: 'confirmed' }), other()] });
    const [f] = findingsOf(result, 'conflicts');
    assert.match(f.title, /治療師甲/);
    assert.match(f.detail, /撞在一起/);
  });

  test('同診間要連床位一起看，不同床不算撞', () => {
    const sameBed = run({
      visits: [
        visit({ status: 'confirmed', slots: [slot({ therapistId: null, roomId: 'r-3', bed: 'A' })] }),
        other({ slots: [slot({ therapistId: null, roomId: 'r-3', bed: 'A' })] }),
      ],
    });
    assert.equal(findingsOf(sameBed, 'conflicts').length, 1);

    const otherBed = run({
      visits: [
        visit({ status: 'confirmed', slots: [slot({ therapistId: null, roomId: 'r-3', bed: 'A' })] }),
        other({ slots: [slot({ therapistId: null, roomId: 'r-3', bed: 'B' })] }),
      ],
    });
    assert.equal(findingsOf(otherBed, 'conflicts').length, 0);
  });

  test('取消的來訪不算 —— 時段已經還回去了', () => {
    const result = run({ visits: [visit({ status: 'confirmed' }), other({ status: 'cancelled' })] });
    assert.equal(findingsOf(result, 'conflicts').length, 0);
  });

  test('不同天不會互撞，同一筆來訪內部的重疊也不歸這裡管', () => {
    const differentDay = run({
      visits: [visit({ status: 'confirmed' }), other({ date: '2026-09-11' })],
    });
    assert.equal(findingsOf(differentDay, 'conflicts').length, 0);

    const selfOverlap = run({ visits: [visit({ slots: [slot(), slot()] })] });
    assert.equal(findingsOf(selfOverlap, 'conflicts').length, 0);
  });

  test('每一對只報一次，不會 A 撞 B、B 撞 A 各報一次', () => {
    const result = run({ visits: [visit({ status: 'confirmed' }), other()] });
    assert.equal(findingsOf(result, 'conflicts').length, 1);
  });
});

describe('逾期任務', () => {
  test('死線已過且沒勾完成才報', () => {
    const result = run({
      tasks: [
        task({ id: 't1', done: false, dueDate: '2026-09-01' }),
        task({ id: 't2', done: true, dueDate: '2026-09-01' }),
        task({ id: 't3', done: false, dueDate: TODAY }),
        task({ id: 't4', done: false, dueDate: '2026-09-30' }),
      ],
    });
    const findings = findingsOf(result, 'overdueTasks');
    assert.equal(findings.length, 1);
    assert.match(findings[0].detail, /2026-09-01/);
  });
});

describe('資料過期', () => {
  const ents = [ent({ totalQty: 12 })];

  test('最近一份已過有效期就報', () => {
    const result = run({
      entitlements: ents,
      availability: [{
        id: 'a1', customerId: 'cus-1', collectedAt: '2026-08-01',
        validFrom: '2026-08-01', validTo: '2026-08-31', rawText: '八月', rules: [],
      }],
    });
    const [f] = findingsOf(result, 'staleAvailability');
    assert.match(f.detail, /已過有效期/);
    assert.match(f.detail, /還有 12 次沒排/);
  });

  test('還在有效期內就不報', () => {
    const result = run({
      entitlements: ents,
      availability: [{
        id: 'a1', customerId: 'cus-1', collectedAt: '2026-09-01',
        validFrom: '2026-09-01', validTo: '2026-09-30', rawText: '九月', rules: [],
      }],
    });
    assert.equal(findingsOf(result, 'staleAvailability').length, 0);
  });

  test('沒排完的人才要問時間：沒有剩餘次數就不報', () => {
    const noRemaining = run({ entitlements: [ent({ totalQty: 1 })], visits: [visit()] });
    assert.equal(findingsOf(noRemaining, 'staleAvailability').length, 0);

    const neverCollected = run({ entitlements: ents });
    assert.match(findingsOf(neverCollected, 'staleAvailability')[0].detail, /從來沒收集過/);
  });

  test('已停用與已刪除的客戶不報', () => {
    const inactive = run({ customers: [customer({ active: false })], entitlements: ents });
    assert.equal(findingsOf(inactive, 'staleAvailability').length, 0);

    const deleted = run({ customers: [customer({ deletedAt: 'x' })], entitlements: ents });
    assert.equal(findingsOf(deleted, 'staleAvailability').length, 0);
  });
});

describe('摘要', () => {
  test('兩種嚴重度分開數，徽章講人話', () => {
    const result = run({
      entitlements: [ent({ doneCount: 5 })],
      tasks: [task({ visitId: null, done: false, dueDate: '2026-09-01' })],
      availability: [{
        id: 'a1', customerId: 'cus-1', collectedAt: '2026-09-01',
        validFrom: '2026-09-01', validTo: '2026-09-30', rawText: '九月', rules: [],
      }],
    });
    assert.equal(result.totals.mismatch, 1);
    assert.equal(result.totals.attention, 1);
    assert.equal(healthBadge(result), '1 筆資料對不起來・1 筆要處理');
  });
});

// ---------- 二返額度 ----------
//
// GitHub issue #15：買了健檢卻沒有二返額度的客戶，行事曆上的二返補不進來。
// 額度展開之後就跟範本脫鉤（ADR-0003），所以既有客戶只能靠這一項補。

describe('二返額度', () => {
  const checkupEnt = (over = {}) => ent({
    id: 'e-checkup', type: 'single', label: '0.75萬健檢', courseId: 'c-checkup',
    totalQty: 3, ...over,
  });
  const followupEnt = (over = {}) => ent({
    id: 'e-followup', type: 'single', label: '二返（0.75萬健檢）', courseId: 'c-followup',
    totalQty: 3, followupForEntitlementId: 'e-checkup', ...over,
  });

  test('買了健檢卻沒有二返額度就報，而且可以一鍵補', () => {
    const [found, ...rest] = findingsOf(run({ entitlements: [checkupEnt()] }), 'followups');
    assert.deepEqual(rest, []);
    assert.equal(found.severity, 'mismatch');
    assert.equal(found.fix.kind, 'addFollowup');
    assert.equal(found.fix.customerId, 'cus-1');
    assert.equal(found.fix.draft.totalQty, 3, '次數就是健檢的次數');
    assert.equal(found.fix.draft.courseId, 'c-followup');
    assert.equal(found.fix.draft.followupForEntitlementId, 'e-checkup');
  });

  test('配好了就不報', () => {
    const result = run({ entitlements: [checkupEnt(), followupEnt()] });
    assert.deepEqual(findingsOf(result, 'followups'), []);
  });

  test('沒有健檢額度的客戶不會被拉進來', () => {
    assert.deepEqual(findingsOf(run({ entitlements: [ent()] }), 'followups'), []);
  });

  test('次數對不上只提醒，不給一鍵修正 —— 她可能是故意的', () => {
    const result = run({ entitlements: [checkupEnt(), followupEnt({ totalQty: 2 })] });
    const [found] = findingsOf(result, 'followups');
    assert.equal(found.severity, 'attention');
    assert.equal(found.fix, null);
    assert.match(found.detail, /健檢是 3 次，二返卻是 2 次/);
  });

  test('已刪除的健檢額度不用配', () => {
    const result = run({ entitlements: [checkupEnt({ deletedAt: '2026-09-01' })] });
    assert.deepEqual(findingsOf(result, 'followups'), []);
  });

  test('已停用的客戶不報 —— 她不會再替他排課', () => {
    const result = run({
      customers: [customer({ active: false })],
      entitlements: [checkupEnt()],
    });
    assert.deepEqual(findingsOf(result, 'followups'), []);
  });
});

// ---------- 畫面認不認得每一種修正 ----------
//
// `ui/views/health.js` 拿 `fix.kind` 去查兩張表：`KIND_TO_CHECK`（這是哪一項）
// 與 `FIX_COPY`（按鈕上印什麼、確認框寫什麼）。少補一列的代價不是少一句話 ——
// 2026-08-25 抓到的是：`renameChartNo` 兩張表都沒有，於是按鈕印著別項的
// 「改成重算值」，而按下去要讀那一筆根本沒有的 `fix.from.done`，
// 整顆一鍵修正就這樣按不動，畫面上什麼都沒說（ADR-0050 那一項）。
//
// 這一支跟 `module-names.test.js` 同一個路數：**不執行 UI 程式碼**
//（那一支要 DOM 與 firebase），只讀原始碼問「這個名字在不在那張表裡」。

const VIEW_SRC = readFileSync(
  new URL('../public/js/ui/views/health.js', import.meta.url).pathname,
  'utf8',
);

/** `const NAME = {` 到對應的 `}` 之間那一段。註解裡的括號不算。 */
function objectBody(src, name) {
  const start = src.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `ui/views/health.js 裡找不到 ${name}`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (!depth) return src.slice(start, i + 1);
    }
  }
  throw new Error(`${name} 的大括號沒有收尾`);
}

/** 最外層那幾個鍵。巢狀的不算 —— 一行一行走，只認 depth 1 那幾行。 */
function topKeys(body) {
  const keys = [];
  let depth = 0;
  for (const line of body.split('\n')) {
    if (depth === 1) {
      const m = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(line);
      if (m) keys.push(m[1]);
    }
    for (const ch of line) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
  }
  return keys;
}

// 一份不能的時間就是一個月（ADR-0053）。同一個月有兩份時壓表只挑得到其中一份，
// 另一份是隱形的 —— 只列不修，合併是不可逆的。
describe('同一個月有兩份不能的時間', () => {
  const two = [
    {
      id: 'a1', customerId: 'cus-1', collectedAt: '2026-08-20',
      validFrom: '2026-09-01', validTo: '2026-09-30', rawText: '禮拜五不行',
      rules: [{ kind: 'exclude_weekday', weekday: 5 }],
    },
    {
      id: 'a2', customerId: 'cus-1', collectedAt: '2026-08-24',
      validFrom: '2026-09-01', validTo: '2026-09-30', rawText: '都可以', rules: [],
    },
  ];

  test('列出來，但不給一鍵修正', () => {
    const rows = findingsOf(run({ availability: two }), 'duplicateAvailability');
    assert.equal(rows.length, 1);
    assert.match(rows[0].title, /9月/);
    assert.match(rows[0].detail, /記了 2 份/);
    assert.equal(rows[0].fix, null, '合併是不可逆的，要她自己決定留哪一份');
  });

  test('不同月份各一份不算重複', () => {
    const rows = findingsOf(run({
      availability: [two[0], { ...two[1], id: 'a3', validFrom: '2026-10-01', validTo: '2026-10-31' }],
    }), 'duplicateAvailability');
    assert.deepEqual(rows, []);
  });

  test('有效期看不出月份的那幾份不算重複 —— 那是另一種壞法', () => {
    const rows = findingsOf(run({
      availability: two.map((c) => ({ ...c, validFrom: null, validTo: null })),
    }), 'duplicateAvailability');
    assert.deepEqual(rows, []);
  });
});

describe('畫面認得每一種修正', () => {
  // 三種 fix 一次全部長出來：計數對不上、缺二返額度、備註寫著舊的說法
  const result = run({
    customers: [customer({ marks: [{ text: '姓名欄的編號：3157', color: 'grey' }] })],
    entitlements: [
      ent({ doneCount: 5 }),
      ent({ id: 'e-chk', type: 'single', label: '健檢', courseId: 'c-checkup', totalQty: 2 }),
    ],
    visits: [visit()],
  });

  const kinds = [...new Set(
    result.checks.flatMap((c) => c.findings).map((f) => f.fix?.kind).filter(Boolean),
  )];

  test('這份快照真的把三種修正都長出來了', () => {
    assert.deepEqual(kinds.slice().sort(), ['addFollowup', 'recount', 'renameChartNo']);
  });

  test('每一種 fix.kind 在 KIND_TO_CHECK 與 FIX_COPY 都查得到', () => {
    const map = objectBody(VIEW_SRC, 'KIND_TO_CHECK');
    const copyKeys = topKeys(objectBody(VIEW_SRC, 'FIX_COPY'));

    for (const kind of kinds) {
      const m = new RegExp(`\\b${kind}\\s*:\\s*'([\\w-]+)'`).exec(map);
      assert.ok(m, `KIND_TO_CHECK 少了 ${kind} —— 按鈕會印成別項的文案，按下去會爆`);
      assert.ok(
        copyKeys.includes(m[1]),
        `FIX_COPY 少了 ${m[1]}（${kind} 對到的那一項）`,
      );
    }
  });

  test('FIX_COPY 的每一個鍵都真的是一項檢查', () => {
    for (const key of topKeys(objectBody(VIEW_SRC, 'FIX_COPY'))) {
      assert.ok(
        CHECKS.some((c) => c.id === key),
        `FIX_COPY 有 ${key}，但 CHECKS 裡沒有這一項`,
      );
    }
  });
});
