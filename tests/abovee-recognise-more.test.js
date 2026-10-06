// 拍 Abovee／療程單：認得更準（course-form-and-sheet-2026-10-06/10，ADR-0128）。
//
// 她 2026-10-06 問「病歷號對上、名字只差一個字，算認得？」回：「直接算吻合」。
//
// **這一行會不會把一段時間記到別人身上，而畫面上看起來是認得的？**（ADR-0103 的那一句）——
// 放寬的只有「兩個訊號都指向同一位、而且名字夠長」那一格，而且畫一句看得到的話；
// 課程與治療師只在原本認不出來時才多比一步，`SIS`、`二返`、`IN` 這種短的一個字都不放寬；診間不放寬。
// 例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { identifyCustomer, nearNameSay } from '../public/js/domain/identify.js';
import { courseFrom, roomFrom, staffFrom } from '../public/js/domain/abovee.js';
import { oneCharOff } from '../public/js/domain/masterData.js';
import { nearSay, readAbovee } from '../public/js/domain/aboveeImport.js';
import { readSheet } from '../public/js/domain/treatmentSheets.js';
import { SEED } from '../public/js/domain/seed.js';

const withNo = (id, name, no) => ({ id, name, marks: [{ text: `病歷號 ${no}`, color: 'grey' }] });

describe('差一個字怎麼算', () => {
  test('一樣長、只差一個字、至少三個字', () => {
    assert.equal(oneCharOff('王小明', '王曉明'), true);
    assert.equal(oneCharOff('王小明', '王曉名'), false, '差兩個字');
    assert.equal(oneCharOff('王小明', '王小明'), false, '一樣的不是「差一個字」');
    assert.equal(oneCharOff('王小明', '王小明明'), false, '多一個字不算');
    assert.equal(oneCharOff('小明', '小名'), false, '兩個字的不放寬');
  });

  test('全是英數字的要多一個字：SIS／SIX、PRP、HRV 不放寬；ILIB／ILIP 放寬', () => {
    assert.equal(oneCharOff('sis', 'six'), false);
    assert.equal(oneCharOff('prp', 'prf'), false);
    assert.equal(oneCharOff('ilib', 'ilip'), true);
  });
});

describe('病歷號對上、名字差一個字 → 認得（ADR-0128）', () => {
  const customers = [
    withNo('c-wang', '王小明', '1234'),
    withNo('c-chen', '陳大文', '5678'),
    withNo('c-two', '林美', '2222'),
    withNo('c-two2', '林英', '2223'),
  ];

  test('三個字的名字差一個字、病歷號對上 → nearName、認得那一位', () => {
    const r = identifyCustomer({ name: '王曉明', chartNo: '00001234' }, customers);
    assert.equal(r.how, 'nearName');
    assert.equal(r.customer?.id, 'c-wang');
    assert.deepEqual(r.candidates.map((c) => c.id), ['c-wang']);
  });

  test('差兩個字 → 照舊要她選（numberOnly）', () => {
    const r = identifyCustomer({ name: '黃曉明', chartNo: '1234' }, customers);
    assert.deepEqual([r.how, r.customer], ['numberOnly', null]);
    assert.equal(identifyCustomer({ name: '王曉名', chartNo: '1234' }, customers).how, 'numberOnly');
  });

  test('兩個字的名字差一個字、病歷號對上 → 照舊要她選（等於只有姓或名一樣）', () => {
    const r = identifyCustomer({ name: '林英', chartNo: '2222' }, customers);
    assert.deepEqual([r.how, r.customer], ['conflict', null], '林英是另一位 → 名字與號碼指到兩個人');
    const s = identifyCustomer({ name: '林華', chartNo: '2222' }, customers);
    assert.deepEqual([s.how, s.customer], ['numberOnly', null]);
  });

  test('多一個字、少一個字 → 照舊要她選', () => {
    assert.equal(identifyCustomer({ name: '王小明明', chartNo: '1234' }, customers).how, 'numberOnly');
    assert.equal(identifyCustomer({ name: '王明', chartNo: '1234' }, customers).how, 'numberOnly');
  });

  test('名字對上甲、號碼對上乙 → 照舊不挑人', () => {
    const r = identifyCustomer({ name: '陳大文', chartNo: '1234' }, customers);
    assert.deepEqual([r.how, r.customer], ['conflict', null]);
  });

  test('同名兩位、號碼分得開 → 照舊 both，沒有記號', () => {
    const twins = [withNo('c-1', '張志明', '1111'), withNo('c-2', '張志明', '2222')];
    const r = identifyCustomer({ name: '張志明', chartNo: '2222' }, twins);
    assert.deepEqual([r.how, r.customer?.id], ['both', 'c-2']);
    assert.equal(nearNameSay(r, '張志明'), '');
  });

  test('只有名字像、沒有號碼 → 不放寬（一個訊號不夠）', () => {
    const r = identifyCustomer({ name: '王曉明', chartNo: '' }, customers);
    assert.deepEqual([r.how, r.customer], ['none', null]);
  });

  test('畫面上那一句講得出照片上的原字', () => {
    const r = identifyCustomer({ name: '王曉明', chartNo: '1234' }, customers);
    assert.match(nearNameSay(r, '王曉明'), /差一個字/);
    assert.match(nearNameSay(r, '王曉明'), /「王曉明」/);
  });
});

describe('兩個入口都跟著放寬，而且看得出來', () => {
  const customers = [withNo('c-wang', '王小明', '1234')];
  const POOL = { id: 'w-pool', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 10 };
  const ctx = {
    customers, entitlementsBy: { 'c-wang': [POOL] }, visitsBy: {},
    master: { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts },
    today: '2026-09-01',
  };

  test('拍 Abovee：那一列是新的、照常勾著（她：直接算吻合），而且收起來那一行講得出差一個字', () => {
    const { items } = readAbovee([{
      columns: ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'],
      rows: [['確認前往', '2026-09-10', '10:00 - 11:15', '王曉明', '00001234', 'SIS 60']],
    }], ctx);
    assert.deepEqual([items[0].kind, items[0].customerId, items[0].checked], ['new', 'c-wang', true]);
    assert.match(nearSay(items[0], ctx.master), /差一個字/);
  });

  test('她換成別人之後那一句就不講了（講的是認人那一次）', () => {
    const { items } = readAbovee([{
      columns: ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'],
      rows: [['確認前往', '2026-09-10', '10:00 - 11:15', '王曉明', '00001234', 'SIS 60']],
    }], { ...ctx, customers: [...customers, { id: 'c-a', name: '客戶甲', marks: [] }] });
    assert.equal(nearSay({ ...items[0], customerId: 'c-a' }, ctx.master), '');
  });

  test('療程單：草稿上那一位就是他（照片存到他底下）', () => {
    const draft = readSheet({ customerName: '王曉明', customerNumber: '1234', rows: [] }, { customers, master: ctx.master, sheets: [], today: '2026-10-07' });
    assert.equal(draft.who.how, 'nearName');
    assert.equal(draft.customerId, 'c-wang');
  });
});

describe('課程那一格差一個字', () => {
  const master = { courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts };
  const at = (text) => {
    const r = courseFrom(text, master);
    return r && [r.courseId, r.equipmentId, r.ivProductId, r.durationMin];
  };

  test('品項一個形近字 → 那一款，帶著照片上的原字', () => {
    assert.deepEqual(at('腸道修複'), ['course-iv-drip', null, 'iv-gut', null]);
    assert.deepEqual(courseFrom('腸道修複', master).near, { seen: '腸道修複', as: '腸道修復' });
  });

  test('ILIB 抄錯一個字 → ILIB 那一台（器材那一種只有一筆；跨種一起數的話永遠是兩筆）', () => {
    assert.deepEqual(at('ILIP 60'), ['course-iv-laser', 'eq-ilib', null, 60]);
  });

  test('二返、三返、IN、SIS 這種短的一個字都不放寬', () => {
    for (const t of ['二反 60', '三反 60', 'IM 30', 'SIX 60', 'PRF', 'HRY']) assert.equal(courseFrom(t, master), null, t);
  });

  test('同一種主檔裡有兩筆都差一個字 → 不猜', () => {
    const ivProducts = [...SEED.ivProducts, { id: 'iv-a', name: '甲乙丙丁' }, { id: 'iv-b', name: '甲乙丙戊' }];
    assert.equal(courseFrom('甲乙丙己', { ...master, ivProducts }), null);
  });

  test('本來認得的一筆都不變，也不帶 near（那 353 筆的寫法）', () => {
    const SEEN = [
      '復健門診', 'SIS 30', '任選60', 'SIS 60', 'ILIB 60', '高能量60', '心臟門診', 'EECP60', 'IN 30', 'IN 60',
      '二返60', '二返30', '護肝排毒', '腸道修復', '雪顏亮采', 'EECP20', 'ILIB 30', '功醫門診', '體適能', '羊膜',
    ];
    for (const t of SEEN) assert.equal(courseFrom(t, master)?.near, undefined, t);
  });

  test('確認層那一句講得出原字與認成什麼', () => {
    const item = { course: courseFrom('腸道修複', master), who: { how: 'both' }, customerId: 'c-wang' };
    assert.match(nearSay(item, master), /「腸道修複」/);
    assert.match(nearSay(item, master), /腸道修復/);
  });
});

describe('診間不放寬', () => {
  test('治療室9（主檔沒有）不會被認成治5／治8', () => {
    assert.equal(roomFrom('治療室9', '', SEED.rooms), null);
    assert.equal(roomFrom('治療室5', '', SEED.rooms)?.name, '治5');
  });
});

describe('治療師與醫師：只比她記下來的寫法', () => {
  const STAFF = [
    { id: 's-fang', name: '小芳', role: '物理治療師' },
    { id: 's-lulu', name: 'LuLu', role: '物理治療師', aboveeNames: ['陳露露'] },
    { id: 's-hua', name: '小華', role: '物理治療師', aboveeNames: ['林曉華'] },
    { id: 's-xia', name: '夏', role: '醫師' },
  ];

  test('記著的寫法差一個字、只有一位 → 那一位', () => {
    assert.equal(staffFrom('陳霧露', STAFF, { role: '物理治療師' })?.id, 's-lulu');
  });

  test('差兩個字、兩位都差一個字 → null', () => {
    assert.equal(staffFrom('陳霧霧', STAFF, { role: '物理治療師' }), null);
    const two = [...STAFF, { id: 's-x', name: '某某', role: '物理治療師', aboveeNames: ['陳露霞'] }];
    assert.equal(staffFrom('陳露雲', two, { role: '物理治療師' }), null);
  });

  test('結尾／開頭那兩條不放寬：陳小方 不會被認成小芳', () => {
    assert.equal(staffFrom('陳小方', STAFF, { role: '物理治療師' }), null);
  });

  test('原本就認得的照舊（完全一樣的寫法、結尾規則）', () => {
    assert.equal(staffFrom('陳露露', STAFF)?.id, 's-lulu');
    assert.equal(staffFrom('陳小芳', STAFF)?.id, 's-fang');
  });
});
