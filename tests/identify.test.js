// 認人：人名＋病歷號交叉比對（issue 11，ADR-0103）。
//
// 她 2026-09-17：「病歷號可以拿來認 Abovee 上的人嗎 ? 可以拿來交叉比對，人名和病歷號」。
//
// **這一支有沒有任何一條路，在 numberOnly、conflict、ambiguous 時自動挑一位？** —— 沒有：
// 那三種的 `customer` 一律是 null，只給候選。
//
// 例子一律假名與 1234。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { chartNosOf, identifyCustomer, sameChartNo, sameName } from '../public/js/domain/identify.js';

const withNo = (id, name, no, extra = {}) => ({
  id, name, marks: [{ text: `病歷號 ${no}`, color: 'grey' }], ...extra,
});
const noNo = (id, name, extra = {}) => ({ id, name, marks: [{ text: '怕冷', color: 'blue' }], ...extra });

describe('六種答案', () => {
  const customers = [
    withNo('c-wang', '王小明', '1234'),
    noNo('c-lee', '李小華'),
    withNo('c-chen', '陳大文', '5678'),
    withNo('c-lin1', '林美美', '1111'),
    noNo('c-lin2', '林美美'),
    noNo('c-zhang1', '張志明'),
    noNo('c-zhang2', '張志明'),
  ];

  test('both：名字與病歷號都對上同一位', () => {
    const r = identifyCustomer({ name: '王小明', chartNo: '00001234' }, customers);
    assert.equal(r.how, 'both');
    assert.equal(r.customer.id, 'c-wang');
  });

  test('numberOnly：病歷號對上、名字不一樣 → 不挑，給候選', () => {
    const r = identifyCustomer({ name: '王曉明', chartNo: '1234' }, customers);
    assert.equal(r.how, 'numberOnly');
    assert.equal(r.customer, null);
    assert.deepEqual(r.candidates.map((c) => c.id), ['c-wang']);
  });

  test('nameOnly：名字對上、那位身上沒有病歷號 → 認得', () => {
    const r = identifyCustomer({ name: '李小華', chartNo: '9999' }, customers);
    assert.equal(r.how, 'nameOnly');
    assert.equal(r.customer.id, 'c-lee');
  });

  test('conflict：名字對上一位、病歷號對上另一位 → 不挑', () => {
    const r = identifyCustomer({ name: '王小明', chartNo: '5678' }, customers);
    assert.equal(r.how, 'conflict');
    assert.equal(r.customer, null);
    assert.deepEqual(r.candidates.map((c) => c.id).sort(), ['c-chen', 'c-wang']);
  });

  test('ambiguous：同名好幾位、沒有病歷號分得開 → 不挑', () => {
    const r = identifyCustomer({ name: '張志明', chartNo: '' }, customers);
    assert.equal(r.how, 'ambiguous');
    assert.equal(r.customer, null);
    assert.deepEqual(r.candidates.map((c) => c.id), ['c-zhang1', 'c-zhang2']);
  });

  test('none：兩樣都對不上', () => {
    const r = identifyCustomer({ name: '趙小龍', chartNo: '4321' }, customers);
    assert.equal(r.how, 'none');
    assert.equal(r.customer, null);
    assert.deepEqual(r.candidates, []);
  });
});

describe('比法', () => {
  test('00001234 對上備註「病歷號 1234」；舊的說法「姓名欄的編號：」也認', () => {
    assert.equal(sameChartNo('00001234', '1234'), true);
    assert.equal(sameChartNo(' 0001234 ', '1234'), true);
    assert.equal(sameChartNo('12340', '1234'), false);
    assert.deepEqual(chartNosOf({ marks: [{ text: '姓名欄的編號：01234' }, { text: '病歷號 5678' }] }), ['1234', '5678']);
    assert.deepEqual(chartNosOf({ notes: '病歷號 1234\n怕冷' }), ['1234'], '還沒搬成 marks 的舊資料');
  });

  test('名字前後有空白、全形空白、全形英文 → 照樣對上', () => {
    assert.equal(sameName(' 王小明　', '王小明'), true);
    assert.equal(sameName('ＬｕＬｕ', 'LuLu'), true);
    assert.equal(sameName('王 小明', '王小明'), true);
    assert.equal(sameName('王小明', '王曉明'), false);
  });

  test('兩位同名、只有一位有病歷號、照片上的病歷號是另一個 → conflict 不是 nameOnly', () => {
    const customers = [withNo('a', '林美美', '1111'), noNo('b', '林美美')];
    const r = identifyCustomer({ name: '林美美', chartNo: '2222' }, customers);
    assert.equal(r.how, 'conflict');
    assert.equal(r.customer, null);
  });

  test('一位同名、他身上的病歷號跟照片不一樣 → conflict（名字說是他、號碼說不是）', () => {
    const r = identifyCustomer({ name: '王小明', chartNo: '9999' }, [withNo('a', '王小明', '1234')]);
    assert.equal(r.how, 'conflict');
    assert.equal(r.customer, null);
  });

  test('同名兩位、病歷號分得開 → both', () => {
    const customers = [withNo('a', '林美美', '1111'), withNo('b', '林美美', '2222')];
    const r = identifyCustomer({ name: '林美美', chartNo: '00002222' }, customers);
    assert.equal(r.how, 'both');
    assert.equal(r.customer.id, 'b');
  });

  test('照片上沒有病歷號、只有一位同名 → nameOnly（就算他身上有號碼）', () => {
    const r = identifyCustomer({ name: '王小明', chartNo: '' }, [withNo('a', '王小明', '1234')]);
    assert.equal(r.how, 'nameOnly');
    assert.equal(r.customer.id, 'a');
  });

  test('已刪除、已停用的客戶不參與', () => {
    const customers = [
      withNo('gone', '王小明', '1234', { deletedAt: '2026-09-01' }),
      withNo('paused', '王小明', '1234', { active: false }),
    ];
    assert.equal(identifyCustomer({ name: '王小明', chartNo: '1234' }, customers).how, 'none');
  });

  test('兩位共用一個病歷號（資料打錯）、名字也一樣 → ambiguous，不挑', () => {
    const customers = [withNo('a', '王小明', '1234'), withNo('b', '王小明', '1234')];
    const r = identifyCustomer({ name: '王小明', chartNo: '1234' }, customers);
    assert.equal(r.how, 'ambiguous');
    assert.equal(r.customer, null);
  });
});
