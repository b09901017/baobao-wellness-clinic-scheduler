// LINE 訊息產生器。SPEC 第 8.1、8.4 節。
//
// 這一支盯的是「訊息裡的日期與時間不能錯」，以及
// 「湊不出完整的一句話時要回空字串」—— 半句話被複製出去比沒有訊息更糟。
//
// 確認訊息本身的測試在 tests/tasks.test.js（它跟任務產生同一批做的），這裡不重複。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  askAvailabilityMessage, reminderMessage, offerSlotMessage, messagesFor,
} from '../public/js/domain/messages.js';

const TODAY = '2026-09-15';
const CUSTOMER = { name: '王小姐' };

const visit = (over = {}) => ({
  id: 'v1', date: '2026-09-16', status: 'confirmed',
  slots: [{ startsAt: '14:00', courseName: '復能' }],
  ...over,
});

describe('問這一輪的時間', () => {
  test('講的是要問的那個月', () => {
    assert.equal(
      askAvailabilityMessage(CUSTOMER, { month: '2026-10' }),
      '王小姐大哥/姐姐\n即將幫您安排 10 月的課程\n請問您 10 月有哪幾天不方便呢？',
    );
  });

  test('月份看不懂就回空字串', () => {
    for (const bad of ['', null, '2026-13', 'x']) {
      assert.equal(askAvailabilityMessage(CUSTOMER, { month: bad }), '');
    }
  });

  test('有連結就換一種問法，而且連結在最後一行', () => {
    const msg = askAvailabilityMessage(CUSTOMER, {
      month: '2026-10', link: 'https://example.app/form.html?t=abc',
    });
    assert.match(msg, /點下面這個連結/);
    assert.doesNotMatch(msg, /哪幾天不方便呢/, '有連結就不要再叫客戶用打字的回，不然連結白給了');
    assert.equal(msg.split('\n').pop(), 'https://example.app/form.html?t=abc');
  });

  test('稱呼兩個都給，不要自己判斷性別 —— 猜錯比她刪一個字貴', () => {
    assert.match(askAvailabilityMessage(CUSTOMER, { month: '2026-10' }), /^王小姐大哥\/姐姐$/m);
  });

  test('沒有名字也不要變成「undefined大哥」', () => {
    assert.match(askAvailabilityMessage({}, { month: '2026-10' }), /^大哥\/姐姐/);
    assert.match(offerSlotMessage(null, { date: '2026-09-18', startsAt: '14:00' }), /^您好，/);
  });
});

describe('來訪前的提醒', () => {
  test('是明天就講明天，順便還是給日期', () => {
    const msg = reminderMessage(CUSTOMER, visit(), { today: TODAY });
    assert.match(msg, /明天 9\/16\(三\)/);
    assert.match(msg, /14:00/);
    assert.match(msg, /復能的課程/);
  });

  test('不是明天就只給日期，不要騙人', () => {
    const msg = reminderMessage(CUSTOMER, visit({ date: '2026-09-18' }), { today: TODAY });
    assert.ok(!msg.includes('明天'));
    assert.match(msg, /9\/18\(五\)/);
  });

  test('一次來訪有好幾個課程就都列出來', () => {
    const msg = reminderMessage(CUSTOMER, visit({
      slots: [
        { startsAt: '14:00', courseName: '復能' },
        { startsAt: '15:15', courseName: '靜脈' },
      ],
    }), { today: TODAY });
    assert.match(msg, /復能、靜脈的課程/);
    // 時間只講第一個，跟確認訊息一致
    assert.match(msg, /14:00/);
    assert.ok(!msg.includes('15:15'));
  });

  test('沒有課程名就不要硬加一個「的」', () => {
    const msg = reminderMessage(CUSTOMER, visit({ slots: [{ startsAt: '14:00' }] }), { today: TODAY });
    assert.match(msg, /有課程/);
  });

  test('沒有來訪就回空字串', () => {
    assert.equal(reminderMessage(CUSTOMER, null, { today: TODAY }), '');
    assert.equal(reminderMessage(CUSTOMER, {}, { today: TODAY }), '');
  });
});

describe('臨時空出一格', () => {
  test('日期、時間區間、課程都在裡面', () => {
    assert.equal(
      offerSlotMessage(CUSTOMER, {
        date: '2026-09-18', startsAt: '14:00', endsAt: '15:00', courseName: '復能',
      }),
      '王小姐您好，9/18(五) 14:00–15:00 臨時空出一個復能的時段，請問您方便過來嗎？',
    );
  });

  test('沒有結束時間就只講開始', () => {
    const msg = offerSlotMessage(CUSTOMER, { date: '2026-09-18', startsAt: '14:00' });
    assert.match(msg, /9\/18\(五\) 14:00 臨時空出/);
  });

  test('缺日期或時間就回空字串', () => {
    assert.equal(offerSlotMessage(CUSTOMER, { startsAt: '14:00' }), '');
    assert.equal(offerSlotMessage(CUSTOMER, { date: '2026-09-18' }), '');
  });
});

describe('這位客戶現在用得到哪幾則', () => {
  test('永遠有「問下個月的時間」', () => {
    const list = messagesFor({ customer: CUSTOMER, visits: [], today: TODAY });
    assert.deepEqual(list.map((m) => m.id), ['ask']);
    assert.match(list[0].text, /10 月/);
  });

  test('有等回覆的來訪才給確認訊息', () => {
    const list = messagesFor({
      customer: CUSTOMER,
      visits: [visit({ status: 'pending_confirm' })],
      today: TODAY,
    });
    assert.deepEqual(list.map((m) => m.id).sort(), ['ask', 'confirm', 'reminder']);
    assert.match(list.find((m) => m.id === 'confirm').text, /9\/16/);
  });

  test('已確認的來訪只給提醒，不再問一次可不可以', () => {
    const list = messagesFor({ customer: CUSTOMER, visits: [visit()], today: TODAY });
    assert.deepEqual(list.map((m) => m.id), ['ask', 'reminder']);
  });

  test('取消、刪除與過去的來訪都不算', () => {
    const list = messagesFor({
      customer: CUSTOMER,
      visits: [
        visit({ id: 'v1', status: 'cancelled' }),
        visit({ id: 'v2', deletedAt: 'x' }),
        visit({ id: 'v3', date: '2026-09-01' }),
      ],
      today: TODAY,
    });
    assert.deepEqual(list.map((m) => m.id), ['ask']);
  });

  test('每一則都是完整的一句話，不會有空的', () => {
    const list = messagesFor({
      customer: CUSTOMER,
      visits: [visit({ status: 'pending_confirm' })],
      today: TODAY,
    });
    assert.ok(list.every((m) => m.text.trim().length > 10), JSON.stringify(list));
    assert.ok(list.every((m) => m.label));
  });
});
