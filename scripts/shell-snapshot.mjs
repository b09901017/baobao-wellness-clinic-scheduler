// 「`public/` 改了、`sw.js` 的 VERSION 沒升」的那一道擋（ADR-0167，after-golive 06）。
//
// `sw.js` 改成程式檔先用手機裡的之後，**忘了升 VERSION 的代價從「慢一輪」變成「永遠停在舊版」**：
// `sw.js` 一個字都沒變，瀏覽器就不會裝新的那一份，她手機上永遠是舊的程式。
//
// 為什麼不拿 git 比：CI 是 checkout 深度 1，拿不到 `origin/develop`，比不了就只能跳過 —— 擋不住的擋。
// 改成提交一份快照（`tests/shell-version.snapshot.json`：VERSION ＋ `public/` 每一支的內容雜湊），
// `tests/shell-version.test.js` 重算比對：內容變了、VERSION 沒變 → 紅；VERSION 變了 → 叫你跑這一支記下來。
//
//   npm run shell:snapshot
//
// **同一個 VERSION 只能對一份內容**：VERSION 沒升、內容變了，這一支拒絕寫（不然跑一下就繞過去了）。
// 換行先統一成 LF（本機 Windows 可能是 CRLF、CI 是 LF —— lessons 的 CRLF 那一條）。
// `sw.js` 自己也算，只是拿掉 VERSION 那一行（不然升版號本身就改了內容）。

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SNAPSHOT = join(ROOT, 'tests', 'shell-version.snapshot.json');

const VERSION_LINE = /^const VERSION = '(v\d+)';$/m;
const TEXT = /\.(js|mjs|css|html|json|webmanifest|svg|txt|md)$/;

/** `sw.js` 現在寫的 VERSION。 */
export function currentVersion(root = ROOT) {
  const m = readFileSync(join(root, 'public', 'sw.js'), 'utf8').match(VERSION_LINE);
  if (!m) throw new Error('sw.js 裡找不到 `const VERSION = \'vN\';` 那一行');
  return m[1];
}

/** 被追蹤的 `public/` 底下每一支（還沒 `git add` 的不算 —— CI 上也沒有它）。 */
function trackedPublic(root) {
  return execFileSync('git', ['ls-files', '-z', 'public'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean).sort();
}

/** 一支檔案拿去算雜湊的那一份：文字檔換行統一成 LF、`sw.js` 拿掉 VERSION 那一行。 */
function contentOf(root, path) {
  const buf = readFileSync(join(root, path));
  if (!TEXT.test(path)) return buf;
  let text = buf.toString('utf8').replace(/\r\n/g, '\n');
  if (path === 'public/sw.js') text = text.replace(VERSION_LINE, '');
  return Buffer.from(text, 'utf8');
}

/** `public/` 現在的內容雜湊。 */
export function shellHash(root = ROOT) {
  const h = createHash('sha256');
  for (const path of trackedPublic(root)) {
    h.update(path);
    h.update('\0');
    h.update(contentOf(root, path));
    h.update('\0');
  }
  return h.digest('hex');
}

export function readSnapshot(path = SNAPSHOT) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 現在跟快照比：`ok`，或要講的那一句。
 * @param {{version: string, hash: string}} now
 * @param {{version: string, hash: string}|null} snap
 * @returns {{ok: true}|{ok: false, say: string, canWrite: boolean}}
 */
export function compare(now, snap) {
  if (snap && now.version === snap.version && now.hash === snap.hash) return { ok: true };
  if (snap && now.version === snap.version) {
    return {
      ok: false,
      canWrite: false,
      say: `public/ 改了、sw.js 的 VERSION 還是 ${now.version} —— 她的手機會永遠停在舊版。`
        + '把 VERSION 加一，再跑 npm run shell:snapshot',
    };
  }
  return {
    ok: false,
    canWrite: true,
    say: `sw.js 的 VERSION 是 ${now.version}，快照記的是 ${snap?.version ?? '（沒有快照）'} —— 跑 npm run shell:snapshot 記下這一版`,
  };
}

function main() {
  const now = { version: currentVersion(), hash: shellHash() };
  const verdict = compare(now, readSnapshot());
  if (verdict.ok) {
    console.log(`快照已經是 ${now.version} 這一份，不用改。`);
    return;
  }
  if (!verdict.canWrite) {
    console.error(verdict.say);
    process.exitCode = 1;
    return;
  }
  writeFileSync(SNAPSHOT, `${JSON.stringify(now, null, 2)}\n`);
  console.log(`記下了：${now.version}。`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
