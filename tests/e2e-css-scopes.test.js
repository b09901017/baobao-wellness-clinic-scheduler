// `public/css/app.css` 只動到某一個元件那幾塊（`.abl-*`、`.giftfold*`…）時，`--related` 不要挑到
// 整份 CSS 的那二十幾支（2026-11-03：拍 Abovee 那一輪只改確認層的樣式，verify 挑到 63 支、半小時）。
//
// 做法跟 `views.js` 只多一頁登記那一條一樣（`e2e-views-registration.test.js`）：`pick()` 只拿得到檔名，
// 所以 `scripts/e2e-changes.mjs` 先比新舊兩份 CSS，**每一條動到的規則**都只指著同一個元件的 class
// 才把 `app.css` 換成 `app.css#那一組`；`pick()` 照 `related.js` 的 `CSS_SCOPES` 挑「本來就看 CSS、
// 而且畫得出那個元件」的那幾支（兩份名單的交集）。
//
// 判準照舊是**寧可多跑、不可安靜地少跑**：動到共用的（`.btn`、`body`…）、一條選擇器裡混著別的、
// 搬了位置、`@keyframes`、括號裡才提到那一組 → 照舊當成整份 `app.css` 動了。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { APP_CSS, narrowCss } from '../scripts/e2e-changes.mjs';
import { CSS_SCOPES, pick } from '../tests-e2e/related.js';
import { fromRoot } from './helpers/paths.js';

const SOURCE = readFileSync(fromRoot(APP_CSS), 'utf8').replace(/\r\n/g, '\n');

/** 在 SOURCE 上換一段字（那一段一定要在、而且只有一個）。 */
const edit = (from, to, src = SOURCE) => {
  assert.equal(src.split(from).length, 2, `SOURCE 裡要剛好有一段 ${JSON.stringify(from.slice(0, 40))}`);
  return src.replace(from, to);
};

const ABL_SEG = '.abl__seg {\n  margin-bottom: var(--space-4);\n}';
const BTN_HEAD = '.btn {\n  min-height: 42px;';

const whole = pick([APP_CSS]);
const ablSpecs = pick([`${APP_CSS}#abl`]);

test('只改 .abl 那幾條：只挑看 CSS、而且畫得出拍 Abovee／療程單確認層的那幾支', () => {
  const after = edit(ABL_SEG, '.abl__seg {\n  margin-bottom: var(--space-3);\n}');
  assert.deepEqual(narrowCss(SOURCE, after), ['abl']);

  assert.equal(whole.all, false);
  assert.equal(ablSpecs.all, false);
  assert.ok(ablSpecs.specs.length < whole.specs.length, `${ablSpecs.specs.length} 支，整份是 ${whole.specs.length} 支`);
  for (const s of ['86-abovee-row-glance', '87-abovee-result-and-problems', '68-abovee-status-follows-photo']) {
    assert.ok(ablSpecs.specs.includes(s), `少了 ${s}`);
  }
  // 摸不到拍 Abovee 的那幾支不跑
  for (const s of ['31-calendar-title', '39-new-customer-form', '74-long-notes']) {
    assert.ok(!ablSpecs.specs.includes(s), `${s} 不該被挑到`);
  }
});

test('縮小之後永遠是整份 app.css 那一份的子集合（只會少跑摸不到那個元件的）', () => {
  for (const scope of Object.keys(CSS_SCOPES)) {
    const r = pick([`${APP_CSS}#${scope}`]);
    assert.equal(r.all, false, scope);
    for (const s of r.specs) assert.ok(whole.specs.includes(s), `${scope} 挑到 ${s}，但整份 app.css 不會`);
    // 「看 CSS 而且摸得到那個元件」的每一支都要在
    const touching = new Set(CSS_SCOPES[scope].owners.flatMap((f) => pick([f]).specs));
    for (const s of whole.specs) {
      if (touching.has(s)) assert.ok(r.specs.includes(s), `${scope} 漏了 ${s}`);
    }
  }
});

test('改到 .btn：照舊當成整份 app.css 動了', () => {
  const after = edit(BTN_HEAD, '.btn {\n  min-height: 44px;');
  assert.equal(narrowCss(SOURCE, after), null);
  assert.equal(pick([APP_CSS]).specs.length, whole.specs.length);
});

test('同一份裡 .abl 與 .giftfold 都改了：兩組都挑', () => {
  let after = edit(ABL_SEG, '.abl__seg {\n  margin-bottom: 0;\n}');
  after = after.replace(/\.giftfold \{/, '.giftfold {\n  outline: 0;');
  assert.deepEqual(narrowCss(SOURCE, after), ['abl', 'giftfold']);
  const both = pick([`${APP_CSS}#abl`, `${APP_CSS}#giftfold`]);
  assert.ok(both.specs.includes('56-what-to-do-by-group'), '.giftfold 那一側');
  assert.ok(both.specs.includes('86-abovee-row-glance'), '.abl 那一側');
});

test('新增、刪掉一整條 .abl 的規則也認得；在 .abl 底下改共用元件的樣子也算 .abl', () => {
  assert.deepEqual(narrowCss(SOURCE, edit(ABL_SEG, `${ABL_SEG}\n\n.abl__new {\n  gap: 0;\n}`)), ['abl']);
  assert.deepEqual(narrowCss(SOURCE, edit(ABL_SEG, '')), ['abl']);
  assert.deepEqual(narrowCss(SOURCE, edit(ABL_SEG, `${ABL_SEG}\n.abl-row .btn, .abl__seg > .chip:hover { gap: 0; }`)), ['abl']);
  // 打開著才有的 body class 也是同一組
  assert.deepEqual(narrowCss(SOURCE, edit(ABL_SEG, `${ABL_SEG}\nbody.has-abl .app__main { overflow: hidden; }`)), ['abl']);
});

test('只動了註解或空白：一支都不用為了 CSS 跑', () => {
  const after = edit(ABL_SEG, `/* 換個說法 */\n${ABL_SEG.replace('\n  margin', '\n\n    margin')}`);
  assert.deepEqual(narrowCss(SOURCE, after), []);
});

test('認不出來的一律退回整份：混著別的、括號裡才提到、搬位置、@keyframes、拿掉註解露出共用規則', () => {
  const cases = {
    混著別的: `${ABL_SEG}\n.abl__x, .btn { gap: 0; }`,
    括號裡才提到: `${ABL_SEG}\nbody:has(.abl) > .toast { bottom: 0; }`,
    不是那一組只是開頭一樣: `${ABL_SEG}\n.ablation { gap: 0; }`,
    keyframes: `${ABL_SEG}\n@keyframes wobble { from { opacity: 0; } }`,
    頂層的陳述: `${ABL_SEG}\n@import url(x.css);`,
    巢狀: `.abl__seg {\n  margin-bottom: var(--space-4);\n  .btn { gap: 0; }\n}`,
  };
  for (const [name, to] of Object.entries(cases)) {
    assert.equal(narrowCss(SOURCE, edit(ABL_SEG, to)), null, name);
  }
  // 拿掉註解記號：diff 上只有那兩行，但 .btn 的規則活過來了
  const commented = edit(ABL_SEG, `${ABL_SEG}\n/*\n.btn { gap: 0; }\n*/`);
  assert.equal(narrowCss(commented, commented.replace('/*\n.btn { gap: 0; }\n*/', '.btn { gap: 0; }')), null, '拿掉註解');
  // 搬位置：規則一模一樣，但先後變了（同樣的權重後面的贏）
  const btn = SOURCE.match(/\n\.btn \{[^}]*\}\n/)[0];
  const moved = SOURCE.replace(btn, '\n').replace(ABL_SEG, `${ABL_SEG}${btn}`);
  assert.equal(narrowCss(SOURCE, moved), null, '搬位置');
});

test('@media 的條件改了：裡面每一條都只是那一組才算', () => {
  const ablOnly = '@media (min-width: 900px) {\n  .abl__seg { gap: 0; }\n}';
  const withBtn = '@media (min-width: 900px) {\n  .abl__seg { gap: 0; }\n  .btn { gap: 0; }\n}';
  const a = edit(ABL_SEG, `${ABL_SEG}\n${ablOnly}`);
  assert.deepEqual(narrowCss(a, a.replace(ablOnly, ablOnly.replace('900px', '700px'))), ['abl']);
  const b = edit(ABL_SEG, `${ABL_SEG}\n${withBtn}`);
  assert.equal(narrowCss(b, b.replace(withBtn, withBtn.replace('900px', '700px'))), null);
});

test('pick() 不認得的那一組退回全跑', () => {
  const r = pick([`${APP_CSS}#還沒登記的一組`]);
  assert.equal(r.all, true);
  assert.match(r.why.join(''), /沒有登記/);
});

// 這一組 class 被別的檔案也拿去用了，卻沒有列在 owners 裡 → 那個畫面的 spec 會安靜地被少跑。
test('每一組 class 只出現在登記的那幾個檔案裡', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(fromRoot(dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.js') || p.endsWith('.html')) files.push(p);
    }
  };
  walk('public');
  const bad = [];
  for (const [scope, { classes, owners }] of Object.entries(CSS_SCOPES)) {
    const re = new RegExp(`(?<![\\w-])(?:${classes.join('|')})(?![A-Za-z0-9])`);
    for (const f of files) {
      if (owners.includes(f)) continue;
      const hit = readFileSync(fromRoot(f), 'utf8').split('\n').find((l) => re.test(l));
      if (hit) bad.push(`${scope}：${f} 也用到了（${hit.trim().slice(0, 60)}）`);
    }
  }
  assert.deepEqual(bad, [], `把這幾個檔案加進 related.js 的 CSS_SCOPES 那一組的 owners：\n  ${bad.join('\n  ')}`);
});

test('CSS_SCOPES 的 owners 都真的存在', () => {
  for (const { owners } of Object.values(CSS_SCOPES)) {
    for (const o of owners) assert.doesNotThrow(() => readFileSync(join(fromRoot('.'), o)), o);
  }
});
