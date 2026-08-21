// 客戶自己填的那份時間。
//
// 最重要的一條在最下面：**產生的原文餵回解析器要得到同一組規則**。
// 沒有它，她在收集畫面按一次「用原文重新解析」，客戶講的話就會變成別的意思。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  newInvite, inviteState, formLink, splitByInvite,
  normalizePicks, groupPicks, picksToRules, picksToText, rawTextFrom,
  describePicks, describeResponse, collectionFrom, validateResponse, outOfRange, monthGrid,
} from '../public/js/domain/availabilityForm.js';
import { parseAvailability, validateCollection } from '../public/js/domain/availability.js';

// ---------- 邀請 ----------

test('邀請的有效期就是那個月整月', () => {
  const invite = newInvite({
    customerId: 'c1', customerName: '王小明', month: '2026-09', sentAt: '2026-08-21',
  });
  assert.equal(invite.validFrom, '2026-09-01');
  assert.equal(invite.validTo, '2026-09-30');
  assert.equal(invite.month, '2026-09');
});

test('月份不合法就不要湊一份邀請出來', () => {
  assert.equal(newInvite({ month: '2026-13', sentAt: '2026-08-21' }), null);
  assert.equal(newInvite({ month: '九月', sentAt: '2026-08-21' }), null);
});

test('過期的連結不算開著', () => {
  const invite = newInvite({ customerId: 'c1', month: '2026-09', sentAt: '2026-08-21' });
  assert.equal(inviteState(invite, '2026-09-15'), 'open');
  assert.equal(inviteState(invite, '2026-10-01'), 'expired');
  assert.equal(inviteState(invite, '2026-09-15', { submitted: true }), 'used');
  assert.equal(inviteState(null, '2026-09-15'), 'none');
});

test('連結是獨立入口，不是 hash 路由', () => {
  assert.equal(formLink('https://example.app/', 'abc123'), 'https://example.app/form.html?t=abc123');
  assert.equal(formLink('https://example.app', ''), '');
});

// ---------- 三區 ----------

const askRow = (id, state) => ({ customerId: id, customerName: id, state, remaining: 5 });

test('發出連結而且還沒過期的排進第三區，數字不會消失', () => {
  const invites = [newInvite({ customerId: 'c2', month: '2026-09', sentAt: '2026-08-20' })];
  const out = splitByInvite({
    rows: [askRow('c1', 'never'), askRow('c2', 'expired'), askRow('c3', 'expired')],
    invites,
    today: '2026-08-21',
  });

  assert.deepEqual(out.never.map((r) => r.customerId), ['c1']);
  assert.deepEqual(out.expired.map((r) => r.customerId), ['c3']);
  assert.deepEqual(out.sent.map((r) => r.customerId), ['c2']);
  // 三區加起來還是全部的人 —— 首頁那個數字不減掉等回覆的人（ADR-0033）
  assert.equal(out.never.length + out.expired.length + out.sent.length, 3);
});

test('過期的邀請要讓那一位回到該重問了', () => {
  const invites = [newInvite({ customerId: 'c1', month: '2026-09', sentAt: '2026-08-01' })];
  const out = splitByInvite({ rows: [askRow('c1', 'expired')], invites, today: '2026-10-05' });
  assert.equal(out.sent.length, 0);
  assert.deepEqual(out.expired.map((r) => r.customerId), ['c1']);
});

// ---------- 勾選 ----------

test('重複與不合法的勾選清掉，順序排好', () => {
  const picks = normalizePicks({
    weekdays: [{ weekday: 5 }, { weekday: 5, partOfDay: 'pm' }, { weekday: 9 }],
    dates: [{ date: '2026-09-20' }, { date: '2026-09-18' }, { date: '不是日期' }],
  });
  assert.deepEqual(picks.weekdays, [{ weekday: 5, partOfDay: 'pm' }]);
  assert.deepEqual(picks.dates.map((d) => d.date), ['2026-09-18', '2026-09-20']);
});

// ---------- 轉成規則 ----------

test('連續兩天以上就併成一條範圍', () => {
  const rules = picksToRules({
    dates: [
      { date: '2026-09-22' }, { date: '2026-09-23' }, { date: '2026-09-24' },
      { date: '2026-09-27' }, { date: '2026-09-28' },
      { date: '2026-09-30' },
    ],
  });
  assert.deepEqual(rules, [
    { kind: 'exclude_range', from: '2026-09-22', to: '2026-09-24' },
    { kind: 'exclude_range', from: '2026-09-27', to: '2026-09-28' },
    { kind: 'exclude_date', date: '2026-09-30' },
  ]);
});

// 2026 年 9 月的禮拜五：4、11、18、25
const SEPT_FRIDAYS = ['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25'];

test('整個月的禮拜五都點掉 → 收成一條「每個禮拜五不行」', () => {
  const rules = picksToRules(
    { dates: SEPT_FRIDAYS.map((date) => ({ date })) },
    { month: '2026-09' },
  );
  assert.deepEqual(rules, [{ kind: 'exclude_weekday', weekday: 5 }]);
});

test('少點一個禮拜五就不收 —— 那一天他是真的可以', () => {
  const rules = picksToRules(
    { dates: SEPT_FRIDAYS.slice(0, 3).map((date) => ({ date })) },
    { month: '2026-09' },
  );
  assert.equal(rules.every((r) => r.kind !== 'exclude_weekday'), true);
  assert.equal(rules.some((r) => r.kind === 'exclude_range'), false, '4、11、18 不連續，不該併成範圍');
});

test('半天別不一致就不收成星期', () => {
  const dates = SEPT_FRIDAYS.map((date, i) => ({ date, partOfDay: i ? 'pm' : 'am' }));
  const rules = picksToRules({ dates }, { month: '2026-09' });
  assert.equal(rules.every((r) => r.kind !== 'exclude_weekday'), true);
});

test('整個禮拜五的下午都點掉 → 收成一條帶半天的星期', () => {
  const dates = SEPT_FRIDAYS.map((date) => ({ date, partOfDay: 'pm' }));
  assert.deepEqual(
    picksToRules({ dates }, { month: '2026-09' }),
    [{ kind: 'exclude_weekday', weekday: 5, partOfDay: 'pm' }],
  );
});

test('整個月都點掉 → 一條範圍，不是七條星期', () => {
  const dates = monthGrid('2026-09').filter((c) => c.date).map((c) => ({ date: c.date }));
  assert.deepEqual(
    picksToRules({ dates }, { month: '2026-09' }),
    [{ kind: 'exclude_range', from: '2026-09-01', to: '2026-09-30' }],
  );
  assert.deepEqual(describePicks({ dates }, { month: '2026-09' }), ['整個 9 月都不行']);
});

test('沒有給月份就只做連續收合，不推星期', () => {
  const g = groupPicks({ dates: SEPT_FRIDAYS.map((date) => ({ date })) });
  assert.deepEqual(g.weekdays, []);
  assert.equal(g.dates.length, 4);
});

test('半天不行的日子永遠不會被併進範圍', () => {
  // 併進去會把 9/23 真的有空的上午一起吃掉
  const rules = picksToRules({
    dates: [
      { date: '2026-09-22' },
      { date: '2026-09-23', partOfDay: 'pm' },
      { date: '2026-09-24' },
    ],
  }, { month: '2026-09' });
  assert.deepEqual(rules, [
    { kind: 'exclude_date', date: '2026-09-22' },
    { kind: 'exclude_date', date: '2026-09-23', partOfDay: 'pm' },
    { kind: 'exclude_date', date: '2026-09-24' },
  ]);
});

test('轉出來的規則不標 manual —— 標了重新解析會變兩份', () => {
  const rules = picksToRules({ weekdays: [{ weekday: 5 }] }, { month: '2026-09' });
  assert.equal(rules.every((r) => r.manual === undefined), true);
});

// ---------- 原文 ----------

test('原文的第二行是客戶自己打的那段，照抄', () => {
  const raw = rawTextFrom({
    weekdays: [{ weekday: 5, partOfDay: 'pm' }],
    dates: [{ date: '2026-09-18' }],
    freeText: '除非臨時牙齒有狀況必須馬上去看診',
  });
  assert.equal(raw, '每個禮拜五下午不行、9/18 不行\n除非臨時牙齒有狀況必須馬上去看診');
});

test('什麼都沒勾也要有原文 —— 收集不收空的原文', () => {
  const raw = rawTextFrom({});
  assert.equal(raw, '這個月都可以');
  assert.equal(validateCollection({
    rawText: raw, collectedAt: '2026-08-21', validFrom: '2026-09-01', validTo: '2026-09-30', rules: [],
  }).length, 0);
});

// ---------- 這一條最重要 ----------

test('產生的原文餵回解析器要得到同一組規則', () => {
  const picks = {
    // 整個月的禮拜五都點掉 → 會被收成一條星期，原文也要跟著收
    dates: [
      ...SEPT_FRIDAYS.map((date) => ({ date })),
      { date: '2026-09-17' },
      { date: '2026-09-20', partOfDay: 'am' },
      { date: '2026-09-22' }, { date: '2026-09-23' }, { date: '2026-09-24' },
    ],
  };

  const mine = picksToRules(picks, { month: '2026-09' });
  assert.equal(mine.some((r) => r.kind === 'exclude_weekday'), true, '這個案例要涵蓋收合後的星期');

  const { rules: reparsed } = parseAvailability(
    picksToText(picks, { month: '2026-09' }),
    { year: 2026 },
  );

  const key = (r) => JSON.stringify(Object.entries(r).sort());
  assert.deepEqual(
    reparsed.map(key).sort(),
    mine.map(key).sort(),
    '解析器把自己產生的原文讀成了別的意思 —— 她按一次「用原文重新解析」就會拿到不一樣的規則',
  );
});

test('沒有勾任何東西時原文不會解析出規則，但也不會炸', () => {
  const { rules, unparsed } = parseAvailability(rawTextFrom({}), { year: 2026 });
  assert.deepEqual(rules, []);
  assert.equal(unparsed.length, 1);
});

// ---------- 複述 ----------

test('複述給客戶看的一定要有星期，而且不含他自己打的那一段', () => {
  const picks = {
    weekdays: [{ weekday: 5 }],
    dates: [{ date: '2026-09-17', partOfDay: 'pm' }],
    freeText: '月底要出國',
  };
  assert.deepEqual(describePicks(picks), [
    '整個禮拜五不行',
    '9/17(四) 只有下午不行',
  ], '確認那一頁的自由欄還在編輯中，混進複述會變成打一個字上面就多一行');

  assert.deepEqual(describeResponse({ ...picks, month: '2026-09' }), [
    '整個禮拜五不行',
    '9/17(四) 只有下午不行',
    '月底要出國',
  ]);
});

test('連續的日子複述成一列，而且每一列都自己說得完整', () => {
  const lines = describePicks({
    dates: [{ date: '2026-09-01' }, { date: '2026-09-02' }, { date: '2026-09-03' }],
  });
  assert.deepEqual(lines, ['9/1(二) ~ 9/3(四) 整天不行']);
});

test('什麼都沒勾的複述講的是一句完整的話，不是空白', () => {
  assert.deepEqual(describePicks({}), ['這個月都可以，沒有不方便的日子']);
});

// ---------- 收下 ----------

test('收下之後是一份合法的本輪可用性', () => {
  const invite = newInvite({ customerId: 'c1', month: '2026-09', sentAt: '2026-08-21' });
  const record = collectionFrom(
    {
      token: 't1',
      weekdays: [{ weekday: 5 }],
      dates: [{ date: '2026-09-18' }],
      freeText: '9/22 出國八天',
    },
    invite,
    { today: '2026-08-25' },
  );

  assert.deepEqual(validateCollection(record), []);
  assert.equal(record.source, 'form');
  assert.equal(record.collectedAt, '2026-08-25', '收集日期是她收下的那天，不是客戶送出的那天');
  assert.match(record.rawText, /9\/22 出國八天$/);
});

// ---------- 驗證 ----------

test('什麼都沒勾是合法的答案', () => {
  assert.deepEqual(
    validateResponse({ token: 't', customerId: 'c1', month: '2026-09', weekdays: [], dates: [] }),
    [],
  );
});

test('形狀不對的擋下來', () => {
  const errors = validateResponse({
    token: 't', customerId: 'c1', month: '2026-9',
    dates: [{ date: '2026-02-30' }],
  });
  assert.equal(errors.includes('月份不合法'), true);
  assert.equal(errors.includes('日期不合法'), true);
});

test('勾到那個月以外的日子要看得出來', () => {
  const invite = newInvite({ customerId: 'c1', month: '2026-09', sentAt: '2026-08-21' });
  assert.deepEqual(
    outOfRange({ dates: [{ date: '2026-10-02' }, { date: '2026-09-30' }] }, invite),
    ['2026-10-02'],
  );
});

// ---------- 月曆 ----------

test('月曆補到禮拜一，補的那幾格是空的', () => {
  const cells = monthGrid('2026-09', { today: '2026-09-10' });
  // 2026-09-01 是禮拜二，所以前面補一格
  assert.equal(cells[0].date, null);
  assert.equal(cells[1].date, '2026-09-01');
  assert.equal(cells.filter((c) => c.date).length, 30);
  assert.equal(cells.find((c) => c.date === '2026-09-09').past, true);
  assert.equal(cells.find((c) => c.date === '2026-09-10').past, false);
});
