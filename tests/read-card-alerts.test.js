// 讀取卡片上看得到客人的警示（prelaunch-fixes-2026-10-08/issues/05）。
//
// `SPEC.md` 4.3：「永久限制（尤其是醫療禁忌）在任何畫面都必須跟著客戶名字顯示」。
// 壓表、來訪編輯器、拍 Abovee 都接了，`visitReadHtml()` 漏了 —— 而它是四個畫面共用的
// （日曆、客戶詳情、待辦中心、進度追蹤），所以四處一起漏：日曆點一段，跳出來的卡片只有名字，
// 同一位客人在編輯畫面上有紅色的「體內金屬」。
//
// **這裡全部是原始碼掃描**：`ui/views/calendar.js` 進不了 node（它一路 import 到 `https://` 的
// firebase SDK，同 `tests/read-card-one-slot.test.js` 的檔頭）。要釘的正是「哪一個呼叫端少帶了什麼」——
// **少傳的那一頁會安靜地不畫**。那一排真的出現在她眼前在 `tests-e2e/specs/61-*`（A1、A2）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');

const CALENDAR = read('js/ui/views/calendar.js');
const MIRROR = read('js/ui/components/taskMirror.js');

/** `export function visitReadHtml(` 到下一個最上層的 `function` 之前。 */
function readCardBody() {
  const from = CALENDAR.indexOf('export function visitReadHtml(');
  assert.ok(from >= 0, '找不到 visitReadHtml() —— 這支測試失效了');
  const next = CALENDAR.indexOf('\nfunction ', from + 1);
  return CALENDAR.slice(from, next === -1 ? undefined : next);
}

describe('讀取卡片最上面那一排警示', () => {
  test('畫法是 `flags.js` 的 alertChips()，不另外寫一份', () => {
    const body = readCardBody();
    assert.ok(body.includes('alertChips('), 'visitReadHtml() 沒有畫警示');
    assert.equal(body.includes('class="flag'), false, '自己拼了一顆丸子 —— 走 flags.js 的 alertChips()');
  });

  test('整張卡片只畫一次，而且在每一段的前面（不是每一列重複）', () => {
    const body = readCardBody();
    const at = body.indexOf('alertChips(');
    assert.equal(body.indexOf('alertChips(', at + 1), -1, 'alertChips() 被呼叫了不只一次');
    assert.ok(at < body.indexOf('slots.map('), '警示要在那幾段的前面算好，不是在每一列裡面');
  });

  test('只給看：卡片上一個 checkbox 都沒有', () => {
    assert.equal(readCardBody().includes('type="checkbox"'), false);
  });

  test('`fillMirror()` 補讀的那一趟帶著這位客戶與警示主檔', () => {
    // 日曆、待辦兩處、進度那三個畫面的任務與額度本來就由它補讀 —— 客戶與警示主檔走同一趟、
    // **同一次重畫**（各自 `card.update()` 的話後到的會把先到的洗掉）
    const from = MIRROR.indexOf('export function fillMirror(');
    const fill = MIRROR.slice(from);
    assert.ok(/customersData\.get\(/.test(fill), 'fillMirror() 沒有讀這位客戶');
    assert.ok(/config\.listAll\('clinicalFlags'\)/.test(fill), 'fillMirror() 沒有讀警示主檔');
    assert.equal((fill.match(/card\.update\(/g) ?? []).length, 1, '只准一次 card.update()');
    const render = fill.slice(fill.indexOf('card.update('));
    assert.ok(/\bcustomer\b/.test(render) && /\bclinicalFlags\b/.test(render), '讀回來的沒有交給 render()');
  });
});

describe('每一個開讀取卡片的畫面都拿得到這位客戶與警示主檔', () => {
  const PAGES = [
    'js/ui/views/calendar.js',
    'js/ui/views/customerDetail.js',
    'js/ui/views/home.js',
    'js/ui/views/progress.js',
  ];
  const CALL = 'visitReadHtml(';
  let total = 0;

  for (const rel of PAGES) {
    test(rel, () => {
      const src = read(rel);
      let at = src.indexOf(CALL);
      let found = 0;
      while (at >= 0) {
        // 那一支自己的定義不算、註解裡提到的 `visitReadHtml()` 也不算（括號裡是空的）
        const isDefinition = src.slice(Math.max(0, at - 20), at).includes('function');
        const isProse = src[at + CALL.length] === ')';
        if (!isDefinition && !isProse) {
          found += 1;
          // 這一個呼叫的參數（括號配對）
          let depth = 0;
          let end = at + CALL.length - 1;
          for (; end < src.length; end += 1) {
            if (src[end] === '(') depth += 1;
            else if (src[end] === ')') { depth -= 1; if (depth === 0) break; }
          }
          const args = src.slice(at, end + 1);
          // 兩條路：自己手上有就直接傳；沒有的話 `...extra` 是 `fillMirror()` 補讀回來的那一包
          const viaMirror = args.includes('...extra') && src.includes('fillMirror(');
          for (const key of ['customer', 'clinicalFlags']) {
            const direct = new RegExp(`\\b${key}\\b\\s*[:,}]`).test(args);
            assert.ok(direct || viaMirror, `${rel} 有一處 visitReadHtml() 拿不到 ${key} —— 那一頁的卡片會安靜地不畫警示`);
          }
        }
        at = src.indexOf(CALL, at + 1);
      }
      // 這一支測試最危險的失敗方式是「一個呼叫端都沒找到、於是永遠綠」
      assert.ok(found > 0, `${rel} 找不到任何 visitReadHtml() 呼叫端 —— 這支測試失效了`);
      total += found;
    });
  }

  test('一共五個呼叫端（多了一個就回來看它傳了什麼）', () => {
    assert.equal(total, 5);
  });
});

describe('那一排的版面', () => {
  test('`.readalerts` 在 app.css 裡，而且沒有警示時一個像素都不佔（整塊不畫）', () => {
    assert.ok(read('css/app.css').includes('.readalerts {'), 'app.css 沒有 .readalerts');
    // 空字串回空字串：接的地方用三元，不是一個永遠在的空 div
    assert.ok(/\$\{alerts \? `<div class="readalerts">\$\{alerts\}<\/div>` : ''\}/.test(readCardBody()),
      '沒有警示時還是畫了一個空的 .readalerts');
  });
});
