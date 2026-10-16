// `npm run verify` 的 E2E 只看「上一次全綠之後動過的」（`scripts/e2e-changes.mjs`，.scratch/e2e-speed/issues/08）。
//
// 這一支壞掉的方式是**安靜地少跑**：交集算錯、或一次沒跑完整的也記成全綠，
// 下一次 verify 就以為那幾支都過了 —— 畫面上是綠的，而那幾支根本沒跑。
// 所以盯四件事：交集怎麼取、什麼時候退回只看 develop、什麼時候才記、
// 以及拍工作區的那一下**真的認得出每一種改動、而且不碰她 stage 好的東西**。

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CORE, pick } from '../tests-e2e/related.js';
import {
  combine, filesBetween, greenSide, recordsGreen, snapshotTree, stampTime,
} from '../scripts/e2e-changes.mjs';

const r = (specs, all = false) => ({ specs: all ? [] : specs, all, rules: false, why: all ? ['x 是共用底座 → 全跑'] : [] });

describe('兩邊取交集', () => {
  test('兩邊都說要跑的才跑', () => {
    const got = combine(r(['00-smoke', '04', '05', '13']), r(['00-smoke', '05', '68']));
    assert.deepEqual(got.specs, ['00-smoke', '05']);
    assert.equal(got.all, false);
  });

  test('跟 develop 比是全跑、上一次全綠之後只動了一點 → 只跑那一點', () => {
    // 分支一開始改了 fixture（全跑、全綠、記下來），之後只改一支 domain 檔
    const got = combine(r([], true), r(['00-smoke', '15']));
    assert.deepEqual(got, { specs: ['00-smoke', '15'], all: false, why: [] });
  });

  test('上一次全綠之後改了共用底座 → 照 develop 那一邊（不是全跑）', () => {
    // 那個共用底座跟 develop 一樣（改回去了）—— develop 是綠的
    assert.deepEqual(combine(r(['00-smoke', '04']), r([], true)).specs, ['00-smoke', '04']);
  });

  test('兩邊都是全跑 → 全跑', () => {
    const got = combine(r([], true), r([], true));
    assert.equal(got.all, true);
    assert.match(got.why.join(''), /共用底座/);
  });

  test('沒有上一次全綠 → 跟以前一模一樣（只看 develop）', () => {
    const base = r(['00-smoke', '04']);
    assert.deepEqual(combine(base, null), { specs: base.specs, all: false, why: [] });
  });

  test('拿真的對照表走一次：第一步改 visits.js 全綠之後，第二步只改 lineText.js', () => {
    const base = pick(['public/js/domain/visits.js', 'public/js/domain/lineText.js']);
    const green = pick(['public/js/domain/lineText.js']);
    const got = combine(base, green);
    assert.ok(base.specs.length > 20, `改 visits.js 應該挑到很多支（${base.specs.length}）`);
    assert.deepEqual(got.specs, green.specs);
    for (const s of CORE) assert.ok(got.specs.includes(s), `${s} 每一次都要跑`);
  });
});

describe('什麼時候不看上一次全綠', () => {
  const stamp = { tree: 'abc', at: '2026-10-16T06:05:00Z' };

  test('自己帶了 --base', () => {
    const got = greenSide({ explicitBase: 'develop', stamp, sinceGreen: ['a.js'] });
    assert.equal(got.files, null);
    assert.match(got.note, /--base/);
  });

  test('還沒有紀錄', () => {
    assert.equal(greenSide({ explicitBase: null, stamp: null, sinceGreen: null }).files, null);
  });

  test('紀錄上的 tree 被 git 收掉了', () => {
    const got = greenSide({ explicitBase: null, stamp, sinceGreen: null });
    assert.equal(got.files, null);
    assert.match(got.note, /比不起來/);
  });

  test('related.js 在那之後改過 —— 上一次「這一支摸不到」的判斷可能不準', () => {
    const got = greenSide({ explicitBase: null, stamp, sinceGreen: ['tests-e2e/related.js', 'a.js'] });
    assert.equal(got.files, null);
    assert.match(got.note, /related\.js/);
  });

  test('其餘照用', () => {
    assert.deepEqual(greenSide({ explicitBase: null, stamp, sinceGreen: ['a.js'] }), { files: ['a.js'], note: null });
  });
});

describe('什麼時候才記「全綠」', () => {
  test('--related 與什麼都沒點名的全跑：記', () => {
    assert.equal(recordsGreen({ related: true, smoke: false, named: [] }), true);
    assert.equal(recordsGreen({ related: false, smoke: false, named: [] }), true);
  });

  test('點名的、--smoke：不記（沒跑到的那幾支不知道是不是綠的）', () => {
    assert.equal(recordsGreen({ related: false, smoke: false, named: ['05', '20'] }), false);
    assert.equal(recordsGreen({ related: false, smoke: true, named: [] }), false);
  });
});

test('畫面上的時間是台北時間', () => {
  assert.equal(stampTime('2026-10-16T06:05:00Z'), '10/16 14:05');
  assert.equal(stampTime('2026-10-15T17:30:00Z'), '10/16 01:30');
});

describe('拍工作區的那一下（真的 git）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-since-green-'));
  const git = (...args) => execFileSync(
    'git', ['-c', 'core.quotepath=false', '-c', 'init.defaultBranch=main', ...args],
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim();
  const put = (name, text) => writeFileSync(join(dir, name), text);
  after(() => rmSync(dir, { recursive: true, force: true }));

  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  put('.gitignore', 'ignored/\n');
  // 她 stage 了兩支，還有一支還沒 add 的（不用 commit：拍的是工作區，不是 HEAD）
  put('a.js', 'a\n');
  put('staged.js', 's\n');
  git('add', '.gitignore', 'a.js', 'staged.js');
  put('loose.js', 'l\n');
  const indexBefore = git('ls-files', '-s');

  const t1 = snapshotTree(dir);

  test('拍完之後她的 index 一個字都沒變（沒有偷偷 add 那支還沒 add 的）', () => {
    assert.equal(git('ls-files', '-s'), indexBefore);
    assert.equal(git('ls-files', '--others', '--exclude-standard'), 'loose.js');
  });

  test('什麼都沒改 → 同一個 tree、沒有檔案', () => {
    assert.equal(snapshotTree(dir), t1);
    assert.deepEqual(filesBetween(dir, t1, t1), []);
  });

  test('改一支 stage 過的、改還沒 add 的、多一支中文檔名的 → 三支都認得', () => {
    put('a.js', 'a2\n');
    put('loose.js', 'l2\n');
    put('說明.md', '新\n');
    const t2 = snapshotTree(dir);
    assert.deepEqual(filesBetween(dir, t1, t2).sort(), ['a.js', 'loose.js', '說明.md'].sort());
  });

  test('搬家 → 新舊兩個路徑都算；.gitignore 擋掉的不算', () => {
    const before = snapshotTree(dir);
    renameSync(join(dir, 'loose.js'), join(dir, 'moved.js'));
    mkdirSync(join(dir, 'ignored'));
    put('ignored/x.js', 'x\n');
    const after = snapshotTree(dir);
    assert.deepEqual(filesBetween(dir, before, after).sort(), ['loose.js', 'moved.js']);
  });

  test('紀錄上的 tree 不在了 → null（退回只看 develop），不是「沒有改動」', () => {
    assert.equal(filesBetween(dir, '0123456789abcdef0123456789abcdef01234567', t1), null);
  });
});
