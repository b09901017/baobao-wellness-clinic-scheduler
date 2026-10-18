// 被追蹤的文字檔裡不可以有看不見的控制字元（2026-10-18，staging-polish 段一）。
//
// 怎麼來的：透過 Bash 寫檔時一個反斜線被吃掉，`\b` 變成一個退格字元（0x08）。
// 寫在正規表示式裡的那一個看起來跟 `\b` 一模一樣，可是它比對的是一個原始碼裡永遠不會出現的字 ——
// `tests/visit-editor.test.js` 有一條 `doesNotMatch` 就這樣從寫下去那天起永遠是綠的，沒有人發現。
// 段一做「送的／體驗」那一支時又踩了一次（`giftFold.js` 的 `/<button\b/`），是別的測試剛好抓到。
//
// 換行（\n）、歸位（\r）、Tab（\t）之外的 C0 控制字元與 DEL 一律不准。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEXT = /\.(js|mjs|cjs|json|md|css|html|gs|ya?ml|sh|rules|txt)$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

test('被追蹤的文字檔裡沒有看不見的控制字元（例如被吃掉反斜線的 \\b 變成的退格字元）', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter((f) => TEXT.test(f));
  assert.ok(files.length > 100, '應該讀得到一整個 repo 的檔案');

  const found = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(new URL(f, `file:///${ROOT.replace(/\\/g, '/')}/`), 'utf8');
    } catch {
      continue; // 被刪掉還沒 commit 的
    }
    text.split('\n').forEach((line, i) => {
      const m = line.match(CONTROL);
      if (m) found.push(`${f}:${i + 1} 有 0x${m[0].charCodeAt(0).toString(16).padStart(2, '0')}`);
    });
  }
  assert.deepEqual(found, []);
});
