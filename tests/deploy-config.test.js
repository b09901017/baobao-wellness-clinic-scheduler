// 部署「看起來成功不等於成功」的那幾條（docs/agents/lessons.md 第九節，
// prelaunch-fixes-2026-10-08/issues/04）。這三份設定檔以前沒有任何一支測試讀。
//
// 1. `firebase.json` 的快取標頭：Hosting 的預設是 `max-age=3600`，2026-10-08 以前只有 `/sw.js` 與
//    `/index.html` 設了不快取 —— `/js/**`、`/css/**`、連首頁網址 `/` 都是一小時。
//    service worker 是網路優先，但它抓檔也經過瀏覽器的 HTTP 快取，所以部署完一小時內拿到的可能是
//    新舊混在一起的檔案（「明明改好了卻沒變」不一定是 `sw.js` 的版號）。
// 2. `deploy.yml` 的排隊：兩次 push 連著來，較舊的那一次測試跑得久、後完成，就把新的蓋回去
//    （10/7 staging 有 19 秒退回上一版）。
// 3. `.firebaserc` 的預設專案在 `tests/env.test.js`。
//
// **這裡驗的是設定檔寫了什麼，不是線上真的回什麼** —— 那要部署完 `curl -sI` 才知道，寫在驗收清單裡。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { fromRoot, toPosix } from './helpers/paths.js';

const FIREBASE = JSON.parse(readFileSync(fromRoot('firebase.json'), 'utf8'));
const DEPLOY = readFileSync(fromRoot('.github/workflows/deploy.yml'), 'utf8');
const PUBLIC = fromRoot('public/');

/**
 * Hosting 的 glob → 正規表示式。只認這份設定檔用得到的三種：`**`、`*`、`@(a|b)`。
 * 認不得的寫法會讓下面「每一條規則都看得懂」那一條紅 —— 不要靜靜地當成不符合。
 */
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (glob.startsWith('**/', i)) { out += '(?:.*/)?'; i += 2; }
    else if (glob.startsWith('**', i)) { out += '.*'; i += 1; }
    else if (c === '*') out += '[^/]*';
    else if (glob.startsWith('@(', i)) {
      const end = glob.indexOf(')', i);
      out += `(?:${glob.slice(i + 2, end).split('|').map((x) => x.replace(/[.]/g, '[.]')).join('|')})`;
      i = end;
    } else out += c.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

const RULES = FIREBASE.hosting.headers.map((h) => ({
  source: h.source,
  // Hosting 比對時開頭的斜線有沒有都算
  re: globToRegExp(h.source.startsWith('/') ? h.source : `/${h.source}`),
  cache: h.headers.find((x) => x.key.toLowerCase() === 'cache-control')?.value ?? null,
}));

/**
 * 這個網址路徑對得上的每一條規則給的 Cache-Control，照設定檔裡的順序。
 *
 * **不快取寫成第一條 `**`（全部），會變的才是預設；不會變的圖示在後面另外蓋回一小時。**
 * 反過來寫（一種一種列出要不快取的副檔名）的話，首頁網址 `/` 對不對得上要看 Hosting 的 glob 怎麼解，
 * 而新加一種副檔名會安靜地漏掉 —— 那兩種漏法的下場都是「部署完拿到舊程式」。
 * 程式檔那幾條斷言要求**對得上的每一條都是 no-cache**，所以不管 Hosting 是後面蓋前面還是前面贏都成立；
 * 圖示那一條假設後面蓋前面（Hosting 的行為），猜錯的下場只是圖示多一趟 304。
 */
const cacheFor = (path) => RULES.filter((r) => r.re.test(path)).map((r) => r.cache).filter(Boolean);

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

describe('firebase.json：程式檔每次都先問伺服器', () => {
  test('每一條規則的寫法這支測試都看得懂', () => {
    for (const r of RULES) assert.doesNotMatch(r.source, /[!{}[\]?]|\+\(|\*\(/, `看不懂的 glob：${r.source}`);
  });

  test('首頁網址 `/` 也不快取（她打開的就是它）', () => {
    assert.deepEqual(cacheFor('/'), ['no-cache']);
  });

  test('第一條是「全部不快取」—— 沒列到的東西預設也是每次先問', () => {
    assert.deepEqual(RULES[0], { source: '**', re: RULES[0].re, cache: 'no-cache' });
    assert.deepEqual(cacheFor('/js/以後才加的.mjs'), ['no-cache']);
    assert.deepEqual(cacheFor('/data/以後才加的.json'), ['no-cache']);
  });

  test('原本就有的兩條還在：/sw.js 與 /index.html', () => {
    for (const path of ['/sw.js', '/index.html']) {
      assert.ok(cacheFor(path).length > 0, `${path} 沒有任何規則`);
      assert.ok(cacheFor(path).every((v) => v === 'no-cache'), `${path} 拿到 ${cacheFor(path)}`);
    }
  });

  test('public/ 底下每一支 .js／.css／.html／.webmanifest 都是 no-cache', () => {
    const code = filesUnder(PUBLIC)
      .map((f) => `/${toPosix(f.slice(PUBLIC.length))}`)
      .filter((p) => /[.](js|css|html|webmanifest)$/.test(p));
    assert.ok(code.length > 50, `只掃到 ${code.length} 支 —— 這支測試盯錯地方了`);
    const bad = code.filter((p) => {
      const got = cacheFor(p);
      return !got.length || got.some((v) => v !== 'no-cache');
    });
    assert.deepEqual(bad, [], `這幾支會被快取一小時（Hosting 的預設）：\n${bad.join('\n')}`);
  });

  test('圖示那種不會變的照舊一小時（不為它每次多發一趟請求）', () => {
    const icons = filesUnder(PUBLIC)
      .map((f) => `/${toPosix(f.slice(PUBLIC.length))}`)
      .filter((p) => /[.](png|svg|ico)$/.test(p));
    assert.ok(icons.length > 0);
    for (const p of icons) assert.equal(cacheFor(p).at(-1), 'public, max-age=3600', `${p} 最後一條是 ${cacheFor(p).at(-1)}`);
  });

  test('蓋回一小時的那一條一支程式檔都對不上', () => {
    const long = RULES.filter((r) => r.cache !== 'no-cache');
    assert.equal(long.length, 1);
    for (const p of ['/', '/index.html', '/sw.js', '/js/app.js', '/css/app.css', '/form.html', '/manifest.webmanifest']) {
      assert.ok(!long[0].re.test(p), `${p} 被蓋回一小時了`);
    }
  });
});

describe('deploy.yml：同一個環境的部署排隊，不互相蓋', () => {
  /** 最上層（沒有縮排）的某一段，到下一個最上層的鍵為止。 */
  const topLevel = (key) => {
    const m = DEPLOY.match(new RegExp(`^${key}:[^\\n]*\\n((?:[ \\t]+[^\\n]*\\n|\\s*#[^\\n]*\\n|\\n)*)`, 'm'));
    return m ? m[0] : '';
  };

  test('concurrency 在 workflow 那一層，不是只掛在 deploy 那個 job 上', () => {
    // 只掛在 job 上的話，排隊的順序是「誰的測試先跑完」不是 commit 的順序 ——
    // 10/7 那種「舊的後完成」照樣會發生。
    const block = topLevel('concurrency');
    assert.ok(block, 'deploy.yml 最上層沒有 concurrency');
    assert.match(block, /group:\s*\S+/);
    assert.match(block, /github\.ref/, 'group 要照分支分 —— 不然 staging 與正式會互相排隊');
  });

  test('不取消進行中的那一次（取消會留下一半的部署）', () => {
    assert.match(topLevel('concurrency'), /cancel-in-progress:\s*false\b/);
  });

  test('三個部署步驟都自己帶專案，不靠 .firebaserc 的預設', () => {
    const cli = [...DEPLOY.matchAll(/FIREBASE_TOOLS \}\} deploy[\s\S]*?--non-interactive/g)].map((m) => m[0]);
    assert.equal(cli.length, 2, 'Firestore 與 Storage 兩步');
    for (const step of cli) assert.match(step, /--project "\$\{\{ steps\.target\.outputs\.project \}\}"/);
    assert.match(DEPLOY, /projectId: \$\{\{ steps\.target\.outputs\.project \}\}/, 'Hosting 那一步');
  });
});

describe('本機與文件裡的 firebase 指令：沒有一條靠預設專案', () => {
  // `.firebaserc` 的預設現在是 staging。靠預設值的指令以前是上正式、現在會改上 staging ——
  // 兩種都不該是「漏打一個參數」決定的。模擬器那幾條用的是 `demo-` 專案，也自己帶著。
  const FILES = ['package.json', 'docs/STAGING.md', 'tests-e2e/start-emulators.sh',
    '.github/workflows/deploy.yml', '.github/workflows/e2e-full.yml'];
  const COMMAND = /firebase(?:-tools)?(?:@\d+)?\s+(?:deploy|emulators:(?:exec|start)|functions:[a-z:]+|firestore:[a-z:]+|hosting:[a-z:]+)\b/g;

  for (const rel of FILES) {
    test(rel, () => {
      const src = readFileSync(fromRoot(rel), 'utf8');
      const bad = [];
      for (const m of src.matchAll(COMMAND)) {
        // 一條指令可能用反斜線接好幾行：往後看到第一個不是續行的換行為止
        const rest = src.slice(m.index);
        const end = rest.search(/[^\\]\n/);
        const whole = rest.slice(0, end === -1 ? rest.length : end + 1);
        // 講到指令名字的句子不是一條要跑的指令：文件裡的 `firebase deploy` 會…、註解裡的那一行
        if (/^firebase deploy`/.test(whole)) continue;
        const line = src.slice(src.lastIndexOf('\n', m.index) + 1, m.index);
        if (/^\s*#/.test(line)) continue;
        if (!/--project\b/.test(whole)) bad.push(whole.split('\n')[0].trim());
      }
      assert.deepEqual(bad, [], `這幾條沒有帶 --project：\n${bad.join('\n')}`);
    });
  }
});
