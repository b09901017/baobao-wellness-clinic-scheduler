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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { html, toggle, disclosure } from '../public/js/ui/components/slotNote.js';
import { fromRoot } from './helpers/paths.js';

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

describe('點第二下要收起來', () => {
  // 她 2026-09-12：「我發現現在記一句是要點icon才能開啟，但是我也希望可以關掉，
  // 就是再點一下就可以關掉」。
  //
  // 展開與收起來**只能有一份**（`wire()`），所以這裡掃的是「那一支問了現在
  // 是開還是關」。真的點得下去在 `tests-e2e/specs/28-note-box.spec.js` 的 N2
  // —— 掃描擋得住「有人把那一段刪掉」，擋不住「還在但行為是錯的」。
  const src = read('ui/components/slotNote.js');

  test('`wire()` 兩條路都走得到', () => {
    assert.match(src, /function close\(/, '只有 open() 的話點第二下等於沒反應');
    assert.match(src, /slotnoteOpen/, '開關狀態要記在自己的名字上');
  });

  test('收起來的時候 peek 印的是現在框裡的字，不是當初 render 的那一份', () => {
    const body = src.slice(src.indexOf('function close('));
    assert.match(body, /area\?*\.value|value/,
      '收起來那一行要讀現在的值 —— 不然她打完收起來會看到舊的那一句');
  });

  test('空的收起來不佔位', () => {
    const body = src.slice(src.indexOf('function close('));
    assert.match(body, /peek\.hidden/, '沒字的時候那一行要收掉（她：不然感覺會很占版面）');
  });
});

describe('元件不可以佔用頁面身上的屬性', () => {
  // 這一條是 2026-09-12 那個 bug 的化石。
  //
  // `disclosure()` 本來把展開狀態記成 `data-open="false"`，而「跟客人確認時間」
  // 那一頁的 `data-open` 指的是**這一列是哪位客戶**（`wireConfirm()` 用
  // `querySelectorAll('[data-open]')` 接線）。於是她點進記一句的輸入框那一下
  // 冒泡上去，那一頁以為她按了某位客戶的確認鈕 —— `dataset.open` 收到字串
  // `"false"`，找不到人，抽屜抬頭印出「的 0 段」，而她打的字一個都沒存進去。
  //
  // 日曆沒發作只是因為它所有 `[data-open]` 都先過 `parseOpen()`，
  // 認不出沒有冒號的值就回 null —— **同一個坑擋過一次，只是擋在日曆那一側。**
  //
  // 所以規矩訂在這裡：**共用元件產出的 HTML 不可以帶裸的 `data-open`。**
  // 元件會被插進任何一頁，而每一頁的 `data-open` 有它自己的意思。
  // 要記自己的狀態就用自己的名字（`data-slotnote-open`）。
  const OWNED_BY_THE_PAGE = ['data-open'];

  test('記一句那一塊沒有帶著頁面的 data-open', () => {
    for (const out of [
      html({ name: 's0-note', value: '一句話', maxlength: 200 }),
      disclosure({ name: 'fnote-c1', peek: '', body: '<form class="slotnote__box" hidden></form>' }),
      toggle({ name: 's0-note', on: true }),
    ]) {
      for (const attr of OWNED_BY_THE_PAGE) {
        assert.ok(!out.includes(attr),
          `記一句那一塊帶著 ${attr} —— 頁面上的 [${attr}] 接線會把它當成自己的一列`);
      }
    }
  });

  test('components/ 底下沒有人寫裸的 data-open', () => {
    const dir = fromRoot('public/js/ui/components/');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const src = readFileSync(join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(String.fromCharCode(10))
        .filter((l) => !l.trim().startsWith('//'))
        .join(String.fromCharCode(10));
      for (const attr of OWNED_BY_THE_PAGE) {
        assert.ok(!src.includes(`${attr}=`),
          `components/${file} 寫了 ${attr}= —— 那個名字是頁面的，元件要用自己的`);
      }
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
