// 只取消其中一段時，取消理由記在那一段上、讀取卡片看得到（abovee-status-follows-photo-2026-10-15/11）。
//
// 她 10/15：「每一段自己的取消理由，可以就像記的話那樣，如果取消的話，就可以顯示取消理由，
// 整天取消就先不用顯示沒關係，看的到 每一段自己的取消理由就好」
//
// 以前取消理由只有整筆那一格，`settle()` 只在整天都取消時寫 —— 一天還有別段活著時，她打的那一句一個字都沒存。
//
// 例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { applyStatus, slotCancelReasonOf } from '../public/js/domain/visits.js';

const slot = (startsAt, status = 'confirmed') => ({ courseId: 'sis', startsAt, endsAt: startsAt, status });
const visit = (slots, over = {}) => ({
  id: 'v1', customerId: 'c1', customerName: '客戶A', date: '2026-09-10', status: 'confirmed', slots, ...over,
});
const AT = '2026-09-01T03:00:00.000Z';

describe('寫：只取消一段時記在那一段上', () => {
  test('一天兩段、取消第一段、打了理由 → 第一段有、第二段沒有、整筆照舊是空的', () => {
    const next = applyStatus(visit([slot('10:00'), slot('14:00')]), 'cancelled', { slotIndex: 0, reason: '客人要改時間', at: AT });
    assert.equal(next.slots[0].status, 'cancelled');
    assert.equal(next.slots[0].cancelReason, '客人要改時間');
    assert.equal(next.slots[1].cancelReason ?? null, null);
    assert.equal(next.cancelReason ?? null, null, '那一天還有別段活著，不是整天取消');
  });

  test('那一天只有一段（取消掉就是整天）：那一段有、整筆那一格照舊也有', () => {
    const next = applyStatus(visit([slot('10:00')]), 'cancelled', { slotIndex: 0, reason: '客人要改時間', at: AT });
    assert.equal(next.slots[0].cancelReason, '客人要改時間');
    assert.equal(next.status, 'cancelled');
    assert.equal(next.cancelReason, '客人要改時間');
  });

  test('整天取消（不帶 slotIndex）：時段上不寫，整筆照舊寫', () => {
    const next = applyStatus(visit([slot('10:00'), slot('14:00')]), 'cancelled', { reason: '颱風', at: AT });
    assert.deepEqual(next.slots.map((s) => s.cancelReason ?? null), [null, null]);
    assert.equal(next.cancelReason, '颱風');
  });

  test('沒打理由、只打空白：存成 null', () => {
    for (const reason of [null, '', '   ']) {
      const next = applyStatus(visit([slot('10:00'), slot('14:00')]), 'cancelled', { slotIndex: 0, reason, at: AT });
      assert.equal(next.slots[0].cancelReason, null, JSON.stringify(reason));
    }
  });

  test('前後的空白拿掉', () => {
    const next = applyStatus(visit([slot('10:00'), slot('14:00')]), 'cancelled', { slotIndex: 1, reason: '  客人生病 ', at: AT });
    assert.equal(next.slots[1].cancelReason, '客人生病');
  });

  test('別的轉移不寫這一格', () => {
    const next = applyStatus(visit([slot('10:00', 'pending_confirm'), slot('14:00')]), 'confirmed', { slotIndex: 0, reason: '不該寫', at: AT });
    assert.equal(next.slots[0].cancelReason ?? null, null);
  });
});

describe('讀：slotCancelReasonOf()', () => {
  test('那一段取消了、身上有字 → 那一句', () => {
    const v = visit([{ ...slot('10:00', 'cancelled'), cancelReason: '客人要改時間' }, slot('14:00')]);
    assert.equal(slotCancelReasonOf(v, v.slots[0]), '客人要改時間');
    assert.equal(slotCancelReasonOf(v, v.slots[1]), null);
  });

  test('還活著的段身上就算有字也不回', () => {
    const v = visit([{ ...slot('10:00'), cancelReason: '殘留' }]);
    assert.equal(slotCancelReasonOf(v, v.slots[0]), null);
  });

  test('整天取消只有整筆那一格：不回（她說整天取消先不用顯示）', () => {
    const v = visit([slot('10:00', 'cancelled')], { status: 'cancelled', cancelReason: '颱風' });
    assert.equal(slotCancelReasonOf(v, v.slots[0]), null);
  });

  test('沒有字、空白：不回', () => {
    const v = visit([{ ...slot('10:00', 'cancelled'), cancelReason: '  ' }, slot('14:00', 'cancelled')]);
    assert.equal(slotCancelReasonOf(v, v.slots[0]), null);
    assert.equal(slotCancelReasonOf(v, v.slots[1]), null);
  });
});

describe('讀取卡片照「記的話」的畫法（原始碼掃描：calendar.js 進不了 node）', () => {
  const CALENDAR = readFileSync(new URL('../public/js/ui/views/calendar.js', import.meta.url), 'utf8');
  const from = CALENDAR.indexOf('export function visitReadHtml(');
  const body = CALENDAR.slice(from, CALENDAR.indexOf('\nfunction ', from + 1));

  test('目錄那一列與指名一段那一列都畫，讀法只走 slotCancelReasonOf()', () => {
    assert.ok(from >= 0, '找不到 visitReadHtml()');
    assert.match(body, /slotCancelLine\(visit, s\)/, '目錄那一張：那一段那一列裡');
    assert.match(body, /取消理由/, '指名一段那一張：底下那一列');
    assert.match(CALENDAR, /function slotCancelLine\(visit, slot\)[\s\S]{0,200}slotCancelReasonOf\(visit, slot\)/);
    assert.doesNotMatch(CALENDAR, /\.cancelReason\b/, '畫面不自己讀那一格');
  });
});
