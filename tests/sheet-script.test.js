// 唯讀報表的 Apps Script。
//
// `sheets/readonly-report.gs` 跑在 Google 的伺服器上，是這個專案裡唯一沒有測試的
// 程式碼 —— 而它負責的是「她每天看的那張表長什麼樣」以及「那張表鎖不鎖得住」。
//
// 這一支用替身把 Apps Script 的 API 做出來（tests/helpers/appsScriptStub.js），
// 讓那 400 多行真的跑一遍。抓得到的是邏輯錯與 API 用錯；抓不到 Google 那一側的
// 行為差異，那些只有真的部署才知道。替身的檔頭寫得更清楚。
//
// 數字一個都不在 .gs 裡算 —— 這裡刻意拿 domain/sheetReport.js 的 syncBundle()
// 產生輸入，所以「送過去的數字」與「印出來的數字」是同一組，對不起來就是 .gs 排錯了。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { loadAppsScript } from './helpers/appsScriptStub.js';
import { syncBundle, READONLY_NOTICE } from '../public/js/domain/sheetReport.js';

const bundle = (overrides = {}) => ({
  ...syncBundle({
    customers: [{ id: 'c1', name: '客戶A', source: '0522 顧客會-8', flags: ['體內金屬'], notes: '目前只要SIS' }],
    entitlementsBy: {
      c1: [
        { id: 'e1', label: '復能', totalQty: 12 },
        { id: 'e2', label: '靜脈', totalQty: 4 },
      ],
    },
    visitsBy: {
      c1: [
        {
          id: 'v1', date: '2026-08-01', status: 'done',
          slots: [
            { entitlementId: 'e1', courseName: '復能', startsAt: '09:15', endsAt: '10:15', roomId: 'r1', therapistId: 's1' },
            { entitlementId: 'e1', courseName: '復能', startsAt: null, endsAt: null },
          ],
        },
        { id: 'v2', date: '2026-08-20', status: 'confirmed', slots: [{ entitlementId: 'e2', courseName: '靜脈' }] },
      ],
    },
    tasksBy: {
      c1: [
        { id: 't1', customerId: 'c1', visitId: 'v2', kind: 'Abovee', dueDate: '2026-08-19', done: false },
        { id: 't2', customerId: 'c1', visitId: 'v1', kind: 'Examine', dueDate: '2026-07-31', done: true, doneAt: '2026-07-30T02:00:00.000Z' },
      ],
    },
    today: '2026-08-10',
    generatedAt: '2026/8/18 下午7:15',
    master: { rooms: [{ id: 'r1', name: '治3' }], staff: [{ id: 's1', name: '芝寧' }] },
  }),
  ...overrides,
});

describe('收件口', () => {
  test('密鑰不對就整包退回，一格都不寫', () => {
    const { post, ss } = loadAppsScript({ token: 'secret' });
    assert.deepEqual(post({ token: '猜的', bundle: bundle() }), { ok: false, error: '密鑰不對' });
    assert.equal(ss.getSheets().length, 0);
  });

  test('指令碼還沒設定密鑰時不會放行', () => {
    const { post } = loadAppsScript({ token: null });
    assert.equal(post({ token: 'anything', bundle: bundle() }).ok, false);
  });

  test('資料格式版本對不上就整包拒絕，不半套渲染', () => {
    // 半套渲染最糟：她會看到一張只更新了一半的表，而且看不出是哪一半。
    const { post, ss } = loadAppsScript();
    const reply = post({ token: 'secret', bundle: bundle({ format: 99 }) });
    assert.equal(reply.ok, false);
    assert.match(reply.error, /只認得 2/);
    assert.equal(ss.getSheets().length, 0);
  });

  test('拿不到鎖就退回，不會兩份同時寫成一半一半', () => {
    const { post } = loadAppsScript({ lock: false });
    assert.equal(post({ token: 'secret', bundle: bundle() }).ok, false);
  });
});

describe('渲染', () => {
  const render = () => {
    const app = loadAppsScript();
    const reply = app.post({ token: 'secret', bundle: bundle() });
    assert.equal(reply.ok, true, reply.error);
    return app;
  };

  test('一位客戶一張分頁，沒有總表（2026-08-20）', () => {
    const { ss } = render();
    assert.deepEqual(ss.getSheets().map((s) => s.getName()).sort(), ['_data', '客戶A'].sort());
    assert.equal(ss.getSheetByName('_data').hidden, true, '原始資料那張要藏起來');
  });

  test('每張分頁第一列都是那句提醒', () => {
    const { ss } = render();
    assert.equal(ss.getSheetByName('客戶A').at('A1'), READONLY_NOTICE);
  });

  test('矩陣的數字跟 syncBundle 送過去的一模一樣', () => {
    // .gs 一個數字都不重算。這一條就是那個約定的守門員。
    const { ss } = render();
    const sheet = ss.getSheetByName('客戶A');
    const data = bundle().sheets[0];

    assert.deepEqual(
      ['A5', 'B5', 'C5', 'D5', 'E5'].map((a) => sheet.at(a)),
      ['療程項目', '應有', '已完成', '已排未上', '剩餘'],
    );
    assert.equal(sheet.at('A6'), '復能');
    assert.equal(sheet.at('B6'), data.rows[0].total);
    assert.equal(sheet.at('C6'), data.rows[0].done);
    assert.equal(sheet.at('D6'), data.rows[0].booked);
    assert.equal(sheet.at('E6'), data.rows[0].remaining);
    assert.equal(sheet.at('F6'), '✓2', '同一天同一份額度用兩次要看得出來');
  });

  test('日期欄照 syncBundle 的順序排在第 F 欄以後', () => {
    const { ss } = render();
    const sheet = ss.getSheetByName('客戶A');
    const labels = bundle().sheets[0].dateLabels;
    assert.equal(sheet.at('F5'), labels[0]);
    assert.equal(sheet.at('G5'), labels[1]);
  });

  test('備註區放回她手寫的那一段，底下接來訪紀錄', () => {
    const { ss } = render();
    const text = [...ss.getSheetByName('客戶A').cells.values()].join('\n');
    assert.match(text, /永久限制：體內金屬/);
    assert.match(text, /目前只要SIS/);
    assert.match(text, /來訪紀錄/);
    assert.match(text, /治3/);
    assert.match(text, /芝寧/);
    assert.match(text, /時間不詳/, '匯入的來訪沒有時間，要寫時間不詳不是留白（ADR-0011）');
  });

  test('表頭與備註區有合併儲存格、有凍結、有欄寬', () => {
    const { ss } = render();
    const sheet = ss.getSheetByName('客戶A');
    // FINISHED 在 K 欄，所以表至少寬到 M 欄，第一列要橫跨整張
    assert.ok(sheet.merges.includes('A1:M1'), `第一列要橫跨整張表，實際：${sheet.merges.join(' ')}`);
    assert.equal(sheet.frozenRows, 5);
    assert.equal(sheet.frozenCols, 1);
    assert.ok(sheet.widths.size > 0);
    assert.ok(sheet.fonts.size > 0, '字體要設，不然中英數字寬不一致');
  });

  test('TODO 與 FINISHED 並排，位置照舊表（A 欄與 K 欄）', () => {
    const { ss } = render();
    const sheet = ss.getSheetByName('客戶A');
    const cells = [...sheet.cells.entries()];

    const todoHead = cells.find(([, v]) => String(v).indexOf('TODO') === 0);
    const finHead = cells.find(([, v]) => String(v).indexOf('FINISHED') === 0);
    assert.ok(todoHead, 'TODO 那一塊要在');
    assert.ok(finHead, 'FINISHED 那一塊要在');
    assert.match(todoHead[0], /^A/, `TODO 要在 A 欄，實際：${todoHead[0]}`);
    assert.match(finHead[0], /^K/, `FINISHED 要在 K 欄，實際：${finHead[0]}`);
    // 同一列並排
    assert.equal(todoHead[0].slice(1), finHead[0].slice(1));

    const text = [...sheet.cells.values()].join('\n');
    assert.match(text, /Abovee/, '還沒做的要列出來');
    assert.match(text, /Examine/, '做完的也要列出來');
  });

  test('沒有任務時兩塊都寫「沒有」，不要留白', () => {
    // 留白看起來像表壞了，而她不會知道是「沒有任務」還是「沒推成功」
    const empty = syncBundle({
      customers: [{ id: 'c1', name: '客戶A' }],
      entitlementsBy: { c1: [{ id: 'e1', label: '復能', totalQty: 2 }] },
      visitsBy: { c1: [] },
      today: '2026-08-10',
    });
    const app = loadAppsScript();
    assert.equal(app.post({ token: 'secret', bundle: empty }).ok, true);
    const text = [...app.ss.getSheetByName('客戶A').cells.values()].join('\n');
    assert.match(text, /（沒有）/);
  });

  test('二返註記落在那次健檢被勾起來的那一欄', () => {
    const withFollowup = syncBundle({
      customers: [{ id: 'c1', name: '客戶A' }],
      entitlementsBy: {
        c1: [
          { id: 'e1', label: '復能', totalQty: 12 },
          { id: 'e-chk', label: '健檢', courseId: 'course-checkup', totalQty: 1 },
          { id: 'e-fu', label: '二返', courseId: 'course-followup', followupForEntitlementId: 'e-chk', totalQty: 1 },
        ],
      },
      visitsBy: {
        c1: [
          { id: 'v1', date: '2026-08-01', status: 'done', slots: [{ entitlementId: 'e1' }] },
          { id: 'v2', date: '2026-08-05', status: 'done', slots: [{ entitlementId: 'e-chk' }] },
          { id: 'v3', date: '2026-08-12', status: 'confirmed', slots: [{ entitlementId: 'e-fu' }] },
        ],
      },
      today: '2026-08-10',
      master: {
        courses: [
          { id: 'course-checkup', name: '健檢', followupCourseId: 'course-followup' },
          { id: 'course-followup', name: '二返' },
        ],
      },
    });

    const app = loadAppsScript();
    assert.equal(app.post({ token: 'secret', bundle: withFollowup }).ok, true);
    const sheet = app.ss.getSheetByName('客戶A');

    // 日期欄 8/1、8/5、8/12 → F、G、H。健檢在 8/5 那一欄，所以註記要在 G 欄。
    // 用完整字串找，不要用「開頭是二返」—— 矩陣裡本來就有一列叫「二返」。
    const hit = [...sheet.cells.entries()].find(([, v]) => v === '8/12 二返');
    assert.ok(hit, `二返註記要寫出來，實際有的：${[...sheet.cells.values()].join('｜')}`);
    assert.match(hit[0], /^G/, `要落在健檢那一欄（G），實際：${hit[0]}`);
  });

  test('不是我們產生的同名分頁不清空，而且要回報跳過了誰', () => {
    // 她的分頁是用客戶名字命名的。網址填到舊試算表時，
    // 沒有這條檢查就會把她手寫的東西整張清掉。
    const app = loadAppsScript();
    const mine = app.ss.insertSheet('客戶A');
    mine.getRange(1, 1).setValue('這是我自己記的東西');

    const reply = app.post({ token: 'secret', bundle: bundle() });
    assert.equal(reply.ok, true);
    assert.deepEqual(reply.skipped, ['客戶A']);
    assert.equal(mine.at('A1'), '這是我自己記的東西', '一個字都不該被動到');
    assert.equal(reply.sheets, 0);
  });

  test('自己產生過的分頁照樣清空重畫', () => {
    const app = loadAppsScript();
    assert.equal(app.post({ token: 'secret', bundle: bundle() }).ok, true);
    const again = app.post({ token: 'secret', bundle: bundle() });
    assert.equal(again.ok, true);
    assert.deepEqual(again.skipped, []);
    assert.equal(again.sheets, 1);
  });

  test('日期多到超過預設欄數也寫得進去', () => {
    // 分頁預設 26 欄。一位客戶一年來三十幾次就會爆掉，而那是正常的客戶。
    const dates = Array.from({ length: 40 }, (_, i) => `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`);
    const wide = syncBundle({
      customers: [{ id: 'c1', name: '客戶A' }],
      entitlementsBy: { c1: [{ id: 'e1', label: '復能', totalQty: 99 }] },
      visitsBy: {
        c1: [...new Set(dates)].map((date, i) => ({
          id: `v${i}`, date, status: 'done', slots: [{ entitlementId: 'e1', courseName: '復能' }],
        })),
      },
      today: '2026-08-10',
    });

    const app = loadAppsScript();
    const reply = app.post({ token: 'secret', bundle: wide });
    assert.equal(reply.ok, true, reply.error);
    assert.ok(app.ss.getSheetByName('客戶A').getMaxColumns() >= 5 + wide.sheets[0].dates.length);
  });
});

describe('上鎖', () => {
  test('每一張分頁都保護起來，而且不是只跳警告', () => {
    // setWarningOnly 只會問一句「你確定嗎」然後照樣讓人改，那等於沒鎖。
    const app = loadAppsScript();
    app.post({ token: 'secret', bundle: bundle() });

    for (const sheet of app.ss.getSheets()) {
      const [p] = sheet.getProtections();
      assert.ok(p, `${sheet.getName()} 沒有被保護`);
      assert.equal(p.warningOnly, false);
      assert.equal(p.domainEdit, false);
      assert.deepEqual(p.removed, ['someone-else@example.com'], '除了擁有者以外都要移掉');
    }
  });

  test('app 裡刪掉的客戶，這裡的分頁也要跟著消失', () => {
    const app = loadAppsScript({ sheetNames: ['客戶A', '客戶B'] });
    // 「客戶B」是上一次同步產生的，第一列有那句提醒
    app.ss.getSheetByName('客戶B').set(1, 1, READONLY_NOTICE);

    app.post({ token: 'secret', bundle: bundle() });
    assert.equal(app.ss.getSheetByName('客戶B'), null);
  });

  test('她自己開的分頁不可以被刪掉', () => {
    // 這支指令碼沒有資格判斷她在旁邊算的那張重不重要。
    const app = loadAppsScript({ sheetNames: ['我自己算的'] });
    app.ss.getSheetByName('我自己算的').set(1, 1, '隨手記');

    app.post({ token: 'secret', bundle: bundle() });
    assert.ok(app.ss.getSheetByName('我自己算的'), '沒有那句提醒的分頁不可以被動');
    assert.equal(app.ss.getSheetByName('我自己算的').at('A1'), '隨手記');
  });
});

describe('手動編輯', () => {
  test('改了就還原，並且說明為什麼', () => {
    const app = loadAppsScript({ sheetNames: ['客戶A'] });
    const sheet = app.ss.getSheetByName('客戶A');
    const range = sheet.getRange(6, 2);
    range.setValue('我改了');

    app.context.onEdit({
      range,
      oldValue: '12',
      source: { getActiveSheet: () => sheet },
    });

    assert.equal(sheet.at('B6'), '12', '要還原成改之前的值');
    assert.match(app.ss.toasts[0].message, /請回 app 修改/);
  });

  test('原始資料那張不還原 —— 那是指令碼自己寫的', () => {
    const app = loadAppsScript({ sheetNames: ['_data'] });
    const sheet = app.ss.getSheetByName('_data');
    const range = sheet.getRange(2, 1);
    range.setValue('新的');

    app.context.onEdit({ range, oldValue: '舊的', source: { getActiveSheet: () => sheet } });
    assert.equal(sheet.at('A2'), '新的');
  });
});
