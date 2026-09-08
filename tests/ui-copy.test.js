// 畫面上不該再出現的那幾句話（issue 11）。
//
// 她 2026-09-08：
//
// > 我發現很多的提醒都會提到「app 看不到同事在 abovee 壓的東西」類似的
// > 這個東西，不用不需要，這個提醒完全是多餘的，全域請掉
// > …然後畫面拜託 不要說明文字 太雜亂了 會視覺疲勞
//
// **判準寫在這裡，之後才不用再問一次：**
//
//   「不講會出錯」的留　　　　　　　　→ 空的那一排在等什麼、主檔裡沒有人
//   「講了也不會改變她下一步做什麼」→ 拿掉
//
// 掃的是 `public/js/ui/`（畫得出來的字）。`SPEC.md`、`docs/`、ADR 與
// domain 的註解**不在範圍內** —— 那是寫給看程式的人的，不是畫面上的提醒。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { fromRoot, toPosix } from './helpers/paths.js';

const UI = fromRoot('public/js/ui');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const NL = String.fromCharCode(10);

/** 真的畫得出來的那些字：區塊註解與行註解都拿掉。 */
const codeOf = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(NL)
  .filter((l) => !l.trim().startsWith('//'))
  .join(NL);

const FILES = walk(UI).map((path) => ({
  path: toPosix(path).split('public/js/')[1],
  code: codeOf(readFileSync(path, 'utf8')),
}));

describe('「app 看不到同事在 Abovee 壓的東西」全域清掉', () => {
  for (const phrase of ['看不到同事', 'Abovee 壓的看不到', '同事壓的東西']) {
    test(`畫面上沒有「${phrase}」`, () => {
      const hit = FILES.filter((f) => f.code.includes(phrase)).map((f) => f.path);
      assert.deepEqual(hit, [], `這幾支還在講：${hit.join('、')}`);
    });
  }

  test('但 SPEC 與 ADR 照樣寫著 —— 那件事本身沒有變', () => {
    const spec = readFileSync(fromRoot('SPEC.md'), 'utf8');
    assert.match(spec, /app 看不到同事在 Abovee 上壓的東西/);
  });
});

describe('說明文字', () => {
  const GONE = [
    '這些都只是提醒，不會擋著不讓你存',
    '上面紅色的問題要先處理才存得下去',
    '預設接在上一段結束的',
    '一個人壓完再換下一個',
    '裡面會照「限制多的先看」排好',
    '把補得上的人列出來',
    '跟著這一筆來訪，不是掛在客戶身上',
  ];

  for (const phrase of GONE) {
    test(`拿掉「${phrase}」`, () => {
      const hit = FILES.filter((f) => f.code.includes(phrase)).map((f) => f.path);
      assert.deepEqual(hit, [], hit.join('、'));
    });
  }
});

// 這三句是她 2026-09-09 明確說要留的。**各一條斷言釘著** ——
// 下一次「全域清文案」的時候，沒有這幾條就會連它們一起清掉。
describe('留下來的三句（不講會出錯的那幾句）', () => {
  const has = (phrase) => FILES.some((f) => f.code.includes(phrase));

  test('擇一池還沒挑器材：「先選上面那一台」', () => {
    assert.ok(has('先選上面那一台'), '不留的話那裡是一片空白，她不知道在等什麼');
  });

  test('主檔裡還沒有醫師 / 治療師', () => {
    assert.ok(has('主檔裡還沒有醫師'));
    assert.ok(has('主檔裡還沒有治療師'), '空清單不講原因會被當成壞掉');
  });

  test('確認框裡的後果句還在 domain', () => {
    const src = readFileSync(fromRoot('public/js/domain/consequences.js'), 'utf8');
    assert.match(src, /export function bookingConsequences/);
  });
});
