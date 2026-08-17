// 金鑰外洩的最後一道防線。
//
// .gitignore 靠檔名比對，換個檔名就漏了。這裡改成看內容：
// 任何被 git 追蹤的檔案只要帶有服務帳號私鑰的特徵，測試就紅，
// CI 也就不會讓它上線。
//
// 服務帳號金鑰會繞過所有 Security Rules，是這個專案唯一的萬能鑰匙。
// 一旦 commit 過，就算之後刪掉也留在 git 歷史裡。 —— SPEC.md 第 10 節

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname;

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

// 服務帳號 JSON 一定同時有這幾個欄位；PEM 開頭則涵蓋任何貼進來的私鑰。
const MARKERS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /"type"\s*:\s*"service_account"/,
  /"private_key_id"\s*:/,
];

test('沒有任何被追蹤的檔案含有私鑰或服務帳號憑證', () => {
  const offenders = [];

  for (const rel of trackedFiles()) {
    const full = ROOT + rel;
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue; // 已刪除但還在索引裡
    }
    if (!stat.isFile() || stat.size > 2_000_000) continue;

    const src = readFileSync(full, 'utf8');
    // 這個測試檔自己寫著那些字串，要排除掉，否則永遠是紅的
    if (rel === 'tests/no-secrets.test.js') continue;

    for (const marker of MARKERS) {
      if (marker.test(src)) {
        offenders.push(`${rel}（符合 ${marker}）`);
        break;
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `這些檔案看起來含有金鑰，絕對不能進版控：\n${offenders.join('\n')}`,
  );
});
