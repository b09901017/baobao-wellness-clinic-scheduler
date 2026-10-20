// 底下那一條滑得掉（staging-polish 05）。數字與「哪幾種給滑」在 `ui/toastSwipe.js`（純的，node 裡 import 得起來）；
// 真的收掉、拖走沒觸發復原由 E2E `69` 的 P5 量。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  UNDO_MS, TAP_SLOP_PX, DISMISS_PX, swipeable, pull, isDrag, release, fadeAt,
} from '../public/js/ui/toastSwipe.js';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

describe('停多久', () => {
  test('復原那一條停 12 秒（她 10/18：滑得掉之後停久一點）', () => {
    assert.equal(UNDO_MS, 12_000);
  });

  test('toast.js 讀的是這一支的數字，不自己另寫一份', () => {
    const src = read('public/js/ui/toast.js');
    assert.match(src, /from '\.\/toastSwipe\.js'/);
    assert.doesNotMatch(src, /const UNDO_MS\s*=/);
  });

  test('SPEC 6.3 講的是同一個數字', () => {
    assert.match(read('SPEC.md'), /12 秒，可以往左或往下滑掉/);
    assert.doesNotMatch(read('SPEC.md'), /5–10 秒/);
  });
});

describe('哪幾種給滑', () => {
  test('已儲存、可以復原、已復原、一般的一句話：給滑', () => {
    for (const k of ['saved', 'undo', 'info', 'failed']) assert.equal(swipeable(k), true, k);
  });

  test('儲存中、失敗可重試、已經存在這台裝置上了：不給滑', () => {
    for (const k of ['saving', 'retry', 'queued']) assert.equal(swipeable(k), false, k);
  });

  test('toast.js 那三種真的帶著不給滑的 kind（不然 swipeable() 對了也沒用）', () => {
    const src = read('public/js/ui/toast.js');
    assert.match(src, /export function saving[\s\S]*?kind: 'saving'/);
    assert.match(src, /export function queued[\s\S]*?kind: 'queued'/);
    assert.match(src, /export function failed[\s\S]*?kind: onRetry \? 'retry' : 'failed'/);
    assert.match(src, /data-undo>復原<\/button>`, \{\s*timeout: UNDO_MS, kind: 'undo'/);
  });
});

describe('拖多遠才收', () => {
  test('往左拖 120px 放開 → 收', () => {
    assert.equal(release({ dx: -120, dy: 0, ms: 600 }), 'dismiss');
  });

  test('往下拖到門檻 → 收；差一點 → 彈回去', () => {
    assert.equal(release({ dx: 0, dy: DISMISS_PX, ms: 800 }), 'dismiss');
    assert.equal(release({ dx: 0, dy: DISMISS_PX - 1, ms: 800 }), 'back');
  });

  test('拖 20px 放開 → 彈回去（再快都一樣：短短一下不算甩）', () => {
    assert.equal(release({ dx: -20, dy: 0, ms: 400 }), 'back');
    assert.equal(release({ dx: -20, dy: 0, ms: 2 }), 'back');
  });

  test('拖不遠但一甩 → 收', () => {
    assert.equal(release({ dx: -40, dy: 0, ms: 40 }), 'dismiss');
  });

  test('往右、往上拖不收（再遠再快都不收）', () => {
    assert.equal(release({ dx: 300, dy: 0, ms: 50 }), 'back');
    assert.equal(release({ dx: 0, dy: -300, ms: 50 }), 'back');
  });

  test('只動了一點點的點擊不是甩（不然手指抖一下也收掉）', () => {
    assert.equal(release({ dx: -3, dy: 2, ms: 1 }), 'back');
  });

  test('pull() 只留往左與往下那一半', () => {
    assert.deepEqual(pull(30, -30), { x: 0, y: 0 });
    assert.deepEqual(pull(-30, 30), { x: -30, y: 30 });
  });
});

describe('什麼時候算在滑（那一下不觸發復原）', () => {
  test(`超過 ${TAP_SLOP_PX}px 就是在滑`, () => {
    assert.equal(isDrag(0, TAP_SLOP_PX), false);
    assert.equal(isDrag(0, TAP_SLOP_PX + 1), true);
    assert.equal(isDrag(-6, -6), true);
  });

  test('拖得越遠越淡，最淡也看得到', () => {
    assert.equal(fadeAt(0, 0), 1);
    assert.equal(fadeAt(-DISMISS_PX, 0), 0.5);
    assert.ok(fadeAt(-1000, 0) >= 0.2);
    assert.equal(fadeAt(100, 0), 1, '往右不淡');
  });
});
