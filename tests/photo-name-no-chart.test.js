// 照片認人：名字對上、app 那一位沒有病歷號、照片上有 → 不先勾、講一句；她勾了存的時候順便記上
// （before-golive-2026-10-19 issue 06，ADR-0160）。
//
// 她 10/19：「同名的客人、app 那一位沒填病歷號時，會自動認成他而且預設打勾 … 好，修」。
//
// 判準：
// - 這一行會不會讓照片上有號碼的一列，**沒有用號碼核對過就預設打勾**？
// - 這一行會不會把照片上的號碼寫到**另一位**身上？（換一位、`conflict`、`ambiguous` 都不寫）
// 例子一律假名、號碼一律 1234／4321。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { identifyCustomer, chartNoSay, chartNoWrites } from '../public/js/domain/identify.js';
import { nearSay, readAbovee, needsAttention, photoChartNos } from '../public/js/domain/aboveeImport.js';
import { aboveeConsequences } from '../public/js/domain/consequences.js';
import { readSheet } from '../public/js/domain/treatmentSheets.js';
import { SEED } from '../public/js/domain/seed.js';

const bare = (id, name) => ({ id, name, marks: [] });

describe('identifyCustomer：nameNoChart', () => {
  test('名字對上剛好一位、照片上有號碼、那一位一個號碼都沒有 → nameNoChart，customer 照舊是他', () => {
    const r = identifyCustomer({ name: '王小明', chartNo: '00001234' }, [bare('c1', '王小明')]);
    assert.equal(r.how, 'nameNoChart');
    assert.equal(r.customer?.id, 'c1');
  });

  test('照片上沒有號碼（療程單常常沒有）→ 照舊 nameOnly', () => {
    assert.equal(identifyCustomer({ name: '王小明', chartNo: '' }, [bare('c1', '王小明')]).how, 'nameOnly');
  });

  test('那一位有一樣的號碼 → both；不一樣 → conflict（照舊）', () => {
    assert.equal(identifyCustomer({ name: '王小明', chartNo: '1234' }, [{ ...bare('c1', '王小明'), chartNo: '1234' }]).how, 'both');
    assert.equal(identifyCustomer({ name: '王小明', chartNo: '1234' }, [{ ...bare('c1', '王小明'), chartNo: '4321' }]).how, 'conflict');
  });

  test('同名兩位都沒有號碼 → 照舊 ambiguous', () => {
    assert.equal(identifyCustomer({ name: '王小明', chartNo: '1234' }, [bare('c1', '王小明'), bare('c2', '王小明')]).how, 'ambiguous');
  });
});

describe('那一句與存的時候記上', () => {
  const who = identifyCustomer({ name: '王小明', chartNo: '00001234' }, [bare('c1', '王小明')]);

  test('那一句：講照片上的號碼（去掉前面的 0）；換了人就不講', () => {
    assert.match(chartNoSay(who, '00001234'), /還沒有病歷號.*1234/);
    assert.doesNotMatch(chartNoSay(who, '00001234'), /0000/);
    assert.equal(chartNoSay(who, '1234', 'c-other'), '');
    assert.equal(chartNoSay(identifyCustomer({ name: '王小明' }, [bare('c1', '王小明')]), ''), '');
  });

  test('記上：只寫認人那一次那一位、那一格空著的；寫去掉前面 0 的', () => {
    const customers = [bare('c1', '王小明')];
    const rows = [{ who, chartNo: '00001234', customerId: 'c1' }];
    assert.deepEqual(chartNoWrites(rows, customers), [{ id: 'c1', name: '王小明', changes: { chartNo: '1234' } }]);
  });

  test('換成別人的列不寫；已經有號碼的不寫；同一位兩列兩個號碼不寫', () => {
    const customers = [bare('c1', '王小明'), bare('c2', '李小華')];
    assert.deepEqual(chartNoWrites([{ who, chartNo: '1234', customerId: 'c2' }], customers), []);
    assert.deepEqual(chartNoWrites([{ who, chartNo: '1234', customerId: 'c1' }],
      [{ ...bare('c1', '王小明'), chartNo: '1234' }]), []);
    assert.deepEqual(chartNoWrites([
      { who, chartNo: '1234', customerId: 'c1' }, { who, chartNo: '4321', customerId: 'c1' },
    ], customers), []);
    // 同一位兩列同一個號碼 → 寫一次
    assert.equal(chartNoWrites([
      { who, chartNo: '1234', customerId: 'c1' }, { who, chartNo: '00001234', customerId: 'c1' },
    ], customers).length, 1);
  });

  test('別的認法（both、nearName、nameOnly）不寫', () => {
    const customers = [bare('c1', '王小明')];
    const nameOnly = identifyCustomer({ name: '王小明' }, customers);
    assert.deepEqual(chartNoWrites([{ who: nameOnly, chartNo: '', customerId: 'c1' }], customers), []);
  });
});

describe('拍 Abovee：那一列不先勾、講一句、排進要你看', () => {
  const POOL = { id: 'w-pool', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 10 };
  const ctx = (customers) => ({
    customers, entitlementsBy: { c1: [POOL] }, visitsBy: {},
    master: { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts },
    today: '2026-09-01',
  });
  const photo = (no) => [{
    columns: ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'],
    rows: [['確認前往', '2026-09-10', '10:00 - 11:15', '王小明', no, 'SIS 60']],
  }];

  test('app 那一位沒有號碼 → 新的、沒勾、那一句、要你看', () => {
    const { items } = readAbovee(photo('00001234'), ctx([bare('c1', '王小明')]));
    assert.deepEqual([items[0].kind, items[0].customerId, items[0].checked], ['new', 'c1', false]);
    assert.match(nearSay(items[0]), /還沒有病歷號/);
    assert.equal(needsAttention(items[0]), true);
  });

  test('存完（那一格記上了）再拍同一張 → both、照常勾', () => {
    const { items } = readAbovee(photo('00001234'), ctx([{ ...bare('c1', '王小明'), chartNo: '1234' }]));
    assert.deepEqual([items[0].who.how, items[0].checked], ['both', true]);
    assert.equal(nearSay(items[0]), '');
  });

  test('照片上沒有號碼 → 照舊 nameOnly、照常勾', () => {
    const { items } = readAbovee(photo(''), ctx([bare('c1', '王小明')]));
    assert.deepEqual([items[0].who.how, items[0].checked], ['nameOnly', true]);
  });

  // 段四審查：改期與扣法的預設勾是 `flagMoved()` 自己判的，不經過 `resolveItem()` 的 `recognized` —— 也要管到
  test('Abovee 上改了時間（app 10:00、照片 11:00）→ 已經記了＋改期，但改期與扣法都不先勾', () => {
    const slot = {
      entitlementId: 'w-pool', courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis',
      startsAt: '10:00', endsAt: '11:00', status: 'confirmed', attended: null,
    };
    const c = { ...ctx([bare('c1', '王小明')]), visitsBy: { c1: [{ id: 'v1', customerId: 'c1', date: '2026-09-10', status: 'confirmed', slots: [slot] }] } };
    const rows = (course) => [{ ...photo('00001234')[0], pageText: '1筆第1/1頁',
      rows: [['確認前往', '2026-09-10', '11:00 - 12:15', '王小明', '00001234', course]] }];
    const [moved] = readAbovee(rows('SIS 60'), c).items;
    assert.deepEqual([moved.who.how, moved.kind, Boolean(moved.move)], ['nameNoChart', 'recorded', true]);
    assert.equal(moved.adoptMove, false);
    assert.equal(needsAttention(moved), true);
    // 照片上同一列也改成體驗（扣法不一樣）：跟著改期不先勾
    const [both] = readAbovee(rows('EECP20'), {
      ...c, visitsBy: { c1: [{ id: 'v1', customerId: 'c1', date: '2026-09-10', status: 'confirmed',
        slots: [{ ...slot, courseId: 'course-eecp', courseName: 'EECP', equipmentId: null, entitlementId: 'w-eecp' }] }] },
      entitlementsBy: { c1: [POOL, { id: 'w-eecp', type: 'single', label: 'EECP(60)', courseId: 'course-eecp', totalQty: 10 }] },
    }).items;
    assert.equal(both.chargeChange?.to, 'trial');
    assert.deepEqual([both.adoptMove, both.adoptCharge], [false, false]);

    // 確認框那一句「病歷號記成 1234」數的是這一次會寫的每一列：她勾了改期那一行 → 存的時候會記上 → 框要講
    const customers = [bare('c1', '王小明')];
    assert.deepEqual(photoChartNos([moved], customers), [], '沒勾就不寫、不講');
    assert.deepEqual(photoChartNos([{ ...moved, adoptMove: true }], customers),
      [{ id: 'c1', name: '王小明', changes: { chartNo: '1234' } }]);
  });

  test('確認框講一句「病歷號記成 1234」', () => {
    const lines = aboveeConsequences({ groups: [], chartNos: [{ name: '王小明', chartNo: '1234' }] });
    const all = lines.lines.join('\n');
    assert.match(all, /王小明.*病歷號.*1234/);
  });
});

test('療程單：同一個認人結果、草稿上照樣是他（講一句由畫面讀 chartNoSay）', () => {
  const draft = readSheet({ customerName: '王小明', customerNumber: '1234', rows: [] },
    { customers: [bare('c1', '王小明')], master: { courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts }, sheets: [], today: '2026-10-06' });
  assert.equal(draft.who.how, 'nameNoChart');
  assert.equal(draft.customerId, 'c1');
});
