// 一次性客人：客戶清單的三份、名字卡的提醒、轉成我的客戶那一道確認框（2026-11-05，ADR-0172，`.scratch/one-time-guests/issues/05`）。
//
// 她：「我同意跟現在的『看已停用的』並排，但能不能都移到那一頁最底下 ?」；第 6 題：小頁最底下「轉成我的客戶」、確認框答是才轉。
// 畫面那幾條（最底下一行點得到、名字卡那一頁沒有加購、轉了之後上清單）在 E2E `94-one-time-guest-card`。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fromRoot } from './helpers/paths.js';
import {
  inCustomerList, fieldWarnings, warnings, oneTimeCustomer, GUEST_SAME_NAME, CUSTOMER_LISTS, isOneTime, toMyCustomer,
} from '../public/js/domain/customers.js';
import { toMyCustomerConsequences } from '../public/js/domain/consequences.js';
import { SEED } from '../public/js/domain/seed.js';

const coursesById = Object.fromEntries(SEED.courses.map((c) => [c.id, c]));

const regular = { id: 'c1', name: '王小明', active: true };
const stopped = { id: 'c2', name: '王小華', active: false };
const guest = { id: 'g1', name: '客戶A', active: true, oneTime: true };
const converted = { ...guest, oneTime: false };
const gone = { id: 'c3', name: '王大明', active: true, deletedAt: 'x' };

describe('客戶清單的三份（inCustomerList）', () => {
  test('三份互斥：一般客戶不在一次性那一份、一次性客人不在另外兩份', () => {
    const where = (c) => CUSTOMER_LISTS.filter((l) => inCustomerList(c, l));
    assert.deepEqual(where(regular), ['active']);
    assert.deepEqual(where(stopped), ['inactive']);
    assert.deepEqual(where(guest), ['oneTime']);
    assert.deepEqual(where(gone), []);
  });

  test('一次性客人就算被標成停用，也不在已停用那一份（他沒有停用）', () => {
    assert.deepEqual(CUSTOMER_LISTS.filter((l) => inCustomerList({ ...guest, active: false }, l)), ['oneTime']);
  });

  test('轉成我的客戶（oneTime: false）＝一般客戶，回到平常那一份', () => {
    assert.equal(isOneTime(converted), false);
    assert.deepEqual(CUSTOMER_LISTS.filter((l) => inCustomerList(converted, l)), ['active']);
    assert.deepEqual(toMyCustomer(), { oneTime: false });
  });

  test('沒給哪一份＝平常那一份（跟改之前一樣：在服務中的一般客戶）', () => {
    assert.equal(inCustomerList(regular), true);
    assert.equal(inCustomerList(stopped), false);
    assert.equal(inCustomerList(guest), false);
  });
});

describe('名字卡與新增客戶的提醒（fieldWarnings）', () => {
  const existing = [regular, guest];

  test('名字卡沒填電話與 LINE → 不講「沒有聯絡方式」', () => {
    const card = { ...oneTimeCustomer({ name: '客戶B' }), id: null };
    assert.equal(fieldWarnings(card, existing).contact, null);
    assert.deepEqual(warnings(card, existing), []);
  });

  test('名字卡同名照講（不管對方是一般還是一次性）', () => {
    const card = oneTimeCustomer({ name: '王小明' });
    assert.match(fieldWarnings(card, existing).name, /已經有 1 位客戶也叫「王小明」/);
    const card2 = oneTimeCustomer({ name: '客戶A' });
    assert.match(fieldWarnings(card2, existing).name, /已經有 1 位客戶也叫「客戶A」/);
  });

  test('名字卡病歷號撞到照講（可能是同一個人）', () => {
    const card = oneTimeCustomer({ name: '客戶B', chartNo: '1234' });
    assert.match(fieldWarnings(card, [{ id: 'c9', name: '王小明', chartNo: '00001234' }]).chartNo, /病歷號 1234 已經是王小明的/);
  });

  test('新增客戶打到一次性客人的名字 → 換成指路去轉的那一句', () => {
    const w = fieldWarnings({ name: '客戶A', phone: '0912' }, existing);
    assert.equal(w.name, GUEST_SAME_NAME);
    assert.match(w.name, /看一次性客人/);
    assert.match(w.name, /轉成我的客戶/);
    assert.ok(warnings({ name: '客戶A', phone: '0912' }, existing).includes(GUEST_SAME_NAME), '存檔前那一道也講');
  });

  test('同名的一般客戶與一次性客人都有 → 兩句都講', () => {
    const w = fieldWarnings({ name: '客戶A', phone: '0912' }, [...existing, { id: 'c4', name: '客戶A' }]);
    assert.match(w.name, /已經有 1 位客戶也叫「客戶A」/);
    assert.ok(w.name.includes(GUEST_SAME_NAME));
  });

  test('新增客戶打到一般客戶的名字、沒填聯絡方式 → 跟以前一模一樣', () => {
    const w = fieldWarnings({ name: '王小明' }, existing);
    assert.equal(w.name, '已經有 1 位客戶也叫「王小明」，確認不是同一個人嗎？');
    assert.equal(w.contact, '沒有電話也沒有 LINE，之後問時間會找不到人');
  });
});

describe('轉成我的客戶那一道（toMyCustomerConsequences）', () => {
  const exam = (status = 'done', over = {}) => ({
    courseId: 'course-checkup', courseName: '健檢', entitlementId: null, giftKind: null, oneTime: true,
    startsAt: '09:00', endsAt: '10:00', status, ...over,
  });
  const v = (id, date, slots, status = 'done') => ({ id, customerId: 'g1', date, status, slots });

  test('講會上清單、要加購才排得進壓表、不能轉回去', () => {
    const lines = toMyCustomerConsequences({ visits: [], coursesById });
    assert.ok(lines.some((l) => l.includes('客戶清單')));
    assert.ok(lines.some((l) => l.includes('加購') && l.includes('壓表')));
    assert.ok(lines.some((l) => l.includes('轉回')));
    assert.ok(!lines.some((l) => /一次性：不扣/.test(l)), '沒有一次性的段就不講那一句');
  });

  test('以前的 N 段照舊算一次性：數還算數的段（取消的不算）', () => {
    const visits = [
      v('v1', '2026-10-01', [exam('done'), exam('cancelled', { courseId: 'course-recovery' })]),
      v('v2', '2026-10-08', [exam('cancelled')], 'cancelled'),
    ];
    const lines = toMyCustomerConsequences({ visits, coursesById });
    assert.ok(lines.some((l) => l.includes('記的 1 段照舊算一次性')), lines.join('\n'));
  });

  test('一次健檢做完、還沒約二返 → 講「還欠 1 場二返」；約好接回去之後不講', () => {
    const done = v('v1', '2026-10-01', [exam('done')]);
    assert.ok(toMyCustomerConsequences({ visits: [done], coursesById }).some((l) => l.includes('還欠 1 場二返')));

    const second = v('v2', '2026-10-15', [{
      courseId: 'course-followup', courseName: '二返', entitlementId: null, giftKind: null, oneTime: true,
      followupForVisitId: 'v1', startsAt: '09:00', endsAt: '09:30', status: 'pending_confirm',
    }], 'pending_confirm');
    const lines = toMyCustomerConsequences({ visits: [done, second], coursesById });
    assert.ok(!lines.some((l) => l.includes('還欠')), lines.join('\n'));
    assert.ok(lines.some((l) => l.includes('記的 2 段照舊算一次性')));
  });
});

describe('原始碼：客戶清單與名字卡那一頁', () => {
  const list = readFileSync(fromRoot('public/js/ui/views/customers.js'), 'utf8');
  const detail = readFileSync(fromRoot('public/js/ui/views/customerDetail.js'), 'utf8');

  test('客戶清單列誰只問 inCustomerList()（不靠「他沒有額度」）', () => {
    assert.match(list, /rules\.inCustomerList\(customer, view\.list\)/);
    assert.doesNotMatch(list, /showInactive/);
  });

  test('名字卡那一頁沒有加購、額度、傳表單、長備註、停用', () => {
    const start = detail.indexOf('function paintGuest(');
    const end = detail.indexOf('\nfunction paintGuestEdit(');
    const body = detail.slice(start, end);
    assert.ok(start > 0 && end > start);
    for (const banned of ['data-add-ent', 'data-add-plan', 'bought', 'data-msgs', 'availability', 'data-danger', '長備註', '停用']) {
      assert.ok(!body.includes(banned), banned);
    }
  });

  test('轉成我的客戶寫的是 toMyCustomer()（oneTime: false，不拿掉那一格）', () => {
    assert.match(detail, /data\.update\(ctx\.id, rules\.toMyCustomer\(\)\)/);
    assert.doesNotMatch(detail, /deleteField/);
  });
});
