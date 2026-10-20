// 客戶詳情的備註那一段：電話、LINE、長備註、短備註一起排順序（ADR-0156，staging-polish 14）。
//
// 判準：**這一行會不會讓一則長備註被算成短備註，或反過來？**

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as notesModule from '../public/js/domain/customerNotes.js';

import {
  MAX_LONG_TITLE, MAX_LONG_BODY, MAX_LONG_NOTES, MAX_NOTE_ORDER,
  readLongNotes, noteItems, notesFields, validateLongNotes, telHref,
  withLongNote, withoutLongNote, longNoteRows, matchesLongNote, firstLine, sectionCount,
} from '../public/js/domain/customerNotes.js';
import { readMarks, toCustomerFields, MAX_MARKS } from '../public/js/domain/customerMarks.js';
import { buildCustomerQueue, customersToBook } from '../public/js/domain/scheduling.js';
import { syncBundle } from '../public/js/domain/sheetReport.js';

const marks = (...texts) => texts.map((text) => ({ text, color: 'grey' }));
const keys = (c) => noteItems(c).map((it) => it.key);

describe('那一串照什麼順序', () => {
  test('沒排過的舊客戶：只有短備註時跟現在一樣', () => {
    const c = { marks: marks('喜歡下午', '指定女治療師') };
    assert.deepEqual(keys(c), ['mark:0', 'mark:1']);
  });

  test('沒排過：LINE、長備註、短備註、電話最後（她 2026-10-20：「病歷號最前面，然後有line的line第二個，然後電話是在最後面」）', () => {
    const c = {
      phone: '0912-345-678', lineId: 'abc123', marks: marks('喜歡下午', '指定女治療師'),
      longNotes: [{ id: 'n1', title: '家人與接送', body: '週二女兒載' }],
    };
    assert.deepEqual(keys(c), ['line', 'long:n1', 'mark:0', 'mark:1', 'phone']);
  });

  test('電話、LINE 沒填就不畫、不佔位', () => {
    const c = { phone: '', lineId: '  ', marks: marks('a') };
    assert.deepEqual(keys(c), ['mark:0']);
  });

  test('排過的照她排的：第 n 個「mark」是 readMarks() 的第 n 則', () => {
    const c = {
      phone: '0912', lineId: 'x', marks: marks('a', 'b'),
      longNotes: [{ id: 'n1', title: 't', body: '' }],
      noteOrder: ['mark', 'long:n1', 'phone', 'mark', 'line'],
    };
    assert.deepEqual(keys(c), ['mark:0', 'long:n1', 'phone', 'mark:1', 'line']);
  });

  test('別的入口在最後加了一則短備註（拍訂購單的「尾款」）→ 它在最後、原本的順序不亂', () => {
    const c = {
      phone: '0912', marks: marks('a', 'b', '尾款 2 萬'),
      noteOrder: ['mark', 'phone', 'mark'],
    };
    assert.deepEqual(keys(c), ['mark:0', 'phone', 'mark:1', 'mark:2']);
  });

  test('順序裡指到不存在的東西就跳過（刪掉的長備註、清掉的電話、多出來的 mark）', () => {
    const c = {
      marks: marks('a'),
      noteOrder: ['long:gone', 'phone', 'mark', 'mark', 'line', 'nonsense', 42],
    };
    assert.deepEqual(keys(c), ['mark:0']);
  });

  test('排的時候沒有電話、後來才填 → 放整串的最後（ADR-0163）；沒排進去的 LINE、病歷號照舊放最前面', () => {
    const c = { phone: '0912', lineId: 'x', chartNo: '12', marks: marks('a', 'b', '尾款 2 萬'), noteOrder: ['mark', 'mark'] };
    assert.deepEqual(keys(c), ['chartNo', 'line', 'mark:0', 'mark:1', 'mark:2', 'phone']);
  });

  test('長備註不在順序裡（別的地方加的）→ 接在最後、在新的短備註前面', () => {
    const c = {
      marks: marks('a', 'b'), noteOrder: ['mark'],
      longNotes: [{ id: 'n1', title: 't', body: '' }],
    };
    assert.deepEqual(keys(c), ['mark:0', 'long:n1', 'mark:1']);
  });

  test('沒有 marks、只有舊的 notes 一行一則：一樣讀得到', () => {
    const c = { notes: '喜歡下午\n\n指定女治療師' };
    assert.deepEqual(noteItems(c).map((it) => it.mark.text), ['喜歡下午', '指定女治療師']);
  });

  test('同一個 key 只出現一次（順序裡寫了兩次 phone）', () => {
    const c = { phone: '0912', noteOrder: ['phone', 'phone'] };
    assert.deepEqual(keys(c), ['phone']);
  });
});

describe('存回去：notesFields()', () => {
  test('拖過之後短備註本身照新的先後重排、形狀不變（她 10/19 同意）', () => {
    const c = {
      phone: '0912', marks: [{ text: 'a', color: 'green' }, { text: 'b', color: 'red' }],
      longNotes: [{ id: 'n1', title: 't', body: 'x' }],
    };
    const items = noteItems(c);
    const byKey = Object.fromEntries(items.map((it) => [it.key, it]));
    const fields = notesFields([byKey['mark:1'], byKey.phone, byKey['long:n1'], byKey['mark:0']]);
    assert.deepEqual(fields.marks, [{ text: 'b', color: 'red' }, { text: 'a', color: 'green' }]);
    assert.equal(fields.notes, 'b\na');
    assert.deepEqual(fields.noteOrder, ['mark', 'phone', 'long:n1', 'mark']);
    assert.deepEqual(fields.longNotes, [{ id: 'n1', title: 't', body: 'x' }]);
    // 重讀一次，順序照她排的
    assert.deepEqual(keys({ ...c, ...fields }), ['mark:0', 'phone', 'long:n1', 'mark:1']);
  });

  test('marks 與 notes 照舊一起寫（同 toCustomerFields）', () => {
    const items = noteItems({ marks: marks('a', 'b') });
    const fields = notesFields(items);
    const plain = toCustomerFields(marks('a', 'b'));
    assert.deepEqual(fields.marks, plain.marks);
    assert.equal(fields.notes, plain.notes);
  });

  test('刪掉第 2 則短備註：其餘的位置照舊，不會錯到別種東西的位置上', () => {
    const c = {
      phone: '0912', marks: marks('a', 'b', 'c'),
      longNotes: [{ id: 'n1', title: 't', body: '' }],
      noteOrder: ['mark', 'phone', 'mark', 'long:n1', 'mark'],
    };
    const left = noteItems(c).filter((it) => it.key !== 'mark:1');
    const after = { ...c, ...notesFields(left) };
    assert.deepEqual(noteItems(after).map((it) => (it.kind === 'mark' ? it.mark.text : it.key)),
      ['a', 'phone', 'long:n1', 'c']);
  });

  test('沒有短備註時 notes 是 null（同 marksToText）', () => {
    assert.equal(notesFields([]).notes, null);
    assert.deepEqual(notesFields([]).marks, []);
  });
});

describe('長備註本身', () => {
  test('readLongNotes：丟掉形狀不對的、沒有 id 的', () => {
    const c = { longNotes: [null, 'x', { title: '沒有 id' }, { id: 'n1', title: ' t ', body: 'b' }] };
    assert.deepEqual(readLongNotes(c), [{ id: 'n1', title: 't', body: 'b' }]);
    assert.deepEqual(readLongNotes({}), []);
  });

  test('驗證：標題必填、長度、則數、id 不重複', () => {
    assert.deepEqual(validateLongNotes([{ id: 'n1', title: 't', body: '' }]), []);
    assert.match(validateLongNotes([{ id: 'n1', title: ' ', body: 'x' }]).join(), /標題/);
    assert.match(validateLongNotes([{ id: 'n1', title: 'x'.repeat(MAX_LONG_TITLE + 1), body: '' }]).join(), /標題太長/);
    assert.match(validateLongNotes([{ id: 'n1', title: 't', body: 'x'.repeat(MAX_LONG_BODY + 1) }]).join(), /太長/);
    const many = Array.from({ length: MAX_LONG_NOTES + 1 }, (_, i) => ({ id: `n${i}`, title: 't', body: '' }));
    assert.match(validateLongNotes(many).join(), new RegExp(`最多 ${MAX_LONG_NOTES} 則`));
    assert.ok(validateLongNotes([{ id: 'n', title: 'a' }, { id: 'n', title: 'b' }]).length);
    assert.match(validateLongNotes('x').join(), /格式/);
  });

  test('上限跟備忘錄同一級', () => {
    assert.equal(MAX_LONG_TITLE, 40);
    assert.equal(MAX_LONG_BODY, 5000);
  });

  test('withLongNote：新的一則接在最後；有排過順序才補一格', () => {
    const plain = { longNotes: [{ id: 'n1', title: 'a', body: '' }] };
    const added = withLongNote(plain, { id: 'n2', title: 'b', body: 'x' });
    assert.deepEqual(added.longNotes.map((n) => n.id), ['n1', 'n2']);
    assert.equal('noteOrder' in added, false);
    assert.equal('marks' in added, false, '長備註那一頁不碰短備註');

    const ordered = { ...plain, noteOrder: ['long:n1', 'mark'] };
    assert.deepEqual(withLongNote(ordered, { id: 'n2', title: 'b', body: '' }).noteOrder,
      ['long:n1', 'mark', 'long:n2']);
  });

  test('withLongNote：同一個 id 是改那一則，位置不動', () => {
    const c = { longNotes: [{ id: 'n1', title: 'a', body: '' }, { id: 'n2', title: 'b', body: '' }], noteOrder: ['long:n2', 'long:n1'] };
    const next = withLongNote(c, { id: 'n1', title: 'A', body: 'new' });
    assert.deepEqual(next.longNotes, [{ id: 'n1', title: 'A', body: 'new' }, { id: 'n2', title: 'b', body: '' }]);
    assert.deepEqual(next.noteOrder, ['long:n2', 'long:n1']);
  });

  test('withoutLongNote：拿掉那一則與它在順序裡那一格', () => {
    const c = { longNotes: [{ id: 'n1', title: 'a', body: '' }], noteOrder: ['phone', 'long:n1', 'mark'] };
    assert.deepEqual(withoutLongNote(c, 'n1'), { longNotes: [], noteOrder: ['phone', 'mark'] });
    assert.deepEqual(withoutLongNote({ longNotes: [{ id: 'n1', title: 'a' }] }, 'n1'), { longNotes: [] });
  });

  test('firstLine：內文第一行有字的那一行', () => {
    assert.equal(firstLine('\n  \n週二女兒載\n第二行'), '週二女兒載');
    assert.equal(firstLine(''), '');
  });

  test('抬頭的數字＝短備註＋長備註（電話、LINE 不算）', () => {
    assert.equal(sectionCount({ phone: '1', lineId: 'x', marks: marks('a'), longNotes: [{ id: 'n', title: 't' }] }), 2);
  });
});

describe('長備註不會被算成短備註（21 處讀 marks 的那一側）', () => {
  test('readMarks 與 customer.notes 鏡像：加了長備註之後一個字都不變', () => {
    const c = { marks: marks('a', 'b') };
    const before = { marks: readMarks(c), notes: toCustomerFields(c.marks).notes };
    const after = { ...c, ...withLongNote(c, { id: 'n1', title: '很長的一則', body: '一大段' }) };
    assert.deepEqual(readMarks(after), before.marks);
    assert.equal(notesFields(noteItems(after)).notes, before.notes);
  });

  // issue 14 判準「各一個測試」：同一位客戶加了長備註（而且排在最前面）之前之後，每一個讀的那一側一模一樣。
  // 客戶清單的卡片是畫面，在 E2E 74 的 N12
  const plain = { id: 'c1', name: '客戶A', marks: marks('喜歡下午', '指定女治療師'), notes: '喜歡下午\n指定女治療師' };
  const withLong = {
    ...plain,
    longNotes: [{ id: 'n1', title: '家人與接送', body: '週二女兒載' }],
    noteOrder: ['long:n1', 'phone', 'mark', 'mark'],
  };
  const ent = { id: 'e1', type: 'single', label: 'X', courseId: 'x', totalQty: 4 };

  test('壓表卡片牆（buildCustomerQueue）', () => {
    const row = (c) => buildCustomerQueue({
      customers: [c], entitlementsBy: { c1: [ent] }, targetMonth: '2026-11', today: '2026-10-19',
    })[0];
    assert.deepEqual(row(plain).marks.map((m) => m.text), ['喜歡下午', '指定女治療師']);
    assert.deepEqual(row(withLong).marks, row(plain).marks);
  });

  test('待辦「壓表登記」那一列（customersToBook）', () => {
    const row = (c) => customersToBook({
      customers: [c], entitlementsBy: { c1: [ent] }, visitsBy: {},
      coursesById: { x: { id: 'x', category: 'C', systems: ['Examine'] } }, targetMonth: '2026-11',
    })[0];
    assert.deepEqual(row(plain).marks.map((m) => m.text), ['喜歡下午', '指定女治療師']);
    assert.deepEqual(row(withLong).marks, row(plain).marks);
  });

  test('試算表（syncBundle 那一位的備註）', () => {
    const sheet = (c) => syncBundle({ customers: [c], today: '2026-10-19' }).sheets[0];
    assert.equal(sheet(plain).notes, '喜歡下午\n指定女治療師');
    assert.deepEqual(sheet(withLong), sheet(plain));
  });
});

describe('電話與 LINE 的連結', () => {
  test('電話：只留數字與開頭的 +；有好幾支取第一支', () => {
    assert.equal(telHref('0912-345-678'), 'tel:0912345678');
    assert.equal(telHref('+886 912 345 678'), 'tel:+886912345678');
    assert.equal(telHref('0912-345-678 / 02-2345-6789'), 'tel:0912345678');
    assert.equal(telHref('沒有'), null);
    assert.equal(telHref(''), null);
  });

  test('LINE 那一格存的是她 LINE 好友清單上的名字：不是連結（ADR-0157）', () => {
    const [line, phone] = noteItems({ phone: '0912-345-678', lineId: ' 王小明 ' });
    assert.equal(phone.href, 'tel:0912345678');
    assert.equal(phone.text, '0912-345-678');
    assert.deepEqual(line, { key: 'line', kind: 'line', text: '王小明' });
  });

  test('打開加好友網址的那條路整個拿掉了', () => {
    assert.equal('lineHref' in notesModule, false);
    const src = readFileSync(new URL('../public/js/domain/customerNotes.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /line\.me\/R\/ti/);
  });

  test('電話寫了字卻撥不出去：照樣畫（看得到號碼），只是沒有 tel: 連結', () => {
    const [phone] = noteItems({ phone: '請打給女兒' });
    assert.equal(phone.kind, 'phone');
    assert.equal(phone.href, null);
  });
});

describe('長備註那一頁：一疊卡', () => {
  const customers = [
    { id: 'c', name: '客戶C', active: false, longNotes: [{ id: 'c1', title: '停用前', body: '搬家' }] },
    { id: 'a', name: '客戶A', longNotes: [{ id: 'a1', title: '接送', body: '女兒' }, { id: 'a2', title: '點滴', body: '右手' }], noteOrder: ['long:a2', 'long:a1'] },
    { id: 'x', name: '刪掉的', deletedAt: 'x', longNotes: [{ id: 'x1', title: 't', body: '' }] },
    { id: 'b', name: '客戶B', marks: marks('只有短的') },
  ];

  test('在服務中的排前面、停用的排後面；同一位照他詳情的順序；刪掉的不列', () => {
    assert.deepEqual(longNoteRows(customers).map((r) => r.key), ['a:a2', 'a:a1', 'c:c1']);
  });

  test('搜尋：人名（同 nameHas）、標題、內文', () => {
    const rows = longNoteRows(customers);
    const hit = (q) => rows.filter((r) => matchesLongNote(r, q)).map((r) => r.key);
    assert.deepEqual(hit('客戶 A'), ['a:a2', 'a:a1']);
    assert.deepEqual(hit('接送'), ['a:a1']);
    assert.deepEqual(hit('右手'), ['a:a2']);
    assert.deepEqual(hit(''), ['a:a2', 'a:a1', 'c:c1']);
  });
});

describe('Rules 的兩個上限跟 domain 講同一個數字', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

  test('長備註 20 則：Rules 擋的就是 MAX_LONG_NOTES', () => {
    assert.ok(rules.includes(`d.longNotes.size() <= ${MAX_LONG_NOTES})`), 'firestore.rules 的長備註上限跟 MAX_LONG_NOTES 不一樣');
  });

  test('順序 40 格：Rules 擋的就是 MAX_NOTE_ORDER，而且裝得下電話＋LINE＋12 則短的＋20 則長的', () => {
    assert.ok(rules.includes(`d.noteOrder.size() <= ${MAX_NOTE_ORDER})`), 'firestore.rules 的順序上限跟 MAX_NOTE_ORDER 不一樣');
    assert.ok(MAX_NOTE_ORDER >= 2 + MAX_MARKS + MAX_LONG_NOTES,
      `${MAX_NOTE_ORDER} 格裝不下 2 + ${MAX_MARKS} + ${MAX_LONG_NOTES}`);
  });
});
