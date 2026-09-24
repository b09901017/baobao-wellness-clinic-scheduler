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

import { readFileSync } from 'node:fs';

import { loadAppsScript } from './helpers/appsScriptStub.js';
import {
  syncBundle, customerReport, READONLY_NOTICE, SYNC_FORMAT,
} from '../public/js/domain/sheetReport.js';

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
        {
          id: 'v3', date: '2026-08-25', status: 'confirmed',
          slots: [{
            entitlementId: 'e3', courseName: '二返', startsAt: '14:00', endsAt: '14:30',
            roomId: 'r1', doctorId: 'd1',
          }],
        },
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
    master: {
      rooms: [{ id: 'r1', name: '治3' }],
      staff: [
        { id: 's1', name: '芝寧', role: '物理治療師' },
        { id: 'd1', name: '夏', role: '醫師' },
      ],
    },
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
    assert.match(reply.error, new RegExp(`只認得 ${SYNC_FORMAT}`));
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
    // 醫師和治療師各印各的：二返有醫師沒有治療師（ADR-0026）
    assert.match(text, /夏醫師/);
    assert.match(text, /時間不詳/, '匯入的來訪沒有時間，要寫時間不詳不是留白（ADR-0011）');
  });

  test('表頭與備註區有合併儲存格、有凍結列、有欄寬', () => {
    const { ss } = render();
    const sheet = ss.getSheetByName('客戶A');
    // FINISHED 在 K 欄，所以表至少寬到 M 欄，第一列要橫跨整張
    assert.ok(sheet.merges.includes('A1:M1'), `第一列要橫跨整張表，實際：${sheet.merges.join(' ')}`);
    assert.equal(sheet.frozenRows, 5);
    // **不凍結欄**。表頭三列橫跨整張表，凍結欄的線會穿過那些合併儲存格，
    // Google 會直接丟例外（issues/01）。要往右捲還看得到療程項目那一欄的話，
    // 得先把表頭改成不合併 —— 那是另一個決定，不要偷偷加回來。
    assert.equal(sheet.frozenCols, 0);
    assert.ok(sheet.widths.size > 0);
    assert.ok(sheet.fonts.size > 0, '字體要設，不然中英數字寬不一致');
  });

  test('凍結線穿過合併儲存格時替身會擋下來', () => {
    // 這一條測的是替身本身。沒有它，issues/01 那個例外會再一次全綠通過 ——
    // 那個 bug 就是這樣活到第一次真的部署才被發現的。
    const { ss } = render();
    const sheet = ss.getSheetByName('客戶A');
    assert.throws(() => sheet.setFrozenColumns(1), /無法凍結僅包含部分合併儲存格的欄/);
    // 落在合併範圍外的凍結照樣過得去。表頭的合併都是水平的（一列之內），
    // 所以水平的凍結線本來就切不到 —— 這正是凍結列留得住、凍結欄留不住的原因。
    assert.doesNotThrow(() => sheet.setFrozenColumns(0));
    assert.doesNotThrow(() => sheet.setFrozenRows(5));

    // 列的那一半也要擋。這張表上沒有跨列的合併，所以自己做一個。
    sheet.addMerge(8, 1, 3, 2);
    assert.throws(() => sheet.setFrozenRows(9), /無法凍結僅包含部分合併儲存格的列/);
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

// ---------- 營養品那一區（格式 3 起）----------
//
// 這一區是 2026-09-01 之前**整段沒有測試**的：`products`／`營養品` 在這一支
// 裡一次都沒出現過。而它是她每天看的那張表上最新的一區，`.gs` 又是這個 repo
// 裡唯一跑在別人機器上的程式碼 —— 排錯了要等她打開試算表才會發現。
//
// 營養品以前混在矩陣裡，那四個數字欄印的是月數（「應有 2 已完成 0 已排未上 0
// 剩餘 2」沒有一個看得懂），所以格式 3 把它獨立成一區（ADR-0057、0059）。

describe('營養品那一區', () => {
  const withProducts = (extra = []) => syncBundle({
    customers: [{ id: 'c1', name: '客戶A' }],
    entitlementsBy: {
      c1: [
        { id: 'e1', label: '復能', totalQty: 12 },
        {
          id: 'p1', type: 'product', label: '夜態美＋速膳淨', totalQty: 2, amountTwd: 12000,
          items: [{ productId: 'x1', name: '夜態美' }, { productId: 'x2', name: '速膳淨' }],
          deliveries: [{ at: '2026-08-20', productIds: ['x1'] }],
        },
        ...extra,
      ],
    },
    visitsBy: {
      c1: [{
        id: 'v1', date: '2026-08-01', status: 'done',
        slots: [{ entitlementId: 'e1', courseName: '復能' }],
      }],
    },
    tasksBy: { c1: [] },
    today: '2026-08-25',
    generatedAt: '2026/8/25',
  });

  /** 那張分頁上「營養品」抬頭在第幾列。找不到回 -1。 */
  const productRowOf = (sheet) => {
    for (let r = 1; r <= 60; r += 1) if (sheet.at(`A${r}`) === '營養品') return r;
    return -1;
  };

  const render = (b) => {
    const app = loadAppsScript();
    const reply = app.post({ token: 'secret', bundle: b });
    assert.equal(reply.ok, true, reply.error);
    return app.ss.getSheetByName('客戶A');
  };

  test('抬頭與五個欄位標題照 syncBundle 送過去的排', () => {
    const sheet = render(withProducts());
    const top = productRowOf(sheet);
    assert.ok(top > 0, '找不到「營養品」那一段');
    assert.deepEqual(
      ['A', 'B', 'C', 'D', 'E'].map((c) => sheet.at(`${c}${top + 1}`)),
      ['品名', '金額', '幾個月', '哪幾種', '給了沒'],
    );
  });

  test('每一格的值跟 syncBundle 送過去的一模一樣 —— .gs 一個字都不重算', () => {
    const b = withProducts();
    const sheet = render(b);
    const top = productRowOf(sheet);
    const sent = b.sheets[0].products[0];

    assert.equal(sheet.at(`A${top + 2}`), sent.label);
    assert.equal(sheet.at(`B${top + 2}`), sent.amount);
    assert.equal(sheet.at(`C${top + 2}`), sent.months);
    assert.equal(sheet.at(`D${top + 2}`), sent.items.join('、'));
    assert.match(String(sheet.at(`E${top + 2}`)), /還差 速膳淨$/);
  });

  // 同一份報表因為走哪條路而長得不同，她會以為其中一條壞了
  //（`domain/sheetReport.js` 的檔頭）。以前「手動貼上」印 `8/20`、
  // 「自動推送」印 `2026-08-20`。
  test('「給了沒」那一格，手動貼上與自動推送印出同一串字', () => {
    const b = withProducts();
    const sheet = render(b);
    const pushed = String(sheet.at(`E${productRowOf(sheet) + 2}`));

    const pasted = customerReport({
      customer: { id: 'c1', name: '客戶A' },
      entitlements: [{
        id: 'p1', type: 'product', label: '夜態美＋速膳淨', totalQty: 2, amountTwd: 12000,
        items: [{ productId: 'x1', name: '夜態美' }, { productId: 'x2', name: '速膳淨' }],
        deliveries: [{ at: '2026-08-20', productIds: ['x1'] }],
      }],
      visits: [],
    }).rows.find((r) => r[0] === '夜態美＋速膳淨');

    assert.equal(pushed, pasted[4]);
    assert.match(pushed, /^8\/20　/, '日期照她舊表的寫法，不是 ISO');
  });

  test('還沒給完的那一列標起來，給完的不標', () => {
    const sheet = render(withProducts([{
      id: 'p2', type: 'product', label: '膠原', totalQty: 1, amountTwd: 3000,
      items: [{ productId: 'x3', name: '膠原' }],
      deliveries: [{ at: '2026-08-21', productIds: ['x3'] }],
    }]));
    const top = productRowOf(sheet);
    // 借「已排未上」那個琥珀色，不開新色（同 ADR-0039 的判斷）
    assert.ok(sheet.backgrounds.get(`A${top + 2}`), '沒給完的那一列要有底色');
    assert.equal(
      sheet.backgrounds.get(`A${top + 3}`) ?? null, null, '都給了的那一列不要標',
    );
  });

  // 大部分客戶不買，而一個永遠空著的區塊只是在每次看報表時提醒她那件事不存在。
  test('一筆營養品都沒有就整段不畫', () => {
    const plain = syncBundle({
      customers: [{ id: 'c1', name: '客戶A' }],
      entitlementsBy: { c1: [{ id: 'e1', label: '復能', totalQty: 12 }] },
      visitsBy: { c1: [] },
      today: '2026-08-25',
    });
    assert.equal(productRowOf(render(plain)), -1);
  });

  // 營養品是一筆排不進來訪的額度（ADR-0057）：它有那一列，但不進合計 ——
  // 那一行寫的是「剩餘 N 次」，而兩罐夜態美不是兩次。
  test('營養品不進矩陣，也不進合計', () => {
    const b = withProducts();
    const sheet = render(b);

    assert.deepEqual(b.sheets[0].rows.map((r) => r.label), ['復能'], '矩陣只有排得進來訪的');
    assert.equal(b.sheets[0].totals.total, 12, '合計不含營養品的月數');
    assert.equal(String(sheet.at('C2')).includes('應有 12'), true);
  });

  // 營養品那一區底下還有備註、來訪紀錄、TODO／FINISHED —— renderProducts()
  // 回傳的下一列位置算錯的話，那幾塊會被壓到或疊在一起。
  test('底下的備註、來訪紀錄、TODO 都還在，而且沒有被壓到', () => {
    const sheet = render(withProducts());
    const top = productRowOf(sheet);
    const labels = [];
    for (let r = top; r <= 60; r += 1) {
      const v = sheet.at(`A${r}`);
      if (v) labels.push(String(v));
    }
    for (const want of ['備註', '來訪紀錄', 'TODO（還沒做的）']) {
      assert.ok(labels.includes(want), `營養品底下少了「${want}」：${labels.join(' / ')}`);
    }
    assert.ok(
      labels.indexOf('備註') > labels.indexOf('品名'),
      '備註要排在營養品那一區底下',
    );
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

// ---------- 兩側的格式版本 ----------

test('`.gs` 的 SUPPORTED_FORMAT 要跟 app 的 SYNC_FORMAT 一樣', () => {
  // 對不上的症狀最糟：app 照樣推、`.gs` 整包拒收，而畫面上看起來跟推好了
  // 一模一樣（失敗只留痕跡不跳彈窗，見 data/sheetSync.js 的 noteFailure）。
  // 她要幾天後打開試算表才會發現數字停在某一天。
  //
  // 升版了就一定要**回 Google 試算表把 `.gs` 重新貼一次並重新部署**。
  const src = readFileSync(new URL('../sheets/readonly-report.gs', import.meta.url), 'utf8');
  const m = src.match(/var SUPPORTED_FORMAT = (\d+);/);
  assert.ok(m, '`.gs` 裡找不到 SUPPORTED_FORMAT');
  assert.equal(
    Number(m[1]),
    SYNC_FORMAT,
    '改了 SYNC_FORMAT 就要一起改 `.gs`，而且她要回試算表重新部署那份指令碼',
  );
});

// ---------- 同名客戶（prelaunch-audit-2026-09-23/issues/06） ----------
//
// 分頁名就是客戶名。新增頁對同名只提醒、照樣存得下去（ADR-0102），於是第二位的
// resetSheet() 找到剛畫好的那一張、整張清掉重畫 —— 回報卻是 `sheets: 2`。

describe('同名的客戶各自一張分頁', () => {
  const twins = (customers) => syncBundle({
    customers,
    entitlementsBy: {}, visitsBy: {}, tasksBy: {},
    today: '2026-08-10', generatedAt: 'x', master: {},
  });

  test('兩位同名 → 兩張分頁，推第二次兩張都還在', () => {
    const b = twins([
      { id: 'aaaa1111', name: '王小明', notes: '病歷號 1234' },
      { id: 'bbbb2222', name: '王小明' },
      { id: 'cccc3333', name: '客戶A' },
    ]);
    const app = loadAppsScript();
    assert.equal(app.post({ token: 'secret', bundle: b }).ok, true);
    const names = () => app.ss.getSheets().map((s) => s.name).filter((n) => !n.startsWith('_')).sort();
    const first = names();
    assert.equal(first.filter((n) => n.startsWith('王小明')).length, 2, first.join('、'));
    assert.ok(first.includes('客戶A'), '只有一位叫那個名字：分頁名一個字都不變');

    assert.equal(app.post({ token: 'secret', bundle: b }).ok, true);
    assert.deepEqual(names(), first, '尾巴每次推都一樣，不會被當成過期的刪掉');
  });

  test('尾巴先用病歷號，沒有就用 id 的前幾碼', () => {
    const b = twins([
      { id: 'aaaa1111', name: '王小明', notes: '病歷號 1234' },
      { id: 'bbbb2222', name: '王小明' },
    ]);
    assert.deepEqual(b.sheets.map((s) => s.name).sort(), ['王小明（1234）', '王小明（bbbb22）'].sort());
  });
});

// ---------- 格式 6（`.scratch/asks-2026-09-24-evening/issues/03、04`） ----------

describe('格式 6：來訪紀錄一段一行、買過什麼', () => {
  const render = (b) => {
    const app = loadAppsScript();
    const reply = app.post({ token: 'secret', bundle: b });
    assert.equal(reply.ok, true, reply.error);
    return app.ss.getSheetByName('客戶A');
  };
  const rowOf = (sheet, text) => {
    for (let r = 1; r <= 90; r += 1) if (sheet.at(`A${r}`) === text) return r;
    return -1;
  };

  test('格式 5 的包裹整包拒收 —— 她沒重貼 .gs 的話要講出來，不是半套渲染', () => {
    const { post } = loadAppsScript();
    assert.equal(post({ token: 'secret', bundle: bundle({ format: 5 }) }).ok, false);
  });

  test('來訪紀錄：日期自己一行，底下每一段一行、前面是那一段的狀態', () => {
    // 她：「能不能就是第一行是日期，然後換行後在寫每一段，這樣感覺就可以對齊了」
    const b = bundle();
    const sheet = render(b);
    const day = b.sheets[0].log[0];
    const r = rowOf(sheet, day.label);
    assert.ok(r > 0, `日期「${day.label}」要自己一行`);
    assert.equal(sheet.at(`A${r + 1}`), '　已完成　09:15–10:15　復能　治3　芝寧');
    assert.equal(sheet.at(`A${r + 2}`), '　已完成　時間不詳　復能');
    // 下一天緊接著，日期一樣自己一行
    assert.equal(sheet.at(`A${r + 3}`), b.sheets[0].log[1].label);
  });

  test('買過什麼：一天一行，排在營養品上面', () => {
    const b = syncBundle({
      customers: [{ id: 'c1', name: '客戶A' }],
      entitlementsBy: {
        c1: [
          { id: 'e1', label: 'ILIB(60)', totalQty: 12, purchasedAt: '2026-09-01' },
          { id: 'p1', type: 'product', label: '夜態美', totalQty: 2, items: [{ productId: 'x1', name: '夜態美' }] },
        ],
      },
      visitsBy: { c1: [] },
      today: '2026-09-24',
    });
    const sheet = render(b);
    const head = rowOf(sheet, '買過什麼');
    assert.ok(head > 0, '要有「買過什麼」那一段');
    assert.equal(sheet.at(`A${head + 1}`), '0901　ILIB(60)x12');
    assert.ok(rowOf(sheet, '營養品') > head, '營養品排在它底下');
  });

  test('一筆都沒買過：那一段整個不畫', () => {
    const b = syncBundle({
      customers: [{ id: 'c1', name: '客戶A' }], entitlementsBy: { c1: [] }, visitsBy: { c1: [] }, today: '2026-09-24',
    });
    assert.equal(rowOf(render(b), '買過什麼'), -1);
  });
});
