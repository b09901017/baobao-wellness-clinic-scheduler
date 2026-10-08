// app 自己產生的檔案也算（docs/agents/lessons.md 第八節，prelaunch-fixes-2026-10-08/issues/03）。
//
// 設定頁匯出的「排課系統備份-日期.json」裡有全部客戶、健康資訊與試算表的密鑰。
// 2026-10-08 以前 `.gitignore` 只擋 `/backups/`、`/exports/` 兩個資料夾，
// 而 `docs/STAGING.md` 還原那一節示範的正是把它放在 repo 最外層 ——
// 這個 repo 是 public，一次 `git add .` 就收不回來。
//
// **真的執行 `git check-ignore`，不是掃 `.gitignore` 的字**：規則寫了、被後面一條 `!` 蓋掉，
// 或者斜線放錯只擋到最外層，掃字都看不出來（CLAUDE.md：「擋沒擋住從畫面上看不出來」）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fromRoot } from './helpers/paths.js';
import { realNames } from './helpers/realNames.js';

const ROOT = fromRoot();

/** 這個路徑被 `.gitignore` 擋著嗎（0＝擋著、1＝沒擋）。檔案不用真的存在。 */
const ignored = (path) => spawnSync('git', ['check-ignore', '-q', path], { cwd: ROOT }).status === 0;

describe('備份檔與金鑰檔放在哪一層都進不了版控', () => {
  const MUST_IGNORE = [
    ['排課系統備份-2026-10-08.json', '備份檔放在 repo 最外層'],
    ['docs/排課系統備份-2026-10-08.json', '備份檔放在別的資料夾'],
    ['scripts/排課系統備份-2026-10-08（含稽核）.json', '檔名後面多了字'],
    ['staging-sa.json', '改過名的服務帳號金鑰'],
    ['scripts/prod-sa.json', '金鑰放在別的資料夾'],
    ['.local/references/排課系統備份-2026-10-08.json', '她自己的那個資料夾（照舊擋著）'],
  ];

  for (const [path, why] of MUST_IGNORE) {
    test(`${path}（${why}）`, () => {
      assert.ok(ignored(path), `${path} 沒有被 .gitignore 擋住`);
    });
  }

  test('新的規則沒有誤擋任何本來被追蹤的檔案', () => {
    const hit = execFileSync('git', ['ls-files', '-ci', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0').filter(Boolean);
    assert.deepEqual(hit, [], `這幾個被追蹤的檔案現在符合 .gitignore 的規則：\n${hit.join('\n')}`);
  });

  test('這幾個本來就該進版控的沒有被擋', () => {
    for (const path of ['firebase.json', '.firebaserc', 'package.json', 'tests-e2e/fixtures/data.js']) {
      assert.ok(!ignored(path), `${path} 被擋住了`);
    }
  });
});

// ---------------------------------------------------------------------------
// 真名掃描的名單（`tests/no-secrets.test.js`）。以前只讀別名表與合併檔：
// 只出現在 Abovee 或病歷號名單上的 27 個名字不在裡面，那幾位的名字進了版控照樣綠。
// 這裡用假名造一個資料夾，確認每一個來源都真的被讀到。
// ---------------------------------------------------------------------------

describe('真名掃描的名單來源', () => {
  function fakeDir(files) {
    const dir = mkdtempSync(join(tmpdir(), 'realnames-'));
    for (const [rel, json] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, JSON.stringify(json));
    }
    return `${dir}/`;
  }

  test('別名表、合併檔、病歷號名單、Abovee 擷取檔、人員名單五個來源都讀', () => {
    const dir = fakeDir({
      'aliases.json': { nicknames: { 王小明: ['小明'] } },
      'import-2026-10-06.json': { customers: [{ name: '李小華', sheetName: '王小明1234' }], staff: [{ match: '某', name: '某乙丙' }] },
      'chart-numbers.json': { 陳大文: '5678' },
      'abovee-m5-m10/擷取/abovee-m5-m10.json': { rows: [{ name: '林美美' }, { name: '林美美' }, { name: null }] },
      'staff-names.json': { 小芳: '某小芳', 張乙: '張乙' },
    });
    try {
      const { names, sources } = realNames(dir);
      for (const n of ['王小明', '小明', '李小華', '王小明1234', '陳大文', '林美美', '某小芳', '某乙丙']) {
        assert.ok(names.includes(n), `名單上少了「${n}」`);
      }
      assert.ok(!names.includes('張乙'), '全名跟種子的名字一樣的不算（本來就在種子上）');
      assert.deepEqual(sources.missing, [], '五個來源都在，不該有缺的');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('後兩份不在（CI、別台機器）：照樣掃前兩份，而且講得出少了哪幾份', () => {
    const dir = fakeDir({
      'aliases.json': { nicknames: { 王小明: ['小明'] } },
      'import-2026-10-06.json': { customers: [{ name: '李小華' }] },
    });
    try {
      const { names, sources } = realNames(dir);
      assert.ok(names.includes('王小明') && names.includes('李小華'));
      assert.equal(sources.missing.length, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('一個字的不掃（單字到處都是）', () => {
    const dir = fakeDir({
      'aliases.json': { nicknames: {} },
      'chart-numbers.json': { 陳: '1', 陳大文: '2' },
    });
    try {
      assert.deepEqual(realNames(dir).names, ['陳大文']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
