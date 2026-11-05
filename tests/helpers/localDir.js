// 她的私人資料夾 `.local/` 在哪裡。
//
// **git worktree 裡沒有 `.local/`**（`.claude/worktrees/<名字>/`）：worktree 只有被追蹤的檔案，
// 而 `.local/` 被 `.gitignore` 擋著。2026-11-05 在 worktree 裡跑 `npm test`，真名掃描找不到
// 別名表 → `t.skip()`，畫面上只多一個「skipped 1」，等於那一條沒跑。
//
// 所以兩個地方都試：這個 checkout 自己的、主資料夾的（從 `git rev-parse --git-common-dir`
// 推：worktree 共用主資料夾的 `.git/`，它的上一層就是主資料夾）。CI 上兩個都沒有，照舊跳過。
//
// **不要改成在 worktree 裡建一個指向主資料夾 `.local` 的 junction**：有些刪 worktree 的方法
// 會順著連結刪進去，刪掉的是她唯一的一份真資料。

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const withSlash = (p) => p.replace(/[\\/]*$/, '/');

/**
 * 主資料夾（放著 `.git/` 的那一個）的根目錄，結尾帶斜線。
 * `commonDir` 是 `git rev-parse --git-common-dir` 的輸出；不是 `.git` 結尾的（bare repo 之類）回 null。
 * @param {string} root 這個 checkout 的根目錄，結尾帶斜線
 * @param {string} commonDir
 */
export function mainCheckoutOf(root, commonDir) {
  const abs = resolve(root, commonDir.trim());
  if (basename(abs) !== '.git') return null;
  return withSlash(dirname(abs));
}

/**
 * 依序要試的幾個資料夾（結尾帶斜線，重複的拿掉）：這個 checkout 的 `.local/references/`、`.local/`，
 * 再來主資料夾的那兩個。
 * @param {string} root
 * @param {string | null} main `mainCheckoutOf()` 的結果
 */
export function localCandidates(root, main) {
  const roots = [withSlash(root)];
  if (main && resolve(main) !== resolve(root)) roots.push(withSlash(main));
  return roots.flatMap((r) => [`${r}.local/references/`, `${r}.local/`]);
}

/** 這個 checkout 的主資料夾；問不到 git（沒裝、不是 repo）回 null。 */
export function mainCheckout(root) {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
    return mainCheckoutOf(root, out);
  } catch {
    return null;
  }
}

/**
 * 第一個放著 `file` 的資料夾（結尾帶斜線），都沒有回 null。
 * @param {string} root
 * @param {string} file 例如 `aliases.json`
 */
export function findLocalDir(root, file) {
  return localCandidates(root, mainCheckout(root)).find((d) => existsSync(`${d}${file}`)) ?? null;
}
