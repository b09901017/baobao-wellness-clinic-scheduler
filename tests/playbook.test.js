// 備忘錄／SOP。ADR-0067。
//
// 這一支盯著三件事：
//
//   1. 存進去的形狀是乾淨的（空節丟掉、空字串變 null、分類去重）
//   2. **哪一節會自己浮出來**只有一份判斷（`whenForVisit()`）——
//      同一筆來訪在兩個畫面浮出不同的一節，她不會知道哪個算數
//   3. 一份備忘錄掛到兩段同樣的課程時只回一次

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalize, validatePlaybook, linesOf, groupByTag, tagsOf, matches,
  playbooksForVisit, whenForVisit, sectionFor, whensOf, whenLabel,
  SECTION_WHEN, NO_TAG, MAX_SECTIONS,
} from '../public/js/domain/playbook.js';

const section = (over = {}) => ({ heading: '前情提醒', when: 'before', body: '飯後打針', ...over });
const book = (over = {}) => ({
  id: 'p1', title: '營養點滴', tag: '點滴', courseIds: ['course-iv-drip'],
  sections: [section()], pinned: false, ...over,
});

describe('存進去的形狀', () => {
  test('空字串的分類變成 null —— 不然清單上會長出一個沒有名字的群組', () => {
    assert.equal(normalize({ title: 'x', tag: '   ', sections: [section()] }).tag, null);
  });

  test('整節都空白的丟掉 —— 存進去只會在閱讀頁上留一塊空的', () => {
    const p = normalize({
      title: 'x',
      sections: [section(), { heading: '  ', when: 'onday', body: '' }],
    });
    assert.equal(p.sections.length, 1);
  });

  test('只有標題沒有內容的那一節留著，讓 validate 講出是哪一節', () => {
    const p = normalize({ title: 'x', sections: [{ heading: '當天', body: '' }] });
    assert.equal(p.sections.length, 1);
    assert.match(validatePlaybook(p).join(''), /第 1 節/);
  });

  test('認不得的時機退回「隨時看」，不要存一個看不懂的值', () => {
    const p = normalize({ title: 'x', sections: [section({ when: '亂填' })] });
    assert.equal(p.sections[0].when, null);
  });

  test('掛到同一個課程兩次只算一次', () => {
    const p = normalize({ title: 'x', courseIds: ['a', 'a', 'b'], sections: [section()] });
    assert.deepEqual(p.courseIds, ['a', 'b']);
  });

  test('內文只去頭尾空白，中間的縮排留著 —— 她可能刻意用它分層', () => {
    const p = normalize({ title: 'x', sections: [section({ body: '\n一\n  二\n' })] });
    assert.equal(p.sections[0].body, '一\n  二');
  });
});

describe('存檔前的檢查', () => {
  test('要有標題', () => {
    assert.match(validatePlaybook({ sections: [section()] }).join(''), /標題/);
  });

  test('一節都沒有就擋下來 —— 打開是空的那一份沒有意義', () => {
    assert.match(validatePlaybook({ title: 'x', sections: [] }).join(''), /至少要寫一節/);
  });

  test('節數有上限，而且訊息要講出現在有幾節', () => {
    const many = Array.from({ length: MAX_SECTIONS + 1 }, () => section());
    const errors = validatePlaybook({ title: 'x', sections: many });
    assert.match(errors.join(''), new RegExp(`${MAX_SECTIONS + 1} 節`));
  });

  test('一份正常的通得過', () => {
    assert.deepEqual(validatePlaybook(book()), []);
  });
});

describe('一節拆成幾行', () => {
  test('空行丟掉 —— 不然閱讀頁上會出現一個空的項目符號', () => {
    assert.deepEqual(linesOf({ body: '一\n\n\n二\n   \n三' }), ['一', '二', '三']);
  });

  test('沒有內容就是空陣列', () => {
    assert.deepEqual(linesOf({}), []);
    assert.deepEqual(linesOf(), []);
  });
});

describe('清單分組', () => {
  const rows = [
    book({ id: 'a', title: '營養點滴', tag: '點滴' }),
    book({ id: 'b', title: '外院檢送', tag: null }),
    book({ id: 'c', title: '復健科流程', tag: '復健科' }),
    book({ id: 'd', title: '刪掉的', tag: '點滴', deletedAt: 'x' }),
  ];

  test('沒有分類的收在最後一組，抬頭不叫「其他」', () => {
    const groups = groupByTag(rows);
    assert.equal(groups[groups.length - 1].tag, NO_TAG);
  });

  test('已刪除的不出現', () => {
    const all = groupByTag(rows).flatMap((g) => g.rows.map((r) => r.id));
    assert.ok(!all.includes('d'));
  });

  test('釘選的自成一組排最前面，而且是跨分類的', () => {
    const pinned = [...rows, book({ id: 'e', title: '外檢', tag: '外檢', pinned: true })];
    const groups = groupByTag(pinned);
    assert.equal(groups[0].pinned, true);
    assert.deepEqual(groups[0].rows.map((r) => r.id), ['e']);
    // 釘起來的那一份不該又出現在它原本的分類底下
    assert.equal(groups.filter((g) => g.rows.some((r) => r.id === 'e')).length, 1);
  });

  test('現有的分類照筆數多的在前，給編輯時的丸子用', () => {
    const many = [
      book({ id: '1', tag: '點滴' }), book({ id: '2', tag: '點滴' }),
      book({ id: '3', tag: '外檢' }), book({ id: '4', tag: null }),
    ];
    assert.deepEqual(tagsOf(many), ['點滴', '外檢']);
  });
});

describe('搜尋', () => {
  test('標題、分類、每一節的標題與內文都比得到', () => {
    const p = book({ sections: [section({ heading: '前情提醒', body: '飯後打針' })] });
    for (const q of ['營養', '點滴', '前情', '打針']) assert.equal(matches(p, q), true, q);
    assert.equal(matches(p, '完全沒有的字'), false);
  });

  test('空字串一律通過 —— 沒在找東西就不要濾掉任何一份', () => {
    assert.equal(matches(book(), '  '), true);
  });
});

describe('這一筆來訪掛得到哪幾份', () => {
  const drip = book({ id: 'drip', courseIds: ['course-iv-drip'] });
  const followup = book({ id: 'fu', courseIds: ['course-followup'] });
  const none = book({ id: 'none', courseIds: [] });

  test('比的是時段的課程', () => {
    const visit = { slots: [{ courseId: 'course-iv-drip' }] };
    assert.deepEqual(
      playbooksForVisit([drip, followup, none], visit).map((p) => p.id), ['drip'],
    );
  });

  test('同一天兩段同樣的課程，同一份只回一次', () => {
    const visit = { slots: [{ courseId: 'course-iv-drip' }, { courseId: 'course-iv-drip' }] };
    assert.equal(playbooksForVisit([drip], visit).length, 1);
  });

  test('兩段兩個課程就回兩份', () => {
    const visit = { slots: [{ courseId: 'course-iv-drip' }, { courseId: 'course-followup' }] };
    assert.deepEqual(
      playbooksForVisit([drip, followup], visit).map((p) => p.id), ['drip', 'fu'],
    );
  });

  test('沒掛課程的那一份永遠不會自己浮出來 —— 但它照樣查得到', () => {
    const visit = { slots: [{ courseId: 'course-iv-drip' }] };
    assert.deepEqual(playbooksForVisit([none], visit), []);
  });

  test('沒有時段就沒有東西掛得上', () => {
    assert.deepEqual(playbooksForVisit([drip], { slots: [] }), []);
    assert.deepEqual(playbooksForVisit([drip], null), []);
  });
});

describe('這一筆現在該看哪一節（只有這一份判斷）', () => {
  const today = '2026-09-03';

  test('還沒到 → 事前', () => {
    assert.equal(whenForVisit({ date: '2026-09-10', status: 'confirmed' }, today), 'before');
    assert.equal(whenForVisit({ date: '2026-09-10', status: 'pending_confirm' }, today), 'before');
  });

  test('**就是今天 → 當天，不管狀態還是不是待確認**', () => {
    assert.equal(whenForVisit({ date: today, status: 'pending_confirm' }, today), 'onday');
    assert.equal(whenForVisit({ date: today, status: 'confirmed' }, today), 'onday');
  });

  test('日子過了 → 結束後', () => {
    assert.equal(whenForVisit({ date: '2026-08-20', status: 'confirmed' }, today), 'after');
  });

  test('已完成或未到 → 結束後，就算日期還沒到也一樣', () => {
    assert.equal(whenForVisit({ date: '2026-09-10', status: 'done' }, today), 'after');
    assert.equal(whenForVisit({ date: '2026-09-10', status: 'no_show' }, today), 'after');
  });

  test('日期讀不出來就回 null —— 不要猜一個', () => {
    assert.equal(whenForVisit({ status: 'confirmed' }, today), null);
    assert.equal(whenForVisit({ date: '2026-09-10' }, ''), null);
  });
});

describe('挑出那一節', () => {
  const p = book({
    sections: [
      section({ when: 'before', heading: '前情提醒' }),
      section({ when: 'onday', heading: '當天', body: '提早十分鐘' }),
    ],
  });

  test('找得到就回那一節', () => {
    assert.equal(sectionFor(p, 'onday').heading, '當天');
  });

  test('沒有那個時機的節就回 null —— **不要退回第一節**', () => {
    assert.equal(sectionFor(p, 'after'), null);
    assert.equal(sectionFor(p, null), null);
  });

  test('有哪幾種時機，照 SECTION_WHEN 的順序', () => {
    assert.deepEqual(whensOf(p), ['事前', '當天']);
    assert.deepEqual(whensOf(book({ sections: [section({ when: null })] })), ['隨時看']);
  });

  test('認不得的時機當成「隨時看」，不要印一個空白', () => {
    assert.equal(whenLabel('亂填'), '隨時看');
    assert.equal(whenLabel(undefined), '隨時看');
    for (const w of SECTION_WHEN) assert.equal(whenLabel(w.id), w.label);
  });
});
