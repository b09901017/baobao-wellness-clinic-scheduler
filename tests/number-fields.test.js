// 「這一格為什麼不讓我存」的守衛。
//
// HTML 的 `step` **從 `min` 起算**，所以 `min="1" step="5"` 的合法值是
// 1、6、11、16、21、26、31…… 30 不在裡面。瀏覽器在 submit 之前就擋下來，
// 而它報的錯是「兩個最接近的有效值分別為 26 和 31」—— 她看不懂那句話跟
// 「時長」有什麼關係，而 domain 的驗證（`positiveInt()`）根本沒有意見。
//
// **這個坑已經踩過三次：**
//
//   2026-08-30  金額欄位 `step="100"` → 5050 存不下去（`domain/products.js` 的註解）
//   2026-09-04  課程時長 `min:1 step:5` → 30 存不下去（她回報的）
//   同一天      方案項目時長、額度時長覆寫 —— 同一個 bug 換兩頁
//
// 每一次都是「這個數字通常是 N 的倍數」這種**猜測**被寫進了 `step`。
// 猜測寫在 `hint` 裡是提示，寫在 `step` 裡是禁令。
//
// 判準：**欄位的 `min` / `step` 要跟 domain 的驗證講同一句話。**
// domain 說「大於 0 的整數」，欄位就是 `min: 1, step: 1`。
//
// 這支掃的是「`min` 跟 `step` 同不同餘」—— 那是唯一一種**打得出正確答案卻
// 存不下去**的組合，也是她三次都踩到的那一種。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { fromRoot, toPosix } from './helpers/paths.js';
import { number, time, timeStepFor } from '../public/js/ui/components/form.js';

const UI_ROOT = fromRoot('public/js/ui/');

/**
 * 豁免。**每一條都要寫得出理由**，而且理由要是「domain 真的只收這幾個值」，
 * 不是「反正她不會填那種數字」。
 *
 * 現在是空的，這是好事 —— 一條都不需要。
 */
const ALLOWED = [];

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * 把每一個 `f.number(...)` 的完整呼叫文字挖出來。括號配對，理由同
 * `tests/save-guards.test.js`：那個呼叫常常跨好幾行。
 */
function callsIn(src, needle) {
  const out = [];
  let i = 0;
  while ((i = src.indexOf(needle, i)) !== -1) {
    let depth = 0;
    let j = i + needle.length - 1;
    const start = j;
    for (; j < src.length; j += 1) {
      const c = src[j];
      if (c === '(') depth += 1;
      else if (c === ')') {
        depth -= 1;
        if (depth === 0) { j += 1; break; }
      }
    }
    out.push({ text: src.slice(start, j), line: src.slice(0, i).split('\n').length });
    i = j;
  }
  return out;
}

/** 呼叫文字裡 `min:` / `step:` 寫的是什麼。寫不出來（變數、樣板）就回 null。 */
function litOf(text, key) {
  const m = new RegExp(`\\b${key}\\s*:\\s*([^,}\\n]+)`).exec(text);
  if (!m) return undefined; // 沒寫 → 用預設值
  const raw = m[1].trim();
  if (/^'any'$|^"any"$/.test(raw)) return 'any';
  return Number.isFinite(Number(raw)) ? Number(raw) : null;
}

/** `min` 打不到的那幾個合法值。回一句話，沒問題就回 null。 */
function mismatch(min, step) {
  if (step === 'any' || step === null || min === null) return null;
  const s = step === undefined ? 1 : step;
  const lo = min === undefined ? 0 : min;
  if (s <= 0) return `step 是 ${s}`;
  if (Number.isInteger(s) && Number.isInteger(lo)) {
    return lo % s === 0 ? null : `min=${lo} 配 step=${s}，合法值是 ${lo}、${lo + s}、${lo + s * 2}…`;
  }
  // 小數的 step 一律要 'any'：0.1 會讓 1.25 存不下去，而浮點數的餘數算不準
  return `step=${s} 是小數 —— 用 'any'，不然打得出來的數字有一半存不下去`;
}

function offenders() {
  const found = [];
  for (const file of filesUnder(UI_ROOT)) {
    const rel = toPosix(file.slice(UI_ROOT.length));
    if (rel === 'components/form.js') continue; // 定義本身
    const src = readFileSync(file, 'utf8');

    for (const call of callsIn(src, 'f.number(')) {
      if (ALLOWED.some((a) => a.at === rel && call.text.includes(a.contains))) continue;
      const bad = mismatch(litOf(call.text, 'min'), litOf(call.text, 'step'));
      if (bad) found.push(`${rel}:${call.line}  ${bad}`);
    }
  }
  return found;
}

describe('數字欄位不可以比 domain 的驗證嚴', () => {
  test('沒有任何一格的 min 跟 step 對不上', () => {
    const bad = offenders();
    assert.deepEqual(
      bad,
      [],
      '這幾格會讓她打出正確的數字卻存不下去：\n'
      + `${bad.join('\n')}\n\n`
      + 'HTML 的 step 從 min 起算。要嘛讓 min 是 step 的倍數，要嘛把 step 改成 1／any，'
      + '「通常是 N 的倍數」寫進 hint 不要寫進 step。',
    );
  });

  test('豁免表沒有指到不存在的檔案', () => {
    const files = filesUnder(UI_ROOT).map((f) => toPosix(f.slice(UI_ROOT.length)));
    const stale = ALLOWED.filter((a) => !files.includes(a.at)).map((a) => a.at);
    assert.deepEqual(stale, []);
  });

  // 指名道姓那幾格。上面那支通用的已經涵蓋，但通用的可以靠加一行豁免閉嘴。
  test('三個「時長（分鐘）」都收得下 30', () => {
    for (const rel of ['views/masterList.js', 'views/customerDetail.js']) {
      const src = readFileSync(fromRoot(`public/js/ui/${rel}`), 'utf8');
      for (const call of callsIn(src, 'f.number(')) {
        if (!call.text.includes('分鐘')) continue;
        assert.notEqual(litOf(call.text, 'step'), 5, `${rel}:${call.line} 的時長又變成 step 5 了`);
      }
    }
  });
});

describe('產生出來的 HTML', () => {
  test("step: 'any' 原樣寫進屬性，而且 inputmode 換成 decimal", () => {
    const html = number({ name: 'w1', label: '權重', value: 1.25, min: 0, step: 'any' });
    assert.match(html, /step="any"/);
    assert.match(html, /inputmode="decimal"/);
  });

  test('整數的欄位還是 numeric —— 手機上跳出來的是數字鍵盤', () => {
    assert.match(number({ name: 'n', label: '次數', min: 1, step: 1 }), /inputmode="numeric"/);
  });
});

describe('時間欄位的 step', () => {
  test('5 的倍數用 300 —— 手機上的滾輪照 5 分鐘跳', () => {
    assert.equal(timeStepFor('09:00'), 300);
    assert.equal(timeStepFor('10:35'), 300);
  });

  test('不是 5 的倍數就退成 60，不然她一打開那一筆就存不回去', () => {
    assert.equal(timeStepFor('10:32'), 60);
    assert.equal(timeStepFor('9:07'), 60);
  });

  test('空的、讀不出來的一律 300 —— 新填的都走滾輪', () => {
    assert.equal(timeStepFor(''), 300);
    assert.equal(timeStepFor(null), 300);
    assert.equal(timeStepFor('晚一點'), 300);
  });

  test('time() 用的是同一支', () => {
    assert.match(time({ name: 't', label: '開始', value: '10:32' }), /step="60"/);
    assert.match(time({ name: 't', label: '開始', value: '10:30' }), /step="300"/);
  });

  test('四個手寫的 type="time" 也要走 timeStepFor —— 寫死 300 的一個都不留', () => {
    const files = ['views/eventEditor.js', 'views/schedule.js', 'views/visitEditor.js'];
    for (const rel of files) {
      const src = readFileSync(fromRoot(`public/js/ui/${rel}`), 'utf8');
      assert.equal(
        /step="300"/.test(src), false,
        `${rel} 裡還有寫死的 step="300"，改成 \${f.timeStepFor(值)}`,
      );
    }
  });
});
