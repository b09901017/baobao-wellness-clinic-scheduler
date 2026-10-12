// 換了額度，那一段的器材要跟著重算（verified-bugs-2026-10-07/issues/02）。
//
// 她 10/7 看到的：日曆編輯器先點「復能-三選一」→ INDIBA，再點「復能-SIS」——抬頭還寫 IN(60)、
// 器材那一排 SIS 沒選上、存檔被擋「這個器材不在「復能-SIS(60)」的擇一池裡」，而畫面上已經看不到 INDIBA。
// 那一排的 hidden input 還是上一筆額度時點的那一台；品項同一個形狀的 bug 2026-09-18 修過，器材沒有跟著做。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { equipmentAfterSwitch, validateVisit } from '../public/js/domain/visits.js';

const pool = (...ids) => ({ id: 'e', type: 'pool', label: '復能-SIS(60)', optionEquipmentIds: ids });

describe('equipmentAfterSwitch()', () => {
  test('新的額度只有一台：直接是那一台 —— 她沒有別的可以選', () => {
    assert.equal(equipmentAfterSwitch(pool('eq-sis'), 'eq-indiba'), 'eq-sis');
    assert.equal(equipmentAfterSwitch(pool('eq-sis'), null), 'eq-sis');
  });

  test('上一台剛好也在新的池裡：留著（三選一 ↔ 四選一）', () => {
    assert.equal(equipmentAfterSwitch(pool('eq-indiba', 'eq-sis', 'eq-laser'), 'eq-indiba'), 'eq-indiba');
  });

  test('上一台不在新的池裡：清掉，她重選', () => {
    assert.equal(equipmentAfterSwitch(pool('eq-sis', 'eq-laser'), 'eq-indiba'), null);
  });

  test('不是擇一池的額度：一律清掉（不用選器材的課不可以帶著上一段的那一台）', () => {
    assert.equal(equipmentAfterSwitch({ id: 'e', type: 'single', courseId: 'c-iv' }, 'eq-indiba'), null);
    assert.equal(equipmentAfterSwitch(null, 'eq-indiba'), null);
  });
});

describe('存檔那一句講得出是哪一台', () => {
  test('池外的器材：訊息帶著器材的名字', () => {
    const { errors } = validateVisit({
      id: null, customerId: 'c1', customerName: '客戶A', date: '2026-10-07', status: 'pending_confirm',
      slots: [{
        entitlementId: 'e', courseId: 'c-rec', courseName: '復能', equipmentId: 'eq-indiba',
        startsAt: '09:00', endsAt: '10:00', therapistId: null,
      }],
    }, {
      customer: { id: 'c1', flags: [] },
      entitlements: [pool('eq-sis')],
      courses: [{ id: 'c-rec', name: '復能', assigns: 'therapist', requiresEquipment: true }],
      equipment: [{ id: 'eq-indiba', name: 'INDIBA' }, { id: 'eq-sis', name: 'SIS' }],
      rooms: [], staff: [], ivProducts: [], customerVisits: [], sameDayVisits: [],
    });
    assert.ok(errors.includes('第 1 個時段：INDIBA 不在「復能-SIS(60)」的擇一池裡'), errors.join('｜'));
  });
});

// 編輯器那一支進不了 node（它 import 整個畫面），所以掃原始碼：擋得住「有人把那一行改回去」，
// 真的行為由 E2E `58-verified-rules` 的 P6 問。
describe('來訪編輯器換額度時走那一支', () => {
  const src = readFileSync(new URL('../public/js/ui/views/visitEditor.js', import.meta.url), 'utf8');
  const readDraft = src.slice(src.indexOf('function readDraft('), src.indexOf('function readFreeSlot('));

  test('readDraft() 換了額度就問 equipmentAfterSwitch()', () => {
    assert.match(readDraft, /equipmentAfterSwitch\(/);
  });

  test('存進時段的那一格不再直接讀那一排的舊值', () => {
    assert.doesNotMatch(readDraft, /equipmentId: picksEquipment\(ent, course\) \? \(v\[/);
  });

  test('拍 Abovee 換一顆時走同一支（兩邊各寫一份就是這一條 bug 本身）', () => {
    const abovee = readFileSync(new URL('../public/js/domain/aboveeImport.js', import.meta.url), 'utf8');
    assert.match(abovee, /equipmentAfterSwitch\(/);
  });
});
