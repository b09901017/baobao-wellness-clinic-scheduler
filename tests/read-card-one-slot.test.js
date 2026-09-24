// 讀取卡片：**點哪一段就看哪一段**（`.scratch/quieter-screens/issues/10`）。
//
// 她 2026-09-10：
//
// > d 如果真的像是，看這個月進度或是像是待辦任務例如examine那邊點人名進去，
// > 會呈現一整天的時段，那能不能除了先呈現那一天的時段以及那一天的待辦，
// > 也要可以個別時段都可以點，知道那個時段的詳情，但是我還是希望大部分
// > 都先改成呈現這一段的詳情而不是這一整天的
//
// > b 再來 : 日曆新增來訪為什麼會出現這一天整筆的，下面那個狀態應該是這個時段的吧？
//
// 日曆從 2026-09-08 起就是這個行為（ADR-0080）：那一列帶著 `slotIndex`，
// 卡片只畫那一段。另外三頁（客戶詳情、待辦中心、進度追蹤）一直走
// `slotsToShow()` 的退路「沒指定就是全部」—— 而那幾段畫成 `<div>`，
// **不是按鈕、沒有 data-open、沒有任何 listener**，所以點不下去。
//
// 這一支盯的是那三頁補上的那一層，以及它連帶要收掉的兩個落差：
// 副標印的是整筆推導出來的狀態（ADR-0085 說要印那一段的），
// 以及來訪編輯器只改一段時還畫著「這一天整筆的」那一摺。
//
// **這裡全部是原始碼掃描**：`ui/views/calendar.js` 進不了 node
//（它一路 import 到 `https://` 的 firebase SDK），而這一輪要釘的正是
// 「哪一個呼叫端少帶了什麼」。真的點得下去在
// `tests-e2e/specs/27-read-card-one-slot.spec.js`。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');

/** 另外三頁。日曆本來就對了，它不在這份名單裡。 */
const OTHER_THREE = [
  'js/ui/views/customerDetail.js',
  'js/ui/views/home.js',
  'js/ui/views/progress.js',
];

describe('沒指定哪一段時，每一段自己是一列', () => {
  test('`visitReadHtml()` 的那幾列帶得出是哪一段', () => {
    assert.match(
      read('js/ui/views/calendar.js'),
      /data-open="visit:\$\{esc\(visit\.id\)\}:\$\{index\}"/,
      '讀取卡片那幾列少了 data-open —— 三頁上點下去什麼都不會發生',
    );
  });

  test('那一列裡面是 span 不是 div —— button 只收 phrasing content', () => {
    const src = read('js/ui/views/calendar.js');
    for (const cls of ['readslot__when', 'readslot__what', 'readslot__from']) {
      assert.equal(
        src.includes(`<div class="${cls}`), false,
        `${cls} 還是 <div>，而點得下去的那一種外面是 <button>`,
      );
    }
    // 換成 span 之後那三格要自己 block，不然整列會擠成一行。
    //
    // **刻意一個正規表示式都沒有**（同 `tip-red-lines.test.js` 的檔頭）：
    // 反斜線在寫檔的路上被吃掉一個是這個 repo 反覆踩到的坑，而症狀是
    // 「樣式明明在、測試卻紅」或更糟的「刪光了照樣綠」。
    const css = read('css/app.css');
    for (const cls of ['readslot__when', 'readslot__what', 'readslot__from']) {
      const at = css.indexOf(`.${cls} {`);
      assert.ok(at > 0, `找不到 .${cls} 那一段 —— 這支測試失效了`);
      const block = css.slice(at, css.indexOf('}', at));
      assert.ok(block.includes('display: block'),
        `.${cls} 少了 display: block —— 三格會擠成一行`);
    }
  });

  test('她點進來的那一段不再是按鈕', () => {
    const src = read('js/ui/views/calendar.js');
    // `focused` 為真＝她已經指名了那一段，那一列點下去只會重開同一張卡片。
    assert.match(src, /slotsToShow\(visit, data\?\.focusSlot \?\? null, data\?\.only \?\? null\)/);
    assert.match(src, /const tappable = !focused && slots\.length > 1;/,
      '「這一列點不點得下去」要由 slotsToShow() 的 focused 決定，不要另外推一次');
  });
});

// ADR-0073 為畫面閃一下付過帳，ADR-0080 為**卡片裡的換頁**再講了一次：
// 「按了就地重畫（`card.update()`），不重開一張卡 —— `openCard()` 第一行
// 就是 `closeCard()`」。那一節後來連同「看全部」一起拿掉了，但那個理由沒有變，
// 而這一支長出來的四個接線正是同一種「在卡片裡換內容」。
describe('在卡片裡換段落是就地重畫，不是關掉再開一張', () => {
  test('四個接線都走 card.update()，沒有人再 openCard() 一次', () => {
    for (const rel of [...OTHER_THREE, 'js/ui/views/calendar.js']) {
      const src = read(rel);
      // `wireReadSlots(...)` 的回呼裡出現的一定是 `card.update(`
      for (const m of src.matchAll(/wireReadSlots\(cardEl, \(i\) => \{[\s\S]{0,240}?\}\)/g)) {
        assert.match(m[0], /card\.update\(/,
          `${rel} 的那一圈重開了一張卡 —— openCard() 第一行就是 closeCard()，畫面會閃一下`);
      }
      assert.ok(src.includes('wireReadSlots(cardEl, (i) => {'), `${rel} 沒有接那一圈`);
    }
  });

  test('`card.update()` 換得動副標 —— 不然抬頭會停在整天那一個', () => {
    assert.match(
      read('js/ui/components/card.js'),
      /update\(html, \{ subtitle: nextSub \} = \{\}\)/,
      '就地重畫時副標不跟著換，等於她點了第二段而抬頭還在講整天（ADR-0085）',
    );
  });
});

describe('那三頁接上那一層', () => {
  test('三頁都把 focusSlot 帶進 visitReadHtml()', () => {
    for (const rel of OTHER_THREE) {
      assert.ok(read(rel).includes('focusSlot'),
        `${rel} 沒有帶 focusSlot —— 她點第二段會看到整天`);
    }
  });

  test('三頁的副標走 statusForCard()，不再讀 visit.status', () => {
    for (const rel of OTHER_THREE) {
      const src = read(rel);
      assert.ok(src.includes('statusForCard('),
        `${rel} 的卡片副標還在印整筆的狀態（ADR-0085）`);
      // **只盯卡片的副標。** 別的地方印整筆那一個常常是對的 —— 待辦中心
      // 那張收尾卡寫「這一天到現在還是『待確認』」講的就是整天。
      assert.equal(
        (src.match(/subtitle: .{0,12}describeStatus\(visit\.status\)/g) ?? []).length, 0,
        `${rel} 的卡片副標還在印整筆推導出來的狀態 ——`
        + ' 她點的可能是早上那段已經談定的',
      );
    }
  });

  test('三頁都走同一支 wireReadSlots()，沒有人自己 split', () => {
    for (const rel of OTHER_THREE) {
      const src = read(rel);
      assert.ok(src.includes('wireReadSlots('),
        `${rel} 畫得出那幾列卻沒有接線 —— 點下去什麼都不會發生`);
      assert.equal(
        (src.match(/dataset\.open\.split\(/g) ?? []).length, 0,
        `${rel} 自己 split data-open —— 那一份遲早會忘了取第三格`,
      );
    }
  });

  test('`parseOpen()` 仍然只有一支，而且住在日曆裡', () => {
    const src = read('js/ui/views/calendar.js');
    assert.equal((src.match(/^function parseOpen\(/gm) ?? []).length, 1);
    for (const rel of OTHER_THREE) {
      assert.equal(read(rel).includes('function parseOpen'), false,
        `${rel} 自己寫了一支 parseOpen —— 兩份遲早有一份忘了取第三格`);
    }
  });
});

describe('來訪編輯器：抬頭與整筆那幾塊', () => {
  const SRC = () => read('js/ui/views/visitEditor.js');

  test('抬頭那顆 badge 印的是那一段的狀態', () => {
    const src = SRC();
    assert.match(src, /const headStatus = statusForCard\(/,
      '抬頭還在印 draft.status —— 併一段沒問過客人的進去，'
      + '早上那段已經談定的會被寫成「待確認」（ADR-0085）');
    assert.equal(
      (src.match(/describeStatus\(draft\.status\)\}<\/span>/g) ?? []).length, 0,
    );
  });

  // 2026-09-12（ADR-0089）：那兩塊從「只在整筆都在畫面上時畫」變成
  // **完全不畫**。她說改整天的日期與刪除這一天都不要了。
  test('整筆的狀態卡與危險區整塊不在了', () => {
    const src = SRC();
    assert.equal(src.includes('<summary class="advanced__head">這一天整筆的</summary>'), false,
      '摺起來不算拿掉');
    assert.ok(!src.includes('function statusCard'), '整天的狀態卡還在');
    assert.ok(!src.includes('function dangerZone'), '危險區還在');
  });

  test('那兩塊的接線也跟著沒了 —— 接在 null 上會讓整頁停在「載入中…」', () => {
    const src = SRC();
    assert.ok(!src.includes('wireStatus('));
    assert.ok(!src.includes('wireDangerZone('));
  });
});

// **2026-09-12：那一顆也拿掉了**（ADR-0089）。
//
// 它 2026-09-10 長出來是為了滿足 ADR-0060（長按是捷徑不是唯一的路）——
// 那時候「取消一整天」與「刪除這一天」還是她要的功能。她 2026-09-12 說
// 那一顆不要（「如果要改我也會一項一項改」），追問那兩件事要不要留路時
// 回答「整個拿掉，兩件事都不要了」。取消一整天走壓表的批次取消（ADR-0082）。
describe('整天那一顆不在了（ADR-0089）', () => {
  test('日曆的讀取卡片底下沒有那一顆', () => {
    assert.equal(read('js/ui/views/calendar.js').includes('data-edit-day'), false,
      '那一顆還在 —— 她說不需要改整天的按鈕');
  });

  test('四頁都沒有（另外三頁本來就沒有鉛筆，ADR-0056）', () => {
    for (const rel of OTHER_THREE) {
      assert.equal(read(rel).includes('data-edit-day'), false,
        `${rel} 長出了一條改得動來訪的路`);
    }
  });
});
