// app 的名字與圖示（2026-10-12 改名「暴富日常」、換圖示）。
//
// 名字寫在三個讀不到彼此的地方：`manifest.webmanifest`（Android 主畫面）、`index.html`
// （分頁標題與 iOS 主畫面）、`ui/shell.js`（登入畫面與換頁之後的分頁標題）。
// 只改其中一個的話，她在主畫面上看到一個名字、打開之後分頁上是另一個。
//
// 圖示那一半盯的是「寫在設定裡的檔案真的在、大小真的是寫的那個」—— 少一張時瀏覽器不會講，
// 主畫面上就是一個灰色的字母。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { fromRoot } from './helpers/paths.js';

const MANIFEST = JSON.parse(readFileSync(fromRoot('public/manifest.webmanifest'), 'utf8'));
const STAGING_MANIFEST = JSON.parse(readFileSync(fromRoot('public/manifest-staging.webmanifest'), 'utf8'));
const INDEX = readFileSync(fromRoot('public/index.html'), 'utf8');
const SHELL = readFileSync(fromRoot('public/js/ui/shell.js'), 'utf8');
const FORM = readFileSync(fromRoot('public/form.html'), 'utf8');

/** PNG 檔頭寫的寬與高（IHDR 是第一個 chunk，位置固定）。 */
function pngSize(publicPath) {
  const buf = readFileSync(fromRoot(`public${publicPath}`));
  assert.equal(buf.toString('latin1', 1, 4), 'PNG', `${publicPath} 不是 PNG`);
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

describe('app 的名字', () => {
  const inShell = SHELL.match(/const APP_NAME = '([^']+)';/)?.[1];

  test('三個地方是同一個名字', () => {
    assert.ok(inShell, 'shell.js 找不到 APP_NAME');
    assert.equal(MANIFEST.name, inShell);
    assert.equal(MANIFEST.short_name, inShell);
    assert.equal(INDEX.match(/<title>([^<]*)<\/title>/)?.[1], inShell);
    assert.equal(INDEX.match(/name="apple-mobile-web-app-title" content="([^"]*)"/)?.[1], inShell);
  });

  test('shell.js 裡沒有另外寫死一份', () => {
    const written = SHELL.split(inShell).length - 1;
    assert.equal(written, 1, `「${inShell}」在 shell.js 出現 ${written} 次，應該只有 APP_NAME 那一行`);
  });

  // staging 加到主畫面時要分得出來（她 2026-10-21）：那一份 manifest 只差名字，其餘跟著正式那一份
  test('staging 的 manifest 只有名字不一樣，名字是 APP_NAME 加「-測試版」', () => {
    const suffix = SHELL.match(/const STAGING_SUFFIX = '([^']+)';/)?.[1];
    assert.ok(suffix, 'shell.js 找不到 STAGING_SUFFIX');
    assert.equal(STAGING_MANIFEST.name, `${inShell}${suffix}`);
    assert.equal(STAGING_MANIFEST.short_name, `${inShell}${suffix}`);
    assert.deepEqual(
      { ...STAGING_MANIFEST, name: MANIFEST.name, short_name: MANIFEST.short_name },
      MANIFEST,
      'manifest-staging.webmanifest 除了名字之外要跟 manifest.webmanifest 一模一樣',
    );
    assert.ok(SHELL.includes("'/manifest-staging.webmanifest'"), 'nameTheApp() 要把 manifest 換成 staging 那一份');
  });

  // 客戶在 LINE 裡點開的那一頁不是 app 的一部分（ADR-0031）：他不該看到 app 的名字與圖示
  test('客戶填的那一頁不帶 app 的名字與圖示', () => {
    assert.ok(!FORM.includes(inShell));
    assert.ok(!/rel="(icon|apple-touch-icon|manifest)"/.test(FORM));
  });
});

describe('圖示', () => {
  test('manifest 列的每一張都在，大小是寫的那個', () => {
    assert.ok(MANIFEST.icons.length > 0);
    for (const icon of MANIFEST.icons) {
      assert.ok(existsSync(fromRoot(`public${icon.src}`)), `${icon.src} 不在`);
      assert.equal(pngSize(icon.src), icon.sizes, icon.src);
    }
  });

  // maskable 會被 Android 裁成圓形：拿滿版那一張去當的話，靠邊的圖案會被切掉
  test('maskable 是另外一張留了邊的，不是滿版那一張', () => {
    const any = MANIFEST.icons.filter((i) => i.purpose === 'any').map((i) => i.src);
    const maskable = MANIFEST.icons.filter((i) => i.purpose === 'maskable').map((i) => i.src);
    assert.ok(any.length > 0 && maskable.length > 0);
    for (const src of maskable) assert.ok(!any.includes(src), `${src} 同時當 any 與 maskable`);
  });

  test('index.html 指到的圖示都在', () => {
    const hrefs = [...INDEX.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(hrefs.length, 2, '分頁圖示與 iOS 主畫面圖示各一條');
    for (const href of hrefs) assert.ok(existsSync(fromRoot(`public${href}`)), `${href} 不在`);
  });

  test('iOS 主畫面那一張是 180', () => {
    const href = INDEX.match(/<link rel="apple-touch-icon" href="([^"]+)"/)?.[1];
    assert.equal(pngSize(href), '180x180');
  });
});
