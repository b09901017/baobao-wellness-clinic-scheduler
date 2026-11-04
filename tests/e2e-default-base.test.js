// `--related` 沒帶 `--base` 時拿哪一份 develop 比（`scripts/e2e-changes.mjs` 的 `defaultBase()`）。
//
// 以前寫死本機的 `develop`：`git fetch` 只移動 `origin/develop`，一直待在功能分支上的話本機那一份停在開分支那一格，
// 每一次 verify 都拿整輪的差異在挑（lessons 十二：10/19 家裡、11/2 雲端 VM、11/4 家裡又落後 29 個）。
// 現在先抓一次 GitHub 上的、比 `origin/develop`；抓不到不擋（手上那一份 `origin/develop` 照用），
// 連 `origin/develop` 都沒有才退回本機的 `develop`。

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultBase } from '../scripts/e2e-changes.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'e2e-default-base-'));
  dirs.push(d);
  return d;
};
const gitIn = (cwd) => (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function commit(git, cwd, name) {
  writeFileSync(join(cwd, name), name);
  git('add', name);
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', name);
}

/** 一份「GitHub」（origin）＋一份 clone，clone 之後 origin 的 develop 又往前走了一格。 */
function cloneBehind() {
  const origin = tmp();
  const o = gitIn(origin);
  o('init', '-q', '-b', 'develop');
  o('config', 'core.autocrlf', 'false');
  commit(o, origin, 'a.txt');
  const clone = tmp();
  execFileSync('git', ['clone', '-q', origin, clone]);
  const c = gitIn(clone);
  c('checkout', '-q', '-b', 'feature');
  commit(o, origin, 'b.txt');
  return { origin, clone, o, c };
}

test('有 origin：先抓一次，比 origin/develop（不是停在開分支那一格的本機 develop）', () => {
  const { o, c, clone } = cloneBehind();
  const got = defaultBase(clone);
  assert.equal(got.ref, 'origin/develop');
  assert.equal(got.fetched, true);
  assert.equal(c('rev-parse', 'origin/develop'), o('rev-parse', 'develop'), '抓到 GitHub 上最新的那一格');
  assert.notEqual(c('rev-parse', 'develop'), o('rev-parse', 'develop'), '本機 develop 照舊沒動');
});

test('抓不到（離線、origin 不見了）：不擋，照用手上那一份 origin/develop', () => {
  const { origin, c, clone } = cloneBehind();
  const before = c('rev-parse', 'origin/develop');
  rmSync(origin, { recursive: true, force: true });
  const got = defaultBase(clone);
  assert.deepEqual(got, { ref: 'origin/develop', fetched: false });
  assert.equal(c('rev-parse', 'origin/develop'), before);
});

test('沒有 origin/develop：退回本機的 develop', () => {
  const repo = tmp();
  const g = gitIn(repo);
  g('init', '-q', '-b', 'develop');
  commit(g, repo, 'a.txt');
  assert.deepEqual(defaultBase(repo), { ref: 'develop', fetched: false });
});
