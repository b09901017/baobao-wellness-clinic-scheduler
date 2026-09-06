// 備忘錄／SOP。ADR-0067（它是拿來讀的，不是拿來勾的）與 ADR-0069（一大塊字）。
//
// 這一支測的是三件事：**存得下去嗎、掛到哪一筆來訪、一疊卡的順序**。
// 排版與動畫在 CSS，不在這裡。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalize, bodyOf, validatePlaybook, linesOf, previewOf, deckOrder, matches,
  playbooksForVisit, playbooksFor, MAX_TITLE, MAX_BODY, PREVIEW_LINES,
} from '../public/js/domain/playbook.js';

const pb = (over = {}) => ({
  id: 'pb-iv',
  title: '營養點滴',
  courseIds: ['course-iv'],
  body: '飯後打針\n先問有沒有吃東西\n血管難打的先看註記',
  ...over,
});

// ---------- 形狀 ----------

describe('存檔前的整理', () => {
  test('四個欄位，多的不留 —— 舊形狀的章節、分類、釘選一起清掉', () => {
    // 第四格是 2026-09-06 加的「掛哪幾家合作機構」（ADR-0076）。
    const out = normalize({
      title: '  營養點滴  ',
      courseIds: ['a', 'a', 'b', null, ''],
      partners: ['自然美', '自然美', '  ', null],
      body: '  飯後打針  ',
      tag: '點滴',
      pinned: true,
      sections: [{ heading: 'x', when: 'before', body: 'y' }],
    });
    assert.deepEqual(Object.keys(out).sort(), ['body', 'courseIds', 'partners', 'title']);
    assert.equal(out.title, '營養點滴');
    assert.deepEqual(out.courseIds, ['a', 'b'], '去重、空的丟掉');
    assert.deepEqual(out.partners, ['自然美'], '同上，而且前後空白去掉');
  });

  test('沒掛機構就是空陣列 —— 既有那幾份一個字都不用改', () => {
    assert.deepEqual(normalize({ title: 't', body: 'x' }).partners, []);
  });

  test('內文只去頭尾，中間的縮排原樣留著 —— 她可能刻意用縮排分層', () => {
    const out = normalize({ title: 't', body: '\n第一段\n  縮排的一行\n\n最後\n\n' });
    assert.equal(out.body, '第一段\n  縮排的一行\n\n最後');
  });

  test('沒有 courseIds 也不會炸', () => {
    assert.deepEqual(normalize({ title: 't', body: 'x' }).courseIds, []);
  });
});

describe('舊形狀讀得回來（2026-09-03 那一版）', () => {
  const legacy = {
    id: 'pb-old',
    title: '營養點滴',
    sections: [
      { heading: '前情提醒', when: 'before', body: '飯後打針' },
      { heading: '', when: 'onday', body: '確認血管' },
    ],
  };

  test('章節接成一大塊，節標題自成一行，順序照原本的節', () => {
    assert.equal(bodyOf(legacy), '前情提醒\n飯後打針\n\n確認血管');
  });

  test('新的 body 有東西時就不看舊的 —— 存過一次之後舊欄位是死的', () => {
    assert.equal(bodyOf({ ...legacy, body: '新的' }), '新的');
  });

  test('兩邊都空的回空字串，不回 undefined', () => {
    assert.equal(bodyOf({}), '');
    assert.equal(bodyOf(null), '');
  });
});

// ---------- 驗證 ----------

describe('存得下去嗎', () => {
  test('好好的一份沒有錯誤', () => {
    assert.deepEqual(validatePlaybook(pb()), []);
  });

  test('沒有標題', () => {
    assert.deepEqual(validatePlaybook(pb({ title: '   ' })), ['要有一個標題']);
  });

  test(`標題最多 ${MAX_TITLE} 字`, () => {
    const errors = validatePlaybook(pb({ title: '字'.repeat(MAX_TITLE + 1) }));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /標題太長/);
  });

  test('內容空的 —— 打開會什麼都沒有', () => {
    const errors = validatePlaybook(pb({ body: '  \n \n ' }));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /內容是空的/);
  });

  test(`內容最多 ${MAX_BODY} 字`, () => {
    const errors = validatePlaybook(pb({ body: '字'.repeat(MAX_BODY + 1) }));
    assert.match(errors[0], /內容太長/);
  });

  test('舊形狀的章節也算內容 —— 讀出來不是空的就存得下去', () => {
    const legacy = { title: 't', sections: [{ heading: '', when: null, body: '有東西' }] };
    assert.deepEqual(validatePlaybook(legacy), []);
  });
});

// ---------- 行 ----------

describe('拆成行', () => {
  test('空行丟掉，行尾的空白也去掉', () => {
    assert.deepEqual(linesOf({ body: 'a  \n\n  \nb' }), ['a', 'b']);
  });

  test('行首的縮排留著 —— 她可能刻意用它分層', () => {
    assert.deepEqual(linesOf({ body: 'a\n  b' }), ['a', '  b']);
  });

  test('前幾行加上「還有幾行」', () => {
    const many = { body: Array.from({ length: 7 }, (_, i) => `第 ${i + 1} 行`).join('\n') };
    const { lines, rest } = previewOf(many);
    assert.equal(lines.length, PREVIEW_LINES);
    assert.equal(lines[0], '第 1 行');
    assert.equal(rest, 7 - PREVIEW_LINES);
  });

  test('行數剛好或更少時 rest 是 0，不是負的', () => {
    assert.equal(previewOf({ body: 'a\nb' }).rest, 0);
  });

  test('空的內文回空陣列 —— 呼叫端靠它決定整塊畫不畫', () => {
    assert.deepEqual(previewOf({ body: '' }), { lines: [], rest: 0 });
  });
});

// ---------- 一疊卡的順序 ----------

describe('一疊卡的順序（deckOrder）', () => {
  const at = (ms) => ({ toMillis: () => ms });

  test('她寫下來的順序，新的在最後面', () => {
    const rows = [
      pb({ id: 'c', createdAt: at(300) }),
      pb({ id: 'a', createdAt: at(100) }),
      pb({ id: 'b', createdAt: at(200) }),
    ];
    assert.deepEqual(deckOrder(rows).map((p) => p.id), ['a', 'b', 'c']);
  });

  test('createdAt 讀不出來的排最後，同一批之內維持進來的順序', () => {
    const rows = [
      pb({ id: 'x' }),
      pb({ id: 'a', createdAt: at(100) }),
      pb({ id: 'y', createdAt: null }),
    ];
    assert.deepEqual(deckOrder(rows).map((p) => p.id), ['a', 'x', 'y']);
  });

  test('ISO 字串、Date、毫秒數都吃得下', () => {
    const rows = [
      pb({ id: 'iso', createdAt: '2026-09-03T00:00:00.000Z' }),
      pb({ id: 'date', createdAt: new Date('2026-09-01T00:00:00.000Z') }),
      pb({ id: 'ms', createdAt: Date.parse('2026-09-02T00:00:00.000Z') }),
    ];
    assert.deepEqual(deckOrder(rows).map((p) => p.id), ['date', 'ms', 'iso']);
  });

  test('已刪除的不進這一疊', () => {
    const rows = [pb({ id: 'a', createdAt: at(1) }), pb({ id: 'gone', deletedAt: 'x' })];
    assert.deepEqual(deckOrder(rows).map((p) => p.id), ['a']);
  });

  test('空的也不會炸', () => {
    assert.deepEqual(deckOrder(), []);
    assert.deepEqual(deckOrder(null), []);
  });
});

// ---------- 搜尋 ----------

describe('搜尋', () => {
  test('標題與內文都比，大小寫不分', () => {
    assert.equal(matches(pb(), '點滴'), true);
    assert.equal(matches(pb(), '血管'), true);
    assert.equal(matches(pb({ title: 'INDIBA' }), 'indiba'), true);
  });

  test('比不到就是 false', () => {
    assert.equal(matches(pb(), '外檢'), false);
  });

  test('空字串一律 true —— 沒在搜尋的時候不篩掉任何一份', () => {
    assert.equal(matches(pb(), ''), true);
    assert.equal(matches(pb(), '   '), true);
  });

  test('舊形狀的章節內容也搜得到', () => {
    const legacy = { title: 't', sections: [{ heading: '', when: null, body: '飯後打針' }] };
    assert.equal(matches(legacy, '飯後'), true);
  });
});

// ---------- 掛到哪一筆來訪 ----------

describe('掛到哪一筆來訪', () => {
  const iv = pb({ id: 'pb-iv', courseIds: ['course-iv'] });
  const rehab = pb({ id: 'pb-rehab', courseIds: ['course-rehab'], title: '復健科流程' });
  const all = [iv, rehab];

  const visit = (courseIds) => ({ slots: courseIds.map((courseId) => ({ courseId })) });

  test('比的是時段的課程', () => {
    assert.deepEqual(playbooksForVisit(all, visit(['course-iv'])).map((p) => p.id), ['pb-iv']);
  });

  test('一天兩個課程就掛到兩份', () => {
    const found = playbooksForVisit(all, visit(['course-iv', 'course-rehab']));
    assert.deepEqual(found.map((p) => p.id), ['pb-iv', 'pb-rehab']);
  });

  test('同一天兩段同一個課程，同一份只回一次', () => {
    const found = playbooksForVisit(all, visit(['course-iv', 'course-iv']));
    assert.deepEqual(found.map((p) => p.id), ['pb-iv']);
  });

  test('沒有時段、沒有來訪都回空陣列', () => {
    assert.deepEqual(playbooksForVisit(all, { slots: [] }), []);
    assert.deepEqual(playbooksForVisit(all, null), []);
  });

  test('已刪除的不掛', () => {
    const dead = [pb({ id: 'pb-iv', courseIds: ['course-iv'], deletedAt: 'x' })];
    assert.deepEqual(playbooksForVisit(dead, visit(['course-iv'])), []);
  });

  test('一個課程都沒掛的那一份永遠不會自己浮出來', () => {
    const loose = [pb({ id: 'pb-loose', courseIds: [] })];
    assert.deepEqual(playbooksForVisit(loose, visit(['course-iv'])), []);
  });
});

// ---------- 這一支不該有的東西 ----------

describe('它不是待辦', () => {
  test('沒有 done、沒有 dueDate、沒有時機 —— 一放進來它就變成第二個待辦中心', () => {
    const out = normalize(pb({ done: false, dueDate: '2026-09-10', sections: [] }));
    assert.equal('done' in out, false);
    assert.equal('dueDate' in out, false);
    assert.equal('when' in out, false);
  });
});


// ADR-0076：備忘錄也可以掛合作機構。**它仍然不綁某一位客戶** ——
// 綁的是一家機構（跟課程一樣是主檔上的東西），差別只有它是**透過客戶**浮出來的。
describe('掛合作機構的那幾份', () => {
  const playbooks = [
    { id: 'p-drip', title: '營養點滴', courseIds: ['c-drip'], body: 'x' },
    { id: 'p-nb', title: '自然美對接', partners: ['自然美'], body: 'y' },
    { id: 'p-both', title: '兩邊都掛', courseIds: ['c-drip'], partners: ['自然美'], body: 'z' },
    { id: 'p-gone', title: '刪掉的', partners: ['自然美'], body: 'w', deletedAt: 'x' },
  ];
  const visit = { slots: [{ courseId: 'c-drip' }] };
  const withNb = { partners: ['自然美'] };

  test('課程配到的照舊', () => {
    assert.deepEqual(
      playbooksFor({ playbooks, visit }).map((p) => p.id), ['p-drip', 'p-both'],
    );
  });

  test('這位客戶掛了自然美，那一份就浮出來', () => {
    assert.deepEqual(
      playbooksFor({ playbooks, visit: { slots: [] }, customer: withNb }).map((p) => p.id),
      ['p-nb', 'p-both'],
    );
  });

  test('兩邊都掛的只回一次 —— 同一份不該畫兩塊', () => {
    const out = playbooksFor({ playbooks, visit, customer: withNb });
    assert.deepEqual(out.map((p) => p.id), ['p-drip', 'p-nb', 'p-both']);
  });

  test('沒掛那一家的客戶不會浮出來', () => {
    assert.deepEqual(
      playbooksFor({ playbooks, visit: { slots: [] }, customer: { partners: ['別家'] } }), [],
    );
  });

  test('拿不到客戶就只回課程配到的 —— 少一份提醒比整塊消失好', () => {
    assert.deepEqual(playbooksFor({ playbooks, visit }).map((p) => p.id), ['p-drip', 'p-both']);
  });

  test('刪掉的一份都不回', () => {
    assert.ok(!playbooksFor({ playbooks, visit, customer: withNb }).some((p) => p.id === 'p-gone'));
  });

  test('舊的那一支還在，而且行為一模一樣', () => {
    assert.deepEqual(
      playbooksForVisit(playbooks, visit).map((p) => p.id),
      playbooksFor({ playbooks, visit }).map((p) => p.id),
    );
  });
});
