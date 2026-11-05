// 在 git worktree 裡也找得到主資料夾的 `.local/`（`tests/helpers/localDir.js`）。
// 2026-11-05：worktree 裡沒有 `.local/`，真名掃描找不到別名表就 `t.skip()`，畫面上只多一個「skipped 1」。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { fromRoot } from './helpers/paths.js';
import { findLocalDir, localCandidates, mainCheckout, mainCheckoutOf } from './helpers/localDir.js';

const ROOT = fromRoot();
const same = (a, b) => resolve(a) === resolve(b);

test('主資料夾：--git-common-dir 是相對的 .git，候選只有自己那兩個', () => {
  const root = resolve('/repo') + '/';
  const main = mainCheckoutOf(root, '.git\n');
  assert.ok(same(main, root));
  assert.deepEqual(localCandidates(root, main), [`${root}.local/references/`, `${root}.local/`]);
});

test('worktree：--git-common-dir 指到主資料夾的 .git，主資料夾那兩個排在自己的後面', () => {
  const main = resolve('/repo') + '/';
  const root = resolve('/repo/.claude/worktrees/wt') + '/';
  const found = mainCheckoutOf(root, `${resolve('/repo/.git')}\n`);
  assert.ok(same(found, main));
  assert.deepEqual(localCandidates(root, found), [
    `${root}.local/references/`, `${root}.local/`,
    `${found}.local/references/`, `${found}.local/`,
  ]);
});

test('--git-common-dir 不是 .git 結尾（bare repo）：不猜主資料夾', () => {
  assert.equal(mainCheckoutOf('/x/', '/srv/repo.git'), null);
  const root = resolve('/x') + '/';
  assert.deepEqual(localCandidates(root, null), [`${root}.local/references/`, `${root}.local/`]);
});

test('真的在 worktree 裡、主資料夾有別名表：找到的是主資料夾那一份（真名掃描不再跳過）', (t) => {
  // worktree 的 `.git` 是一個檔案（`gitdir: …`），主資料夾的是資料夾。
  const isWorktree = existsSync(`${ROOT}.git`) && statSync(`${ROOT}.git`).isFile();
  if (!isWorktree) return t.skip('不在 worktree 裡跑，這一條沒東西可驗（上面三條驗了推導）');
  const main = mainCheckout(ROOT);
  assert.ok(main && !same(main, ROOT), 'worktree 裡要推得出主資料夾');
  const mainHas = [`${main}.local/references/`, `${main}.local/`].find((d) => existsSync(`${d}aliases.json`));
  if (!mainHas) return t.skip('主資料夾也沒有別名表（CI 或別台機器），照舊跳過');
  const ownHas = [`${ROOT}.local/references/`, `${ROOT}.local/`].some((d) => existsSync(`${d}aliases.json`));
  const dir = findLocalDir(ROOT, 'aliases.json');
  assert.ok(dir, '主資料夾有別名表，worktree 裡卻找不到');
  if (!ownHas) assert.ok(same(dir, mainHas));
});
