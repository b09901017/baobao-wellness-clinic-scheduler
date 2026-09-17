// 稽核紀錄的翻譯。SPEC 第 6.2 節。
//
// 這一支盯的是「差異表不能騙人」：沒動到的欄位不可以被報成改動，
// 動到的欄位一定要出現。出事時她是靠這張表判斷資料怎麼變成現在這樣的。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  describeAction, describeTarget, fieldLabel, changedFields, formatValue,
  describeEvent, describeParts, joinParts, customerIdOf, subjectOf, groupByDay,
} from '../public/js/domain/audit.js';

describe('動作與目標', () => {
  test('翻成人話', () => {
    assert.equal(describeAction('visits.create'), '新增來訪');
    // repo 寫的是完整路徑，子集合要取最後一段才對得出名字
    assert.equal(describeAction('customers/x/entitlements.update'), '修改額度');
    assert.equal(describeAction('config/app/courses.create'), '新增課程');
    assert.equal(describeAction('tasks.softDelete'), '刪除任務');
  });

  test('不認得的原樣顯示，不要吞掉', () => {
    assert.equal(describeAction('weird.thing'), 'thingweird');
    assert.equal(describeAction(null), '異動資料');
  });

  test('目標看路徑倒數第二段，子集合才對得出來', () => {
    assert.equal(describeTarget('visits/v1'), '來訪');
    assert.equal(describeTarget('customers/c1'), '客戶');
    assert.equal(describeTarget('customers/c1/entitlements/e1'), '額度');
    assert.equal(describeTarget('customers/c1/availability/a1'), '本輪可用性');
    assert.equal(describeTarget('config/app/courses/c1'), '課程');
  });

  test('欄位名用 CONTEXT.md 的詞，沒列到的原樣顯示', () => {
    assert.equal(fieldLabel('doneCount'), '已完成次數');
    assert.equal(fieldLabel('somethingNew'), 'somethingNew');
  });
});

describe('改了什麼', () => {
  test('以 after 的鍵為準 —— 這次沒動到的欄位不可以被報成改動', () => {
    const fields = changedFields({
      before: { name: '客戶一', phone: '0900', notes: '沒變' },
      after: { phone: '0911' },
    });
    assert.deepEqual(fields.map((f) => f.key), ['phone']);
    assert.equal(fields[0].before, '0900');
    assert.equal(fields[0].after, '0911');
    assert.equal(fields[0].label, '電話');
  });

  test('值一樣就不算改動', () => {
    assert.deepEqual(changedFields({ before: { a: 1 }, after: { a: 1 } }), []);
  });

  test('時間戳這類每次都變的欄位不列出來，免得淹掉真正的改動', () => {
    const fields = changedFields({
      before: { status: 'confirmed' },
      after: { status: 'done', updatedAt: 'x', createdAt: 'y', createdBy: 'z' },
    });
    assert.deepEqual(fields.map((f) => f.key), ['status']);
  });

  test('陣列與物件比內容，不比參照', () => {
    assert.deepEqual(changedFields({ before: { flags: ['體內金屬'] }, after: { flags: ['體內金屬'] } }), []);
    assert.equal(changedFields({ before: { flags: [] }, after: { flags: ['體內金屬'] } }).length, 1);
  });

  test('新增沒有 before，整份都算改動', () => {
    const fields = changedFields({ before: null, after: { name: '客戶一', priority: 3 } });
    assert.deepEqual(fields.map((f) => f.key).sort(), ['name', 'priority']);
  });

  test('after 不是物件時回空陣列，不要爆', () => {
    assert.deepEqual(changedFields({ after: null }), []);
    assert.deepEqual(changedFields({}), []);
    assert.deepEqual(changedFields(null), []);
  });
});

describe('值怎麼顯示', () => {
  test('空值、布林、陣列、物件各自有講法', () => {
    assert.equal(formatValue(null), '（空的）');
    assert.equal(formatValue(''), '（空字串）');
    assert.equal(formatValue(true), '是');
    assert.equal(formatValue(false), '否');
    assert.equal(formatValue([1, 2, 3]), '3 筆');
    assert.equal(formatValue([]), '（沒有）');
    assert.equal(formatValue({ a: 1 }), '（一組資料）');
    assert.equal(formatValue({ seconds: 1 }), '（時間）');
    assert.equal(formatValue('done'), 'done');
    assert.equal(formatValue(0), '0');
  });
});

// ---------- 一則稽核 → 一句話 ----------
//
// 她打開這一頁是在問「我剛剛做了什麼」或「這筆怎麼變成這樣的」。
// 原本每一列印的是 `customers/AbC123/entitlements/XyZ789` 加一排
// `（一組資料）`，兩個問題都答不出來。
//
// 2026-09-01 又收一格：句子要講得出**誰、哪一天、哪一項**。她的原話是
// 「壓表不要寫新增某某的來訪，要寫新增某某.日期.項目」，而且勾隨手記那一條
// 印出了「勾掉某某的某某」這種疊字。這一段盯的就是那三件事。

describe('一句話講完一則稽核', () => {
  const ev = (action, before, after, targetPath = 'visits/v1') =>
    ({ action, targetPath, before, after });

  const slots = [{ courseName: '復能' }, { courseName: '營養針' }];
  const visit = (extra = {}) =>
    ({ customerName: '客戶A', date: '2026-09-14', slots, ...extra });

  // 額度與本輪可用性身上沒有名字（只有路徑上有 id），所以名字由呼叫端解析。
  const nameOf = (id) => ({ c1: '客戶A' })[id] ?? null;

  test('壓表講得出誰、哪一天、哪幾項', () => {
    const line = describeEvent(ev('visits.create', null, visit({ status: 'pending_confirm' })));
    assert.equal(line, '新增 客戶A・9/14(一)・復能、營養針');
  });

  test('狀態變了就講變成什麼 —— 次數是跟著它扣的', () => {
    const line = describeEvent(ev('visits.update',
      visit({ status: 'confirmed' }),
      { status: 'done' }));
    assert.equal(line, '客戶A・9/14(一)・復能、營養針・改成已完成');
  });

  // 狀態的字從 domain/visits.js 的 STATUS_VIEW 來，不在這裡再寫一份
  // （CLAUDE.md：來訪狀態的標籤只改那一支）。
  test('狀態的字跟日曆、客戶詳情用的是同一份', () => {
    const line = describeEvent(ev('visits.update',
      visit({ status: 'pending_confirm' }),
      { status: 'no_show' }));
    assert.match(line, /改成未到$/);
  });

  // confirmedAt / cancelledAt 跟著狀態一起被寫進去，它們不該出現在句子裡。
  test('跟著狀態寫進去的時間戳不會擠掉那一句話', () => {
    const line = describeEvent(ev('visits.update',
      visit({ status: 'pending_confirm' }),
      { status: 'confirmed', confirmedAt: '2026-09-01T00:00:00Z' }));
    assert.equal(line, '客戶A・9/14(一)・復能、營養針・改成已確認');
  });

  // 舊日期要從 before 拿 —— merged() 給的 date 已經是新的那一天了。
  test('改期講得出從哪天改到哪天', () => {
    const line = describeEvent(ev('visits.update',
      visit({ status: 'confirmed' }),
      { date: '2026-09-20' }));
    assert.equal(line, '客戶A・9/14(一)・復能、營養針・改期到 9/20(日)');
  });

  test('「禮拜一再問問」是自己一種，不是改了一個欄位', () => {
    const line = describeEvent(ev('visits.update',
      visit({ followupNote: null }),
      { followupNote: '禮拜一再問問' }));
    assert.equal(line, '客戶A・9/14(一)・記了一句「禮拜一再問問」');
  });

  // 她的原話（2026-09-04）：「勾掉了誰的什麼時候甚麼的 examine／耀聖，
  // 不要像現在只寫勾掉 examine」。「勾掉 Examine ×8」看起來很乾淨，
  // 可是她一個都認不出來，而這一頁的用途正是「那第九個人呢」。
  //
  // 缺的不是欄位是**一次查詢**：任務身上不該有來訪日與課程名（那會是第二份
  // 會對不起來的資料），但它有 `visitId`，而稽核的 before 是整份舊文件。
  describe('勾掉一張任務', () => {
    const tick = (extra = {}) => ev('tasks.update',
      { customerName: '客戶A', kind: 'Examine', done: false, visitId: 'v1', ...extra },
      { done: true, doneAt: '2026-09-01T00:00:00Z' }, 'tasks/t1');

    const visitOf = (id) => (id === 'v1' ? { id: 'v1', date: '2026-09-14', slots } : null);

    test('傳了 visitOf 就講得出誰的、哪一天的、哪一項', () => {
      assert.equal(describeEvent(tick(), { visitOf }),
        '勾掉 客戶A・9/14(一)・復能、營養針・Examine');
    });

    // 稽核那一頁與客戶詳情的變更紀錄刻意不傳它（那兩頁是查證用的，
    // 多一次 N 筆來訪的查詢換一個日期不划算）。
    test('沒傳就退回原本那一句，不是印出半句話', () => {
      assert.equal(describeEvent(tick()), '勾掉 客戶A・Examine');
    });

    test('那一筆來訪被刪了、問不到，一樣退回去', () => {
      assert.equal(describeEvent(tick(), { visitOf: () => null }), '勾掉 客戶A・Examine');
      assert.equal(describeEvent(tick({ visitId: null }), { visitOf }), '勾掉 客戶A・Examine');
    });

    // CONTEXT.md 的「拿回來」那一條把「取消勾選」列為 _Avoid_。
    test('拿回來不是「取消勾選」', () => {
      const line = describeEvent(ev('tasks.update',
        { customerName: '客戶A', kind: 'Examine', done: true, visitId: 'v1' },
        { done: false, doneAt: null }, 'tasks/t1'), { visitOf });
      assert.equal(line, '拿回來 客戶A・9/14(一)・復能、營養針・Examine');
    });
  });

  // 這是她點名的那個 bug：「什麼叫勾掉某某的某某??」
  // 隨手記身上沒有 `kind`，所以以前那一條退回 `subjectOf()`，
  // 而它的第一順位就是 customerName —— 於是名字被印了兩次。
  test('勾隨手記講的是那一句話，不是把名字印兩次', () => {
    const line = describeEvent(ev('notes.update',
      { customerId: 'c1', customerName: '客戶A', text: '帶健保卡', done: false },
      { done: true, doneAt: '2026-09-01T00:00:00Z' }, 'notes/n1'));
    assert.equal(line, '勾掉待辦 客戶A・「帶健保卡」');
    assert.equal(line.split('客戶A').length - 1, 1, '名字只能出現一次');
  });

  test('拿回來一則待辦也是「拿回來」，不是「取消勾選」', () => {
    const line = describeEvent(ev('notes.update',
      { customerId: 'c1', customerName: '客戶A', text: '帶健保卡', done: true },
      { done: false, doneAt: null }, 'notes/n1'));
    assert.equal(line, '拿回來待辦 客戶A・「帶健保卡」');
  });

  test('新增隨手記講得出哪一天、什麼事', () => {
    const line = describeEvent(ev('notes.create', null,
      { customerId: 'c1', customerName: '客戶A', text: '帶健保卡', date: '2026-09-03' },
      'notes/n1'));
    assert.equal(line, '新增待辦 客戶A・9/3(四)・「帶健保卡」');
  });

  test('只改日期就講改到哪一天，清掉日期就講從日曆拿掉', () => {
    const base = { customerName: '客戶A', text: '帶健保卡', date: '2026-09-03' };
    assert.equal(
      describeEvent(ev('notes.update', base, { date: '2026-09-05' }, 'notes/n1')),
      '客戶A・待辦「帶健保卡」・改到 9/5(六)',
    );
    assert.equal(
      describeEvent(ev('notes.update', base, { date: null }, 'notes/n1')),
      '客戶A・待辦「帶健保卡」・從日曆拿掉',
    );
  });

  test('次數只講數字怎麼變，不講欄位叫什麼', () => {
    const line = describeEvent(ev('customers/c1/entitlements.update',
      { label: '復能', doneCount: 7 },
      { doneCount: 8 }, 'customers/c1/entitlements/e1'), { nameOf });
    assert.equal(line, '客戶A・復能・已完成 7 → 8 次');
  });

  // 她的原話：「我不懂甚麼叫改了二返（x萬健檢）的已排未上次數、上次對帳時間」。
  // 對帳時間是跟著次數一起被寫進去的，它一出現就把那一則擠到「一般的修改」去了。
  test('上次對帳時間不會擠掉次數那一句 —— 但差異表照樣列它', () => {
    const event = ev('customers/c1/entitlements.update',
      { label: '二返（12萬健檢）', bookedCount: 1, lastReconciledAt: null },
      { bookedCount: 2, lastReconciledAt: '2026-09-01' }, 'customers/c1/entitlements/e1');

    assert.equal(describeEvent(event, { nameOf }), '客戶A・二返（12萬健檢）・已排未上 1 → 2 次');
    // 差異表是拿來查證的，不可以少東西
    assert.deepEqual(changedFields(event).map((f) => f.key), ['bookedCount', 'lastReconciledAt']);
  });

  test('只動到對帳時間的那一則就說對帳過了', () => {
    const line = describeEvent(ev('customers/c1/entitlements.update',
      { label: '復能', lastReconciledAt: null },
      { lastReconciledAt: '2026-09-01' }, 'customers/c1/entitlements/e1'), { nameOf });
    assert.equal(line, '客戶A・復能・對帳過了');
  });

  // 交付紀錄是要進試算表的那一份（ADR-0059），所以句子要講得出是哪幾款。
  // 以前它掉進「一般的修改」，印成「改了 …・deliveries」—— 欄位名是英文的。
  test('交付講得出這一次給了哪幾款', () => {
    const line = describeEvent(ev('customers/c1/entitlements.update',
      {
        label: '夜態美＋速膳淨',
        type: 'product',
        items: [{ productId: 'x1', name: '夜態美' }, { productId: 'x2', name: '速膳淨' }],
        deliveries: [{ at: '2026-08-20', productIds: ['x1'] }],
      },
      {
        deliveries: [
          { at: '2026-08-20', productIds: ['x1'] },
          { at: '2026-09-01', productIds: ['x2'] },
        ],
      },
      'customers/c1/entitlements/p1'), { nameOf });
    assert.equal(line, '客戶A・夜態美＋速膳淨・給了 速膳淨');
  });

  // 舊資料的 items[].name 是空的，而主檔在 /domain 這一層讀不到 ——
  // 認不回名字就別硬湊一串（`itemsOf()` 的檔頭）。
  test('名字認不回來就只說記了一筆交付', () => {
    const line = describeEvent(ev('customers/c1/entitlements.update',
      { label: '營養品', type: 'product', items: [{ productId: 'x1', name: '' }], deliveries: [] },
      { deliveries: [{ at: '2026-09-01', productIds: ['x1'] }] },
      'customers/c1/entitlements/p1'), { nameOf });
    assert.equal(line, '客戶A・營養品・記了一筆交付');
  });

  // 只給了一部分時 recordDelivery() 把文字換成剩下的那幾款。以前這一則
  // 掉進「一般的修改」，而 selfNameOf() 撿到的就是那一句話本身，
  // 於是名字出現了兩次。
  test('隨手記只改了內容就講改成什麼', () => {
    const line = describeEvent(ev('notes.update',
      { customerName: '客戶A', text: '給客戶A營養品：夜態美、速膳淨' },
      { text: '給客戶A營養品：速膳淨' }, 'notes/n1'));
    assert.equal(line, '客戶A・待辦改成「給客戶A營養品：速膳淨」');
  });

  test('營養品論月，其餘論次（ADR-0057、0059）', () => {
    assert.equal(
      describeEvent(ev('customers/c1/entitlements.create', null,
        { label: '復能', totalQty: 12, type: 'pool' }, 'customers/c1/entitlements/e1'), { nameOf }),
      '新增額度 客戶A・復能・12 次',
    );
    assert.equal(
      describeEvent(ev('customers/c1/entitlements.create', null,
        { label: '夜態美', totalQty: 2, type: 'product' }, 'customers/c1/entitlements/p1'), { nameOf }),
      '新增營養品 客戶A・夜態美・2 個月',
    );
  });

  test('新增與刪除講得出是誰', () => {
    assert.equal(
      describeEvent(ev('customers.create', null, { name: '客戶A' }, 'customers/c1')),
      '新增客戶 客戶A',
    );
    assert.equal(
      describeEvent(ev('visits.softDelete', visit(), { deletedAt: 'server' })),
      '刪掉 客戶A・9/14(一)・復能、營養針',
    );
  });

  test('一般的修改講改了哪幾個欄位，改成什麼是展開之後的事', () => {
    const line = describeEvent(ev('customers.update',
      { name: '客戶A', phone: '02', lineId: 'a' },
      { phone: '03', lineId: 'b' }, 'customers/c1'));
    assert.equal(line, '改了 客戶A・電話、LINE');
  });

  test('改了一大片就只講幾個欄位 —— 列出十個欄位名等於沒講', () => {
    const before = { name: '客戶A' };
    const after = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    assert.match(describeEvent(ev('customers.update', before, after, 'customers/c1')), /5 個欄位/);
  });

  // 湊不出句子的時候要回 null，畫面才知道要退回欄位表。
  // 硬湊一句話出來，湊錯的那幾則會比欄位表更難查。
  test('翻不出來就回 null，不要硬湊', () => {
    assert.equal(describeEvent(ev('visits.update', { status: 'done' }, { status: 'done' })), null);
    assert.equal(describeEvent({}), null);
    assert.equal(describeParts({}), null);
  });

  test('讀不到名字就不編一個', () => {
    assert.equal(subjectOf({ before: null, after: { status: 'done' } }), null);
    assert.equal(
      describeEvent(ev('visits.update', { date: '2026-09-14', slots, status: 'confirmed' }, { status: 'done' })),
      '9/14(一)・復能、營養針・改成已完成',
    );
  });
});

// ---------- 誰做的那一半 ----------
//
// 「今天做了什麼」的照人分組要的東西（ADR-0062）。抬頭已經寫著名字了，
// 所以每一列印的是**不含名字**的那一半，而兩邊接起來走同一支 `joinParts()`
// —— 兩個畫面因此不可能講得不一樣。

describe('誰與做了什麼分成兩半', () => {
  const ev = (action, before, after, targetPath) => ({ action, targetPath, before, after });
  const nameOf = (id) => ({ c1: '客戶A' })[id] ?? null;

  test('兩半接起來就是整句話', () => {
    const event = ev('visits.create', null,
      { customerName: '客戶A', date: '2026-09-14', slots: [{ courseName: '復能' }] }, 'visits/v1');
    const parts = describeParts(event);
    assert.equal(joinParts(parts), describeEvent(event));
  });

  test('照人那一格的那一列不含名字', () => {
    const parts = describeParts(ev('visits.create', null,
      { customerName: '客戶A', date: '2026-09-14', slots: [{ courseName: '復能' }] }, 'visits/v1'));
    assert.equal(parts.who, '客戶A');
    assert.equal(joinParts({ ...parts, who: null }), '新增 9/14(一)・復能');
  });

  // 額度與本輪可用性是子集合，文件上沒有 customerName —— 只有路徑上有 id。
  test('子集合靠路徑上的 id 問名字', () => {
    const event = ev('customers/c1/availability.create', null,
      {
        validFrom: '2026-09-01',
        rules: [{ kind: 'exclude_date', date: '2026-09-17' }, { kind: 'prefer', weekday: 1 }],
      },
      'customers/c1/availability/a1');

    assert.equal(customerIdOf(event), 'c1');
    // `prefer` 不算「不能的時間」—— 跟 banBlock() 的丸子同一個數字
    assert.equal(describeEvent(event, { nameOf }), '新增 客戶A・9 月的本輪可用性・1 條不能的時間');
  });

  test('沒傳解析器就不講名字，也不編一個', () => {
    const event = ev('customers/c1/availability.create', null,
      { validFrom: '2026-09-01', rules: [] }, 'customers/c1/availability/a1');
    const parts = describeParts(event);
    assert.equal(parts.who, null);
    assert.equal(describeEvent(event), '新增 9 月的本輪可用性・沒有說哪天不行');
  });

  test('解析器答不出來也不編一個', () => {
    const event = ev('customers/zz/entitlements.update',
      { label: '復能', doneCount: 7 }, { doneCount: 8 }, 'customers/zz/entitlements/e1');
    assert.equal(describeParts(event, { nameOf }).who, null);
    assert.equal(describeEvent(event, { nameOf }), '復能・已完成 7 → 8 次');
  });

  test('改了哪幾條可用性走 describeRuleChanges() —— 跟存檔前講的那一句同一支', () => {
    const line = describeEvent(ev('customers/c1/availability.update',
      { validFrom: '2026-09-01', rules: [{ kind: 'exclude_date', date: '2026-09-17' }] },
      { rules: [{ kind: 'exclude_date', date: '2026-09-18' }] },
      'customers/c1/availability/a1'), { nameOf });
    assert.match(line, /多了 9\/18/);
    assert.match(line, /少了 9\/17/);
  });

  test('AI 用量的設定：改上限、暫停、打開各一句（issue 05）', () => {
    assert.equal(describeEvent(ev('config.update', { monthlyCapUsd: 10 }, { monthlyCapUsd: 20 }, 'config/ai')),
      '把 AI 每月上限改成 US$20');
    assert.equal(describeEvent(ev('config.update', { paused: false }, { paused: true }, 'config/ai')), '暫停 AI');
    assert.equal(describeEvent(ev('config.update', { paused: true }, { paused: false }, 'config/ai')), '打開 AI');
    assert.equal(describeEvent(ev('config.create', null, { monthlyCapUsd: 5, paused: false }, 'config/ai')),
      '把 AI 每月上限改成 US$5');
  });

  test('掛不到任何人的那幾則 who 是 null', () => {
    const parts = describeParts(ev('config/app/courses.create', null,
      { name: '復能' }, 'config/app/courses/c1'));
    assert.equal(parts.who, null);
    assert.equal(parts.whoId, null);
    assert.equal(joinParts(parts), '新增課程「復能」');
  });
});

describe('同一天的收在一起', () => {
  test('照原順序分組，不重排', () => {
    const days = groupByDay(
      [{ id: 1, d: '08-23' }, { id: 2, d: '08-23' }, { id: 3, d: '08-22' }, { id: 4, d: '08-23' }],
      (e) => e.d,
    );
    assert.deepEqual(days.map((g) => g.day), ['08-23', '08-22', '08-23']);
    assert.deepEqual(days.map((g) => g.events.length), [2, 1, 1]);
  });

  test('沒有事件就沒有分組', () => {
    assert.deepEqual(groupByDay([], () => ''), []);
    assert.deepEqual(groupByDay(undefined, () => ''), []);
  });
});

// events 這個集合同時放行事備註與休假（ADR-0045），而那兩個在日曆上是不同的兩類。
// 只看路徑的話，一則休假的稽核會寫著「行事備註」。
test('休假的稽核不會寫成行事備註', () => {
  assert.equal(
    describeEvent({ action: 'events.create', targetPath: 'events/e1', before: null, after: { title: '宜蘭休假', category: 'leave' } }),
    '新增休假「宜蘭休假」',
  );
  assert.equal(
    describeEvent({ action: 'events.create', targetPath: 'events/e2', before: null, after: { title: '高齡演講', category: 'personal' } }),
    '新增行事備註「高齡演講」',
  );
});

describe('取消其中一段講得出是哪一段（ADR-0081）', () => {
  const slot = (status) => ({ courseId: 'c1', courseName: '復能', status });
  const event = (before, after) => ({
    targetPath: 'visits',
    action: 'visits.update',
    before: { date: '2026-09-20', status: 'confirmed', slots: before },
    after: { date: '2026-09-20', status: 'confirmed', slots: after },
  });

  test('整筆的狀態沒變，但有一段取消了 → 講出來', () => {
    const e = event(
      [slot('confirmed'), slot('confirmed'), slot('confirmed')],
      [slot('confirmed'), slot('cancelled'), slot('confirmed')],
    );
    const line = describeParts(e).text;
    assert.match(line, /取消了/);
    assert.match(line, /1 段/);
  });

  test('一次取消兩段就說兩段', () => {
    const e = event(
      [slot('confirmed'), slot('confirmed'), slot('confirmed')],
      [slot('cancelled'), slot('cancelled'), slot('confirmed')],
    );
    assert.match(describeParts(e).text, /2 段/);
  });

  test('整筆一起取消時走原本那一條（狀態變化才是主角）', () => {
    const e = {
      targetPath: 'visits',
      action: 'visits.update',
      before: { date: '2026-09-20', status: 'confirmed', slots: [slot('confirmed')] },
      after: { date: '2026-09-20', status: 'cancelled', slots: [slot('cancelled')] },
    };
    assert.match(describeParts(e).text, /改成/);
  });
});
