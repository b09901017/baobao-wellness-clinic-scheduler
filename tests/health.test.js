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
import { SEED } from '../public/js/domain/seed.js';

const TODAY = '2026-09-15';

const MASTER = {
  courses: [
    { id: 'c-recovery', name: '復能', requiresEquipment: true },
    { id: 'c-checkup', name: '健檢', durationMin: 120, followupCourseId: 'c-followup' },
    { id: 'c-followup', name: '二返', durationMin: 30 },
    { id: 'c-inbody', name: '身體組成分析', durationMin: 20 },
    { id: 'c-iv', name: '營養點滴', durationMin: 60, requiresIvProduct: true },
  ],
  rooms: [{ id: 'r-3', name: '治3' }],
  staff: [{ id: 's-1', name: '治療師甲' }],
  equipment: [{ id: 'eq-indiba', name: 'INDIBA', shortName: 'IN' }],
  ivProducts: [{ id: 'iv-1', name: '護肝排毒' }, { id: 'iv-2', name: '美白' }],
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

describe('匯進來的額度還叫舊表的名字（ADR-0095）', () => {
  const imported = (over) => ({
    id: 'e-imp', customerId: 'cus-1', type: 'single', totalQty: 4,
    doneCount: 0, bookedCount: 0, importedFrom: '合併檔 2026-09-16', ...over,
  });

  test('算不出來、原字留著的那幾筆要列出來', () => {
    const r = run({ entitlements: [imported({ label: '12萬健檢', courseId: 'c-checkup', tier: null })] });
    const rows = findingsOf(r, 'importedLabel');
    assert.equal(rows.length, 1);
    assert.match(rows[0].detail, /健檢/);
  });

  test('那一列沒有修正鈕 —— 一鍵改掉等於把匯入時刻意留下來的東西洗掉', () => {
    const r = run({ entitlements: [imported({ label: '營養針', courseId: 'c-iv' })] });
    assert.equal(findingsOf(r, 'importedLabel').every((f) => f.fix === null), true);
  });

  test('改好了就少一列', () => {
    const r = run({ entitlements: [imported({ label: '身體組成分析', courseId: 'c-inbody' })] });
    assert.deepEqual(findingsOf(r, 'importedLabel'), []);
  });

  test('她自己在 app 裡建的額度不列 —— 判準是 importedFrom', () => {
    const r = run({
      entitlements: [imported({ label: '我自己取的名字', courseId: 'c-inbody', importedFrom: null })],
    });
    assert.deepEqual(findingsOf(r, 'importedLabel'), []);
  });

  test('配出來的二返不列 —— 那個名字是 app 自己接的，不是舊表的字', () => {
    const r = run({
      entitlements: [imported({
        id: 'e-fu', label: '二返（12萬健檢）', courseId: 'c-followup',
        followupForEntitlementId: 'e-imp',
      })],
    });
    assert.deepEqual(findingsOf(r, 'importedLabel'), []);
  });

  test('健檢帶著 tier 時算出來的就是原名，所以不列', () => {
    const r = run({
      entitlements: [imported({ label: '12萬健檢', courseId: 'c-checkup', tier: '12萬' })],
    });
    assert.deepEqual(findingsOf(r, 'importedLabel'), []);
  });
});

describe('形狀', () => {
  test('二十五項檢查都在，順序固定', () => {
    const result = run();
    assert.equal(result.checks.length, 25);
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

// 2026-09-04：排班的兩個入口以前把主檔裡全部的品項列出來，所以「營養點滴・A」
// 那筆額度底下排成 B 是存得下去的。現在畫面預設就是買的那一款、存檔會提醒，
// 但已經存進去的那幾筆不會自己好 —— 這一項就是讓她看得到它們。
describe('品項跟買的不一樣', () => {
  const ivEnt = (over = {}) => ent({
    id: 'e-iv', type: 'single', label: '營養點滴・護肝排毒',
    courseId: 'c-iv', ivProductId: 'iv-1', totalQty: 3, ...over,
  });
  const ivVisit = (ivProductId) => visit({
    slots: [slot({
      entitlementId: 'e-iv', courseId: 'c-iv', equipmentId: null,
      therapistId: null, ivProductId,
    })],
  });

  test('排成別款 → 列出來，一句話講清楚買的是哪一款、排成了哪一款', () => {
    const found = findingsOf(
      run({ entitlements: [ivEnt()], visits: [ivVisit('iv-2')] }),
      'ivMismatch',
    );
    assert.equal(found.length, 1);
    assert.match(found[0].detail, /買的是 護肝排毒，排成了 美白/);
    assert.equal(found[0].severity, 'attention', '資料沒壞，是要她去看一眼');
    assert.equal(found[0].fix, null, '不自動改 —— Abovee 上那一筆也要跟著改');
  });

  test('排的就是買的那一款 → 不報', () => {
    const found = findingsOf(
      run({ entitlements: [ivEnt()], visits: [ivVisit('iv-1')] }),
      'ivMismatch',
    );
    assert.deepEqual(found, []);
  });

  test('額度上沒有品項（舊資料）→ 不報', () => {
    const found = findingsOf(
      run({ entitlements: [ivEnt({ ivProductId: null })], visits: [ivVisit('iv-2')] }),
      'ivMismatch',
    );
    assert.deepEqual(found, []);
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

  // 隨手記以前不在快照裡，所以它身上的孤兒一個都看不到。它現在扛著日曆上的
  // 「待辦」與營養品的交付觸發兩個職責（ADR-0044、0059）。
  describe('隨手記', () => {
    const note = (over = {}) => ({
      id: 'n1', text: '記得給營養品', done: false, ...over,
    });

    test('沒掛人的雜事不是孤兒 —— 那是正常的', () => {
      const result = run({ notes: [note({ customerId: null, entitlementId: null })] });
      assert.equal(findingsOf(result, 'orphans').length, 0);
    });

    test('掛到不存在的客戶會被抓到', () => {
      const result = run({ notes: [note({ customerId: 'cus-gone' })] });
      const [f] = findingsOf(result, 'orphans');
      assert.equal(f.severity, 'mismatch');
      assert.match(f.detail, /客戶/);
    });

    // 這一條是整段的理由：額度被刪掉之後那筆提醒還勾得動，
    // 而勾下去 recordDelivery() 寫不進任何東西 —— 畫面上只是勾掉了。
    test('提醒指向已刪除的營養品額度會被抓到', () => {
      const result = run({
        entitlements: [ent({ id: 'e-prod', type: 'product', deletedAt: 'x' })],
        notes: [note({ customerId: 'cus-1', entitlementId: 'e-prod' })],
      });
      const [f] = findingsOf(result, 'orphans');
      assert.equal(f.severity, 'attention', '已刪除是 attention，不存在才是 mismatch');
      assert.match(f.detail, /營養品/);
      assert.equal(f.link, '#/customers/cus-1');
    });

    test('指向不存在的額度是 mismatch，而且連得到那位客戶', () => {
      const result = run({ notes: [note({ customerId: 'cus-1', entitlementId: 'e-gone' })] });
      const [f] = findingsOf(result, 'orphans');
      assert.equal(f.severity, 'mismatch');
      assert.equal(f.link, '#/customers/cus-1');
    });

    test('好好的那一筆一項都不報', () => {
      const result = run({
        entitlements: [ent({ id: 'e-prod', type: 'product' })],
        notes: [note({ customerId: 'cus-1', entitlementId: 'e-prod' })],
      });
      assert.equal(findingsOf(result, 'orphans').length, 0);
    });

    test('快照沒帶 notes 也不會炸 —— 舊呼叫端照樣跑得動', () => {
      const result = runHealthCheck({ customers: [customer()], master: MASTER }, TODAY);
      assert.equal(findingsOf(result, 'orphans').length, 0);
    });
  });
});

describe('狀態異常', () => {
  test('日期已過還是 confirmed 要報', () => {
    const result = run({ visits: [visit({ date: '2026-09-01', status: 'confirmed' })] });
    const [f] = findingsOf(result, 'visitStatus');
    assert.equal(f.severity, 'attention');
    // **2026-09-16 起沒有「去看看」**：那一顆以前指整天的編輯器，而那一頁
    // 做不到這一列要她做的事（整天的狀態卡 2026-09-12 拿掉了）。
    // 真正的出口是待辦中心的「簽療程單」。
    assert.equal(f.link, null);
  });

  test('來訪相關的那幾列一顆「去看看」都沒有', () => {
    const result = run({
      visits: [visit({ date: '2026-09-01', status: 'confirmed' })],
      tasks: [task({ dueDate: '2026-09-01' })],
    });
    for (const id of ['orphans', 'visitStatus', 'conflicts', 'overdueTasks']) {
      const rows = findingsOf(result, id);
      assert.ok(rows.every((f) => f.link === null || !String(f.link).startsWith('#/visits/')),
        `${id} 還指著整天的編輯器`);
    }
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

  // **2026-09-16 起算人頭**（ADR-0094）。床位那一層 2026-09-08 就拿掉了，
  // 而這裡一直照「同一間**而且**同一床」比 —— 舊資料上帶著 A／B 的那幾筆
  // 永遠不算撞，而一間真的裝得下兩個人的點滴8 反而永遠算撞（模擬匯入之後
  // 第一天就有那一列，而且沒有修正鈕、關不掉）。
  test('一間只裝一個人時：同一間、同一個時間就是撞（不管床位那一格）', () => {
    const result = run({
      visits: [
        visit({ status: 'confirmed', slots: [slot({ therapistId: null, roomId: 'r-3', bed: 'A' })] }),
        other({ slots: [slot({ therapistId: null, roomId: 'r-3', bed: 'B' })] }),
      ],
    });
    assert.equal(findingsOf(result, 'conflicts').length, 1);
  });

  test('裝得下兩個人的診間：兩位不列', () => {
    const result = run({
      master: { ...MASTER, rooms: [{ id: 'r-3', name: '點滴8', capacity: 2 }] },
      visits: [
        visit({ status: 'confirmed', slots: [slot({ therapistId: null, roomId: 'r-3' })] }),
        other({ slots: [slot({ therapistId: null, roomId: 'r-3' })] }),
      ],
    });
    assert.deepEqual(findingsOf(result, 'conflicts'), []);
  });

  test('裝得下兩個人的診間：第三位照樣列', () => {
    const result = run({
      master: { ...MASTER, rooms: [{ id: 'r-3', name: '點滴8', capacity: 2 }] },
      visits: [
        visit({ status: 'confirmed', slots: [slot({ therapistId: null, roomId: 'r-3' })] }),
        other({ slots: [slot({ therapistId: null, roomId: 'r-3' })] }),
        other({ id: 'v-third', slots: [slot({ therapistId: null, roomId: 'r-3' })] }),
      ],
    });
    assert.ok(findingsOf(result, 'conflicts').length > 0);
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

  // ADR-0057：只買了兩罐夜態美的客戶不需要被問時間，而「還有 2 次沒排」
  // 那句話講的是兩罐營養品 —— 她會照著去問一個不存在的班。
  test('只買了營養品的客戶不報', () => {
    const onlyProduct = run({
      entitlements: [ent({ id: 'p1', type: 'product', label: 'GABA', totalQty: 2, courseId: null })],
    });
    assert.equal(findingsOf(onlyProduct, 'staleAvailability').length, 0);
  });

  test('有課程額度時，那個數字不含營養品', () => {
    const mixed = run({
      entitlements: [
        ent({ totalQty: 12 }),
        ent({ id: 'p1', type: 'product', label: 'GABA', totalQty: 2, courseId: null }),
      ],
    });
    assert.match(findingsOf(mixed, 'staleAvailability')[0].detail, /還有 12 次沒排/);
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
  new URL('../public/js/ui/views/health.js', import.meta.url),
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


// ---------- 十二、復能額度還叫舊名字（issue 09）----------
//
// `04` 之後新買的叫「復能三選一(60)」，而既有客戶身上那一筆叫「復能」。
// 額度的名字是購買當下的快照（ADR-0003），它不會自己跟上。
describe('復能額度還叫舊名字', () => {
  const EQUIPMENT = [
    { id: 'eq-laser', name: '高能量雷射', courseId: 'c-recovery' },
    { id: 'eq-sis', name: 'SIS', courseId: 'c-recovery' },
    { id: 'eq-indiba', name: 'INDIBA', shortName: 'IN', courseId: 'c-recovery' },
  ];
  const COURSES = [{ id: 'c-recovery', name: '復能', requiresEquipment: true, durationMin: 60 }];
  const pool = (over = {}) => ent({
    id: 'e-pool', type: 'pool', label: '復能', durationMin: 60,
    optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], ...over,
  });
  const go = (entitlements) => run({
    entitlements,
    master: { equipment: EQUIPMENT, courses: COURSES },
  }).checks.find((c) => c.id === 'poolLabel').findings;

  test('叫「復能」的那幾筆列出來，而且講得出要改成什麼', () => {
    const [f] = go([pool()]);
    assert.match(f.detail, /復能-三選一\(60\)/);
    assert.equal(f.fix.kind, 'renamePool');
    assert.equal(f.fix.to, '復能-三選一(60)');
    assert.equal(f.fix.entitlementId, 'e-pool');
  });

  test('已經是新名字的不列 —— 不要每次掃都出現一次', () => {
    assert.deepEqual(go([pool({ label: '復能-三選一(60)' })]), []);
  });

  test('歷代自動名字都認得出來', () => {
    // 格式改過兩次（ADR-0077、2026-09-08），既有客戶身上是這幾種
    for (const label of ['復能三選一(60)', '復能 - 三選一（60）', '復能 - 三選一(60)']) {
      const [f] = go([pool({ label })]);
      assert.equal(f.fix.to, '復能-三選一(60)', label);
    }
  });

  test('中間那個形狀（算得出名字但沒有時長）也認得出來', () => {
    assert.equal(go([pool({ label: '復能三選一' })]).length, 1);
  });

  test('她自己打的名字不動 —— 那不可以被一顆按鈕改掉', () => {
    assert.deepEqual(go([pool({ label: '客戶A談的那五次' })]), []);
  });

  test('單台的池照樣認得出來，改成「復能-器材全名」', () => {
    const [f] = go([pool({ label: '復能', optionEquipmentIds: ['eq-sis'] })]);
    assert.equal(f.fix.to, '復能-SIS(60)');
  });

  test('單台的池：歷代自動名字也認得出來', () => {
    for (const label of ['SIS', 'SIS(60)', '復能 - SIS（60）']) {
      const [f] = go([pool({ label, optionEquipmentIds: ['eq-sis'] })]);
      assert.equal(f.fix.to, '復能-SIS(60)', label);
    }
  });

  test('器材全被刪了就不猜一個名字出來', () => {
    assert.deepEqual(go([pool({ optionEquipmentIds: ['eq-gone'] })]), []);
  });

  test('single 型態不進這一項', () => {
    assert.deepEqual(go([ent({ id: 'e1', type: 'single', label: '健檢' })]), []);
  });
});

// ---------- 十三、器材上的提醒詞不在警示名單裡（issue 09）----------
describe('器材上的提醒詞不在警示名單裡', () => {
  const go = (equipment, clinicalFlags) => run({
    master: { equipment, clinicalFlags },
  }).checks.find((c) => c.id === 'alertTerm').findings;

  test('器材上有、警示主檔沒有的那幾個字列出來', () => {
    const [f] = go([{ id: 'eq-sis', name: '超磁場', contraindications: ['體內金屬'] }], []);
    assert.equal(f.title, '體內金屬');
    assert.equal(f.fix.kind, 'addAlert');
    assert.equal(f.fix.data.name, '體內金屬');
    assert.equal(f.fix.data.fill, 'solid', '這幾個字本來就是最該看到的那一種');
  });

  test('兩邊都有的不列', () => {
    assert.deepEqual(
      go([{ id: 'eq-sis', name: '超磁場', contraindications: ['體內金屬'] }],
        [{ id: 'cf', name: '體內金屬' }]),
      [],
    );
  });

  test('停用的警示不算數 —— 它畫不出來', () => {
    assert.equal(
      go([{ id: 'eq-sis', name: '超磁場', contraindications: ['體內金屬'] }],
        [{ id: 'cf', name: '體內金屬', active: false }]).length,
      1,
    );
  });

  test('同一個字在兩台器材上只列一次', () => {
    assert.equal(
      go([
        { id: 'eq-sis', name: '超磁場', contraindications: ['體內金屬'] },
        { id: 'eq-laser', name: '高能量雷射', contraindications: ['體內金屬'] },
      ], []).length,
      1,
    );
  });

  test('沒有器材就一項都不報', () => {
    assert.deepEqual(go([], []), []);
  });
});

// ---------- 十四、器材主檔少了一台（ADR-0077）----------
//
// 她 2026-09-07 的第一句話是「復能為什麼沒有四選一？」——
// 答案是她的器材主檔裡沒有 ILIB 那一台，而「四選一」要有一台不屬於復能的
// 器材才組得出來。少一顆丸子跟「本來就沒有那一種」在畫面上長得一模一樣。
describe('器材主檔少了一台', () => {
  const go = (master) => run({ master }).checks
    .find((c) => c.id === 'seedEquipment').findings;

  const withoutIlib = {
    courses: SEED.courses,
    equipment: SEED.equipment.filter((e) => e.id !== 'eq-ilib'),
  };

  test('種子有、主檔沒有的那一台列出來，而且建得起來', () => {
    const [f] = go(withoutIlib);
    assert.equal(f.title, 'ILIB');
    assert.equal(f.fix.kind, 'addEquipment');
    assert.equal(f.fix.equipmentId, 'eq-ilib', 'id 要用種子上的那一個，不然會建出第二台');
    assert.equal(f.fix.data.courseId, 'course-iv-laser');
    assert.equal(f.fix.data.shortName, 'IL');
    assert.equal(f.fix.data.active, true);
    assert.ok(!('id' in f.fix.data), 'id 另外給，不要塞進資料裡');
  });

  test('種子完整就一項都不報', () => {
    assert.deepEqual(go({ courses: SEED.courses, equipment: SEED.equipment }), []);
  });

  test('她自己刪掉的不再提 —— 這一列不可以變成關不掉的提醒', () => {
    assert.deepEqual(go({
      courses: SEED.courses,
      equipment: SEED.equipment.map((e) => (e.id === 'eq-ilib' ? { ...e, deletedAt: 'x' } : e)),
    }), []);
  });

  test('那一台的課程不在主檔裡就不念 —— 那時候缺的是整份主檔', () => {
    assert.deepEqual(go({ courses: [], equipment: [] }), []);
  });
});

// ---------- 十五、課程沒填可選時長（ADR-0077）----------
describe('課程沒填可選時長', () => {
  const go = (courses) => run({ master: { ...MASTER, courses } }).checks
    .find((c) => c.id === 'seedDuration').findings;

  const bare = (id) => ({ ...SEED.courses.find((c) => c.id === id), durationChoices: [] });

  test('那一格是空的就列出來，而且填得起來', () => {
    const [f] = go([bare('course-recovery')]);
    assert.equal(f.title, '復能');
    assert.equal(f.fix.kind, 'setDurations');
    assert.equal(f.fix.courseId, 'course-recovery');
    assert.deepEqual(f.fix.durationChoices, [30, 60]);
    assert.match(f.detail, /30、60/);
  });

  test('復能與 ILIB 兩個都算數', () => {
    assert.equal(go([bare('course-recovery'), bare('course-iv-laser')]).length, 2);
  });

  test('填好了就不再提', () => {
    assert.deepEqual(go(SEED.courses), []);
  });

  test('她自己填成別的組合就不動 —— 那是一個決定', () => {
    assert.deepEqual(go([{ ...bare('course-recovery'), durationChoices: [60] }]), []);
  });

  test('她的主檔裡沒有那個課程就不念', () => {
    assert.deepEqual(go([]), []);
  });

  test('刪掉的課程不念', () => {
    assert.deepEqual(go([{ ...bare('course-recovery'), deletedAt: 'x' }]), []);
  });

  test('種子上沒有可選時長的課程本來就不在名單裡', () => {
    assert.deepEqual(go([{ ...SEED.courses.find((c) => c.id === 'course-checkup') }]), []);
  });
});

// ---------- 十六、課程的指派跟建議的不一樣（她 2026-09-08 的三條規則）----------
//
// `loadSeed()` 只建不覆蓋（她可能改過了），所以改種子資料對她**現有的**
// 資料庫一點作用都沒有。這一列就是那一步。
//
// **只認得出「還停在舊種子那一代」的**：她自己改成第三種值是一個決定，
// 不可以被一顆按鈕改回去（同 `checkPoolLabels()` 那條「她自己打的名字不動」）。
// 不然這一列會變成一個關不掉的提醒，而關不掉的提醒她第三天就不看了。
describe('課程的指派跟建議的不一樣', () => {
  const go = (courses) => run({ master: { ...MASTER, courses } }).checks
    .find((c) => c.id === 'courseAssigns').findings;

  /** 2026-09-08 之前的樣子：那六個都指派治療室。 */
  const legacy = (id) => ({
    ...SEED.courses.find((c) => c.id === id),
    assigns: 'room',
    allowedRoomTypes: ['治療室'],
    allowedRoomIds: [],
  });

  test('還停在舊的那一個列出來，而且改得起來', () => {
    const [f] = go([legacy('course-checkup')]);
    assert.equal(f.title, '健檢');
    assert.equal(f.fix.kind, 'setAssigns');
    assert.equal(f.fix.courseId, 'course-checkup');
    assert.equal(f.fix.assigns, 'none');
    // 不指派空間的課程身上不可以留著診間限制，不然那一筆存不下去
    assert.deepEqual(f.fix.allowedRoomTypes, []);
    assert.deepEqual(f.fix.allowedRoomIds, []);
  });

  test('六個都算數', () => {
    const ids = ['course-checkup', 'course-fitness', 'course-inbody',
      'course-nutrition-consult', 'course-rehab', 'course-followup'];
    assert.equal(go(ids.map(legacy)).length, 6);
  });

  test('已經是建議值就不再提', () => {
    assert.deepEqual(go(SEED.courses), []);
  });

  test('她自己改成第三種值就不動 —— 那是一個決定', () => {
    assert.deepEqual(go([{ ...legacy('course-checkup'), assigns: 'therapist' }]), []);
  });

  test('沒有要改的那幾個課程本來就不在名單裡', () => {
    assert.deepEqual(go([SEED.courses.find((c) => c.id === 'course-recovery')]), []);
    assert.deepEqual(go([SEED.courses.find((c) => c.id === 'course-eecp')]), []);
  });

  test('她的主檔裡沒有那個課程就不念', () => {
    assert.deepEqual(go([]), []);
  });

  test('刪掉的課程不念', () => {
    assert.deepEqual(go([{ ...legacy('course-checkup'), deletedAt: 'x' }]), []);
  });

  // 那一支通用的覆蓋測試只看得到它那份快照長出來的三種 kind，
  // 所以這一種要自己確認一次 —— 少補一列的話按鈕會印成別項的文案，
  // 按下去 `copyFor()` 直接丟例外，整頁變成「讀取失敗」。
  test('這一種修正在畫面那兩張表上查得到', () => {
    const src = readFileSync(new URL('../public/js/ui/views/health.js', import.meta.url), 'utf8');
    assert.ok(src.includes("setAssigns: 'courseAssigns'"), 'KIND_TO_CHECK 少了 setAssigns');
    assert.ok(src.includes('  courseAssigns: {'), 'FIX_COPY 少了 courseAssigns');
  });

  test('修正寫進去的是主檔那三格，一筆來訪都不動', () => {
    const [f] = go([legacy('course-rehab')]);
    assert.deepEqual(Object.keys(f.fix).sort(), [
      'allowedRoomIds', 'allowedRoomTypes', 'assigns', 'courseId',
      'fromLabel', 'kind', 'label', 'toLabel',
    ]);
  });
});

// ---------- 十七、器材的名字跟建議的不一樣（2026-09-08）----------
//
// 那一輪把器材主檔上兩格名字的分工定下來：全名是「她叫它什麼」（額度讀它），
// 別稱是「月曆那一格的縮寫」（月曆讀它）。在那之前兩邊都讀別稱。
describe('器材的名字跟建議的不一樣', () => {
  const go = (equipment) => run({ master: { ...MASTER, equipment } }).checks
    .find((c) => c.id === 'equipmentNames').findings;

  /** 2026-09-08 之前的樣子。 */
  const legacy = {
    'eq-sis': { id: 'eq-sis', name: '超磁場', shortName: 'SIS', courseId: 'course-recovery' },
    'eq-indiba': { id: 'eq-indiba', name: 'INDIBA', courseId: 'course-recovery' },
  };

  test('還停在舊的那一台列出來，而且改得起來', () => {
    const [f] = go([legacy['eq-sis']]);
    assert.equal(f.title, '超磁場');
    assert.equal(f.fix.kind, 'renameEquipment');
    assert.equal(f.fix.equipmentId, 'eq-sis');
    assert.equal(f.fix.name, 'SIS');
    assert.equal(f.fix.shortName, null, 'SIS 本來就夠短，不需要別稱');
  });

  test('INDIBA 是別稱那一格要補上 IN', () => {
    const [f] = go([legacy['eq-indiba']]);
    assert.equal(f.fix.name, 'INDIBA');
    assert.equal(f.fix.shortName, 'IN');
  });

  test('兩台一起', () => {
    assert.equal(go(Object.values(legacy)).length, 2);
  });

  test('已經是建議值就不再提', () => {
    assert.deepEqual(go(SEED.equipment), []);
  });

  test('她自己改過其中一格就不動 —— 那是一個決定', () => {
    assert.deepEqual(go([{ ...legacy['eq-sis'], name: '磁場' }]), []);
    assert.deepEqual(go([{ ...legacy['eq-sis'], shortName: '超磁' }]), []);
    assert.deepEqual(go([{ ...legacy['eq-indiba'], shortName: 'INDI' }]), []);
  });

  test('沒有要改的那幾台本來就不在名單裡', () => {
    assert.deepEqual(go([SEED.equipment.find((e) => e.id === 'eq-ilib')]), []);
    assert.deepEqual(go([SEED.equipment.find((e) => e.id === 'eq-laser')]), []);
  });

  test('她的主檔裡沒有那一台就不念，刪掉的也不念', () => {
    assert.deepEqual(go([]), []);
    assert.deepEqual(go([{ ...legacy['eq-sis'], deletedAt: 'x' }]), []);
  });

  test('這一種修正在畫面那兩張表上查得到', () => {
    const src = readFileSync(new URL('../public/js/ui/views/health.js', import.meta.url), 'utf8');
    assert.ok(src.includes("renameEquipment: 'equipmentNames'"), 'KIND_TO_CHECK 少了');
    assert.ok(src.includes('  equipmentNames: {'), 'FIX_COPY 少了');
  });
});

// ---------- 十七、診間清單跟建議的不一樣（2026-09-08）----------
describe('診間清單跟建議的不一樣', () => {
  const go = (rooms) => run({ master: { ...MASTER, rooms } }).checks
    .find((c) => c.id === 'roomList').findings;

  const seedRoom = (id) => SEED.rooms.find((r) => r.id === id);

  test('種子有、她沒有的那幾間列出來，而且建得起來', () => {
    const [f] = go(SEED.rooms.filter((r) => r.id !== 'room-vip2'));
    assert.equal(f.title, 'VIP2');
    assert.equal(f.fix.kind, 'applyRoom');
    assert.equal(f.fix.mode, 'add');
    assert.equal(f.fix.roomId, 'room-vip2');
    assert.equal(f.fix.data.shortName, 'vip2', '建起來的時候簡寫一起填好');
  });

  test('她自己刪掉的不算 —— 那是一個決定', () => {
    const rooms = SEED.rooms.map((r) =>
      (r.id === 'room-vip2' ? { ...r, deletedAt: 'x' } : r));
    assert.deepEqual(go(rooms), []);
  });

  test('新清單上沒有的那幾間列出來，而且刪得掉', () => {
    const withOld = [...SEED.rooms, { id: 'room-t7', name: '治7', type: '治療室' }];
    const [f] = go(withOld);
    assert.equal(f.title, '治7');
    assert.equal(f.fix.mode, 'drop');
    assert.equal(f.fix.roomId, 'room-t7');
  });

  test('她把那一間改名拿去當別的用了就不動', () => {
    const renamed = [...SEED.rooms, { id: 'room-t7', name: '儲藏室', type: '治療室' }];
    assert.deepEqual(go(renamed), []);
  });

  test('簡寫那一格是空的就補，她自己填過別的就不動', () => {
    const bare = SEED.rooms.map((r) =>
      (r.id === 'room-iv2' ? { ...r, shortName: null } : r));
    const [f] = go(bare);
    assert.equal(f.fix.mode, 'short');
    assert.equal(f.fix.shortName, '.2');

    const mine = SEED.rooms.map((r) =>
      (r.id === 'room-iv2' ? { ...r, shortName: '滴2' } : r));
    assert.deepEqual(go(mine), []);
  });

  test('治療室本來就沒有簡寫，不會被念', () => {
    assert.equal(seedRoom('room-t2').shortName, undefined);
    assert.deepEqual(go(SEED.rooms), []);
  });

  test('她自己加的診間一間都不會被列出來', () => {
    assert.deepEqual(go([...SEED.rooms, { id: 'room-mine', name: '我的房間', type: '治療室' }]), []);
  });

  // 一間種子診間都沒有的主檔不是「少了十七間」，是她自己從零建的一份清單。
  test('沒有一間種子診間的主檔不念「少了誰」', () => {
    assert.deepEqual(go([{ id: 'room-mine', name: '我的房間', type: '治療室' }]), []);
    assert.deepEqual(go([]), []);
  });
});

// ---------- 十八、來訪上還記著床位（2026-09-08）----------
describe('來訪上還記著床位', () => {
  const go = (visits) => run({ visits }).checks
    .find((c) => c.id === 'slotBeds').findings;

  test('有床位的那幾筆列出來，而且清得掉', () => {
    const [f] = go([visit({ slots: [slot({ roomId: 'r-iv8', bed: 'A' })] })]);
    assert.match(f.title, /客戶一/);
    assert.equal(f.fix.kind, 'clearBeds');
    assert.equal(f.fix.visitId, 'v1');
    assert.deepEqual(f.fix.slots.map((s) => s.bed), [null]);
  });

  test('清掉的只有床位，其餘欄位一個字都不動', () => {
    const [f] = go([visit({ slots: [slot({ roomId: 'r-iv8', bed: 'A' })] })]);
    assert.equal(f.fix.slots[0].roomId, 'r-iv8');
    assert.equal(f.fix.slots[0].courseId, 'c-recovery');
    assert.equal(f.fix.slots[0].startsAt, '10:30');
  });

  test('一筆來訪一列，不是一段一列', () => {
    const two = visit({
      slots: [slot({ roomId: 'r-iv8', bed: 'A' }), slot({ roomId: 'r-iv8', bed: 'B' })],
    });
    const [f] = go([two]);
    assert.equal(go([two]).length, 1);
    assert.match(f.detail, /A、B/);
  });

  test('沒有床位的不念，刪掉的來訪也不念', () => {
    assert.deepEqual(go([visit()]), []);
    assert.deepEqual(go([visit({ slots: [slot({ bed: 'A' })], deletedAt: 'x' })]), []);
  });

  test('這兩種修正在畫面那兩張表上查得到', () => {
    const src = readFileSync(new URL('../public/js/ui/views/health.js', import.meta.url), 'utf8');
    assert.ok(src.includes("applyRoom: 'roomList'"));
    assert.ok(src.includes("clearBeds: 'slotBeds'"));
    assert.ok(src.includes('  roomList: {'));
    assert.ok(src.includes('  slotBeds: {'));
  });
});

describe('來訪的狀態跟它的時段對不起來（ADR-0081）', () => {
  const withSlots = (status, slotStatuses) => visit({
    id: 'v-derived', status,
    slots: slotStatuses.map((st) => ({ entitlementId: 'ent-1', courseId: 'course-1', status: st })),
  });

  test('整筆說已確認、底下有一段還在等 → 報，而且說得出兩邊各是什麼', () => {
    const rows = findingsOf(
      run({ visits: [withSlots('confirmed', ['confirmed', 'pending_confirm'])] }),
      'visitStatusDerived',
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].fix.status, 'pending_confirm');
    assert.match(rows[0].detail, /已確認/);
  });

  test('對得起來的不報', () => {
    const rows = findingsOf(
      run({ visits: [withSlots('confirmed', ['confirmed', 'confirmed'])] }),
      'visitStatusDerived',
    );
    assert.deepEqual(rows, []);
  });

  test('一段都沒有 status 的舊來訪不報 —— 推出來的必然等於它自己', () => {
    const legacy = visit({
      id: 'v-legacy', status: 'confirmed',
      slots: [{ entitlementId: 'ent-1', courseId: 'course-1' }],
    });
    assert.deepEqual(findingsOf(run({ visits: [legacy] }), 'visitStatusDerived'), []);
  });
});

describe('器材沒有指到課程', () => {
  const go = (master) => run({ master }).checks
    .find((c) => c.id === 'equipmentCourse').findings;

  const stripped = (ids) => ({
    courses: SEED.courses,
    equipment: SEED.equipment.map((e) => (ids.includes(e.id)
      // eslint-disable-next-line no-unused-vars
      ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'courseId'))
      : e)),
  });

  test('那一格是空的就列出來，而且填得回去', () => {
    // 這就是她 2026-09-08 回報的根因：`courseId` 是 2026-09-06 才加的欄位，
    // 而 `loadSeed()` 只建不覆蓋 —— 既有資料庫上那幾台身上沒有它，
    // 於是四選一永遠推不出 ILIB，指派永遠卡在治療師。
    const rows = go(stripped(['eq-ilib']));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'ILIB');
    assert.equal(rows[0].fix.kind, 'setEquipmentCourse');
    assert.equal(rows[0].fix.equipmentId, 'eq-ilib');
    assert.equal(rows[0].fix.courseId, 'course-iv-laser');
  });

  test('好幾台都空的就一台一列', () => {
    assert.equal(go(stripped(['eq-ilib', 'eq-sis', 'eq-indiba'])).length, 3);
  });

  test('種子完整就一項都不報', () => {
    assert.deepEqual(go({ courses: SEED.courses, equipment: SEED.equipment }), []);
  });

  test('她自己指到別的課程就不動 —— 那是一個決定', () => {
    assert.deepEqual(go({
      courses: SEED.courses,
      equipment: SEED.equipment.map(
        (e) => (e.id === 'eq-ilib' ? { ...e, courseId: 'course-eecp' } : e),
      ),
    }), []);
  });

  test('她自己刪掉的那一台不再提', () => {
    assert.deepEqual(go({
      courses: SEED.courses,
      equipment: SEED.equipment.map((e) => (e.id === 'eq-ilib'
        ? { ...e, courseId: undefined, deletedAt: 'x' }
        : e)),
    }), []);
  });

  test('那個課程不存在就不報 —— 那是「整份主檔都是她自己建的」', () => {
    assert.deepEqual(go({
      courses: SEED.courses.filter((c) => c.id !== 'course-iv-laser'),
      equipment: stripped(['eq-ilib']).equipment,
    }), []);
  });
});

describe('課程的「做完要不要寫紀錄」跟建議的不一樣', () => {
  const go = (courses) => run({ master: { courses, equipment: SEED.equipment } })
    .checks.find((c) => c.id === 'courseRecord').findings;

  const without = (id) => SEED.courses.map((c) => (c.id === id
    // eslint-disable-next-line no-unused-vars
    ? Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'needsRecord'))
    : c));

  test('那一格從來沒設過就列出來，而且勾得回去', () => {
    const rows = go(without('course-rehab'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, '復健科醫師門診');
    assert.equal(rows[0].fix.kind, 'setNeedsRecord');
    assert.equal(rows[0].fix.courseId, 'course-rehab');
    assert.equal(rows[0].fix.needsRecord, true);
  });

  test('種子完整就一項都不報', () => {
    assert.deepEqual(go(SEED.courses), []);
  });

  test('**她自己關掉的不報** —— false 與「從來沒設過」在資料上分得出來', () => {
    assert.deepEqual(go(SEED.courses.map(
      (c) => (c.id === 'course-rehab' ? { ...c, needsRecord: false } : c),
    )), []);
  });

  test('她自己刪掉的課程不再提', () => {
    assert.deepEqual(go(without('course-rehab').map(
      (c) => (c.id === 'course-rehab' ? { ...c, deletedAt: 'x' } : c),
    )), []);
  });
});

describe('課程的名字跟建議的不一樣', () => {
  const go = (courses) => run({ master: { courses, equipment: SEED.equipment } })
    .checks.find((c) => c.id === 'courseNames').findings;

  // 2026-09-06 之前 ILIB 那個課程叫「靜脈」，而且兩格別稱都是空的
  const legacy = (over = {}) => SEED.courses.map((c) => (c.id === 'course-iv-laser'
    ? { ...c, name: '靜脈', shortName: null, lineName: null, ...over }
    : c));

  test('還停在「靜脈」那一代就列出來，三格一起改回去', () => {
    const rows = go(legacy());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, '靜脈');
    assert.equal(rows[0].fix.kind, 'renameCourse');
    assert.equal(rows[0].fix.name, 'ILIB');
    assert.equal(rows[0].fix.shortName, 'IL');
    assert.equal(rows[0].fix.lineName, '靜脈雷射');
  });

  test('種子完整就一項都不報', () => {
    assert.deepEqual(go(SEED.courses), []);
  });

  test('三格只要有一格是她自己改過的就不動', () => {
    assert.deepEqual(go(legacy({ shortName: '靜' })), [], '別稱改過了');
    assert.deepEqual(go(legacy({ name: '經皮靜脈雷射' })), [], '全名改過了');
    assert.deepEqual(go(legacy({ lineName: '雷射' })), [], 'LINE 名改過了');
  });

  test('她自己刪掉的課程不再提', () => {
    assert.deepEqual(go(legacy({ deletedAt: 'x' })), []);
  });
});

// 2026-09-09 之後兩個入口都會併進同一筆（ADR-0083），所以不會再長出新的。
// 這一項掃的是既有資料，而且**只列不修** —— 合併要搬時段、刪掉一筆、重算
// 次數、重推任務，而其中一筆可能是刻意分開的（上午那一場已經 done 了）。
describe('同一位客戶同一天有兩筆來訪', () => {
  const two = [
    { id: 'v1', customerId: 'c1', customerName: '王小明', date: '2026-09-15', status: 'confirmed', slots: [{ courseId: 'a' }] },
    { id: 'v2', customerId: 'c1', customerName: '王小明', date: '2026-09-15', status: 'done', slots: [{ courseId: 'b' }, { courseId: 'c' }] },
  ];

  test('兩筆就列出來，而且講得出總共幾段', () => {
    const rows = findingsOf(run({ visits: two }), 'sameDayVisits');
    assert.equal(rows.length, 1);
    assert.match(rows[0].title, /王小明・2026-09-15/);
    assert.match(rows[0].detail, /2 筆/);
    assert.match(rows[0].detail, /3 段/);
  });

  test('一天一筆不列', () => {
    assert.deepEqual(findingsOf(run({ visits: [two[0]] }), 'sameDayVisits'), []);
  });

  test('同一天但不同人不算', () => {
    const rows = findingsOf(run({ visits: [two[0], { ...two[1], customerId: 'c2' }] }), 'sameDayVisits');
    assert.deepEqual(rows, []);
  });

  test('已刪除的那一筆不算', () => {
    const rows = findingsOf(run({ visits: [two[0], { ...two[1], deletedAt: 'x' }] }), 'sameDayVisits');
    assert.deepEqual(rows, []);
  });

  test('只列不修 —— 合併掉會把已完成那一場拖回待確認', () => {
    assert.equal(findingsOf(run({ visits: two }), 'sameDayVisits')[0].fix, null);
  });
});
