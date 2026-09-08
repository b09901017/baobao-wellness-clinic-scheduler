// 一段時段身上那一句話（ADR-0084）。
//
// 她 2026-09-09：「不要是一整天的…我希望是每一筆都可以有他的記一句」，
// 而且「有需要的時候點一個 icon 或是什麼再展開填就好，不然感覺會很占版面」。
//
// 這一支盯三件事：
//   1. 那顆 icon 是 `book` —— 日曆上早就是它了（她 2026-09-04 選的），
//      另外挑一顆的話她要學兩次「哪個圖示代表我寫了字」
//   2. **空的不佔位、有字的一定看得到**（收起來不是藏起來）
//   3. 四個入口共用同一支，沒有人自己寫一份展開

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { html, toggle, disclosure } from '../public/js/ui/components/slotNote.js';

const read = (p) => readFileSync(new URL(`../public/js/${p}`, import.meta.url), 'utf8');

describe('那一塊的三種狀態', () => {
  test('沒有字：收起來那一行整個不畫', () => {
    const out = html({ name: 's0-note', value: null, maxlength: 200 });
    assert.match(out, /class="slotnote__peek"[^>]*hidden/);
  });

  test('有字：收起來那一行畫得出來，而且看得到內容', () => {
    const out = html({ name: 's0-note', value: '她說下午比較好', maxlength: 200 });
    assert.match(out, /她說下午比較好/);
    const peek = out.slice(out.indexOf('slotnote__peek'), out.indexOf('</button>'));
    assert.ok(!peek.includes('hidden'), '收起來不是藏起來 —— 有字一定看得到');
  });

  test('textarea 永遠在 DOM 裡 —— readForm() 讀的是它', () => {
    const out = html({ name: 's0-note', value: '一句話', maxlength: 200 });
    assert.match(out, /<textarea name="s0-note"/);
    assert.match(out, /maxlength="200"/);
  });

  test('值會被跳脫', () => {
    const out = html({ name: 's0-note', value: '<script>x</script>', maxlength: 200 });
    assert.ok(!out.includes('<script>'));
  });

  test('maxlength 由呼叫端帶進來 —— 這一支不決定業務上限', () => {
    assert.match(html({ name: 'n', value: '', maxlength: 40 }), /maxlength="40"/);
  });
});

describe('抬頭那一顆夾板', () => {
  test('用的是 book，不是 manual —— manual 是備忘錄，兩件事', () => {
    const src = read('ui/components/slotNote.js');
    assert.match(src, /icon\('book'/);
    assert.ok(!src.includes("icon('manual'"));
  });

  test('有字的時候看得出來', () => {
    assert.match(toggle({ name: 's0-note', on: true }), /is-on/);
    assert.ok(!toggle({ name: 's0-note', on: false }).includes('is-on'));
  });

  test('對得到那一塊（name 要一致）', () => {
    assert.match(toggle({ name: 's2-note' }), /data-slotnote-toggle="s2-note"/);
    assert.match(html({ name: 's2-note', maxlength: 200 }), /data-slotnote="s2-note"/);
  });

  test('一開始是收起來的', () => {
    assert.match(toggle({ name: 'x' }), /aria-expanded="false"/);
  });
});

describe('展開的行為只有一份', () => {
  test('待辦中心那一句帶自己的 form，但走同一個外殼', () => {
    const out = disclosure({ name: 'fnote-c1', peek: '禮拜一再問問', body: '<form class="slotnote__box" hidden></form>' });
    assert.match(out, /data-slotnote="fnote-c1"/);
    assert.match(out, /禮拜一再問問/);
  });

  test('四個用到的地方都 import 同一支，沒有人自己寫展開', () => {
    for (const p of ['ui/views/visitEditor.js', 'ui/views/schedule.js', 'ui/views/home.js']) {
      assert.match(read(p), /components\/slotNote\.js/, `${p} 沒有共用那一支`);
    }
  });

  // 呼叫端**組得出** `slotnote__box`（待辦中心那一塊的 body 是自己的 form），
  // 但**開關只能由元件做** —— 兩份的話遲早有一邊忘了改 aria-expanded。
  test('沒有人自己去開關那一塊', () => {
    for (const p of ['ui/views/visitEditor.js', 'ui/views/schedule.js', 'ui/views/home.js']) {
      const src = read(p);
      assert.ok(!/slotnote__peek/.test(src), `${p} 自己動了收起來那一行`);
      assert.ok(!/data-slotnote-toggle/.test(src.replace(/slotNote\.\w+\(/g, '')),
        `${p} 自己接了那顆夾板`);
    }
  });
});

describe('那一句話搬到時段之後，四個地方要跟著改', () => {
  test('來訪編輯器：整筆那一格拿掉了', () => {
    const src = read('ui/views/visitEditor.js');
    assert.ok(!src.includes("label: '這一次記一句'"), '整筆那一格還在');
    assert.match(src, /name: `s\$\{i\}-note`/);
  });

  test('壓表：不預填別段的字', () => {
    const src = read('ui/views/schedule.js');
    assert.ok(!src.includes('sameDay?.note'), '那是別段的字，複製過來就多一份對不起來的資料');
  });

  test('壓表：那一句寫進時段，不寫進整筆', () => {
    const src = read('ui/views/schedule.js');
    assert.match(src, /const withNote = \{ \.\.\.slot, note \};/);
    assert.match(src, /note: null,\n    slots: \[withNote\],/);
  });

  test('日曆那一列的夾板逐段算，而且讀法只有一支', () => {
    assert.match(read('domain/calendar.js'), /hasNote: Boolean\(slotNoteOf\(visit, slot\)\)/);
  });

  // 三個地方讀那一句話。各寫一次的話會出現「那一列亮著夾板、點開卻沒有字」。
  test('三個讀的地方都走 slotNoteOf()', () => {
    for (const p of ['domain/calendar.js', 'ui/views/calendar.js', 'ui/views/visitEditor.js']) {
      assert.match(read(p), /slotNoteOf\(/, `${p} 自己讀了 note`);
    }
  });

  test('沒有人自己寫 `slot.note ?? visit.note`', () => {
    for (const p of ['domain/calendar.js', 'ui/views/calendar.js', 'ui/views/visitEditor.js']) {
      const code = read(p)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(String.fromCharCode(10))
        .filter((l) => !l.trim().startsWith('//'))
        .join(String.fromCharCode(10));
      assert.ok(!/slot\?*\.note \?\? visit\.note/.test(code), `${p} 自己退回整筆`);
    }
  });

  test('存檔那一個路口兩件事都做', () => {
    assert.match(read('data/visits.js'), /withSlotNotes\(withSlotStatuses\(/);
  });
});
