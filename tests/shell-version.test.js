// 「`public/` 改了、`sw.js` 的 VERSION 沒升」→ 紅（ADR-0167，after-golive 06）。
//
// `sw.js` 是程式檔先用手機裡的：VERSION 沒升 = `sw.js` 沒變 = 瀏覽器不裝新的 = 她的手機永遠停在舊版。
// 拿 git 比的話 CI（checkout 深度 1）拿不到基準、只能跳過，所以比的是提交著的那一份快照
// （`scripts/shell-snapshot.mjs` 的檔頭）。**本機與 CI 都要紅，不可以「拿不到就跳過」。**

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compare, currentVersion, readSnapshot, shellHash } from '../scripts/shell-snapshot.mjs';

test('public/ 現在的內容跟快照記的那一版一樣（改了就升 VERSION、跑 npm run shell:snapshot）', () => {
  const verdict = compare({ version: currentVersion(), hash: shellHash() }, readSnapshot());
  assert.ok(verdict.ok, verdict.say);
});

test('compare()：內容變了、VERSION 沒變 → 紅，而且快照那一支不准寫', () => {
  const v = compare({ version: 'v5', hash: 'b' }, { version: 'v5', hash: 'a' });
  assert.equal(v.ok, false);
  assert.equal(v.canWrite, false);
  assert.match(v.say, /VERSION 加一/);
});

test('compare()：VERSION 升了 → 叫你記下來（寫得進去）', () => {
  const v = compare({ version: 'v6', hash: 'b' }, { version: 'v5', hash: 'a' });
  assert.equal(v.ok, false);
  assert.equal(v.canWrite, true);
  assert.match(v.say, /shell:snapshot/);
});

test('compare()：沒有快照 → 叫你記下來', () => {
  assert.equal(compare({ version: 'v1', hash: 'a' }, null).canWrite, true);
});

test('compare()：一模一樣 → 綠', () => {
  assert.equal(compare({ version: 'v5', hash: 'a' }, { version: 'v5', hash: 'a' }).ok, true);
});

test('shellHash()：public/ 裡改一個字就不一樣；換行從 LF 換成 CRLF、只升 VERSION 都一樣', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');

  const root = mkdtempSync(join(tmpdir(), 'shell-hash-'));
  try {
    mkdirSync(join(root, 'public', 'js'), { recursive: true });
    const put = (path, text) => writeFileSync(join(root, path), text);
    put('public/sw.js', "const VERSION = 'v1';\nconst SHELL = [];\n");
    put('public/js/app.js', 'main();\nrun();\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });

    const base = shellHash(root);
    put('public/js/app.js', 'main();\r\nrun();\r\n');
    assert.equal(shellHash(root), base, 'CRLF 不算改了');
    put('public/sw.js', "const VERSION = 'v2';\nconst SHELL = [];\n");
    assert.equal(shellHash(root), base, '只升 VERSION 不算改了內容');
    assert.equal(currentVersion(root), 'v2');
    put('public/js/app.js', 'main();\nrun(); \n');
    assert.notEqual(shellHash(root), base, 'app.js 多一個字就要不一樣');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
