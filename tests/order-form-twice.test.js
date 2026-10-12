// 拍訂購單：同一張拍了兩次（prelaunch-fixes-2026-10-08/14）。
//
// 名字一樣的兩張照片照設計算成同一位客人的「兩次購買」（同一個月真的可能買兩次）。重拍時忘了把第一張拿掉、
// 兩張都辨識成功的話，確認卡上寫「方案×2（照片上 1、1）」，健檢、加購也各兩筆 —— 一按建立就多了一整套次數，
// 沒有任何人問過「這兩張是不是根本同一張」。
//
// **這個比較拿什麼當鑰匙？** —— 每一張各自翻譯之後的東西（買了哪個方案幾套、哪幾筆加購、哪一天），不是原字：
// 同一張辨識兩次，原字可能差一點、翻出來一樣。**同一個月真的買兩次的那條路不多一道**（日期不同或內容不同就不問）。
// 假抄字一律王小明；沒有任何真的單子上的字。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  blockersOf, groupOrderForms, mergeTranscripts, orderDraftFrom, removePhoto, repeatedPhotos, repeatSay,
} from '../public/js/domain/orderForm.js';
import { SEED } from '../public/js/domain/seed.js';

const master = {
  plans: SEED.plans, courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts ?? [],
  products: SEED.products ?? [], clinicalFlags: SEED.clinicalFlags ?? [], partners: SEED.partners ?? [],
};
const form = (over = {}) => ({
  readable: true, unreadable: [], customerName: '王小明', formMonth: '2026年10月', handwrittenDates: ['10/3'],
  packages: [{ printedName: '8萬筋骨強身', quantity: '1' }], checkupTicked: ['5萬'],
  handwrittenRows: [{ text: '任選(30)', quantity: '10' }], unpaid: '0', obNote: '', stickyNotes: [], ...over,
});
const photosOf = (...transcripts) => transcripts.map((t, i) => ({ url: `u${i}`, transcript: t }));

/** 確認卡的 `cardFor()` 做的事：一位一張卡，帶著「哪幾張看起來是重拍的」。 */
function cardsOf(...transcripts) {
  return groupOrderForms(photosOf(...transcripts)).map((group) => ({
    group,
    ...orderDraftFrom(mergeTranscripts(group.photos.map((p) => p.transcript)), master),
    repeats: repeatedPhotos(group.photos, master),
    nameOk: true, who: 'new', twiceOk: false,
  }));
}

describe('同一張拍了兩次', () => {
  test('兩張翻出來一模一樣：擋下來，講得出是哪兩張', () => {
    const [card] = cardsOf(form(), form());
    assert.equal(card.draft.quantity, 2, '照舊併成兩套 —— 所以才要問');
    assert.deepEqual(card.repeats, [{ at: 1, of: 0 }], '第 2 張像第 1 張');
    const blockers = blockersOf(card, []);
    assert.equal(blockers.length, 1);
    assert.match(blockers[0], /同一張訂購單：拿掉一張，或點「真的買了兩次」/);
    assert.match(repeatSay(card), /第 1、2 張看起來是同一張訂購單/);
  });

  test('原字差一點、翻出來一樣（「—」與「1」、「8萬筋骨強身」多一個空白）：照樣認得', () => {
    const again = form({ packages: [{ printedName: '8萬 筋骨強身', quantity: '—' }], handwrittenRows: [{ text: '任選 (30)', quantity: 'x10' }] });
    assert.deepEqual(cardsOf(form(), again)[0].repeats, [{ at: 1, of: 0 }]);
  });

  test('日期那一格其中一張沒抄到：算同一張（寧可多問一次）', () => {
    assert.deepEqual(cardsOf(form(), form({ handwrittenDates: [] }))[0].repeats, [{ at: 1, of: 0 }]);
  });

  test('第二張認不出名字（掛在前一張身上）也一樣', () => {
    const [card] = cardsOf(form(), form({ customerName: '' }));
    assert.equal(card.group.photos[1].attached, true);
    assert.deepEqual(card.repeats, [{ at: 1, of: 0 }]);
  });

  test('三張都一樣：後面兩張都算重拍', () => {
    const [three] = cardsOf(form(), form(), form());
    assert.deepEqual(three.repeats, [{ at: 1, of: 0 }, { at: 2, of: 0 }]);
    assert.match(repeatSay(three), /第 1、2、3 張/);
  });
});

describe('出路有兩條', () => {
  test('她點了「真的買了兩次」：過了，兩套都建，跟以前一樣', () => {
    const [card] = cardsOf(form(), form());
    const ok = { ...card, twiceOk: true };
    assert.deepEqual(blockersOf(ok, []), []);
    assert.equal(ok.draft.quantity, 2);
    assert.equal(ok.draft.extras.length, 4);
    assert.equal(repeatSay(ok), repeatSay(card), '那一句還在（看得出她按過什麼）');
  });

  test('拿掉一張：那一位只剩一張、一套，不再擋', () => {
    const groups = groupOrderForms(photosOf(form(), form()));
    const after = removePhoto(groups, groups[0].key, 'u1');
    assert.deepEqual(after[0].photos.map((p) => p.url), ['u0']);
    const read = orderDraftFrom(mergeTranscripts(after[0].photos.map((p) => p.transcript)), master);
    assert.equal(read.draft.quantity, 1);
    assert.deepEqual(repeatedPhotos(after[0].photos, master), []);
  });

  test('拿掉一張不會把那一位整個拿掉（只剩一張時不給拿）；別位原封不動', () => {
    const groups = groupOrderForms(photosOf(form(), form({ customerName: '李小華' })));
    assert.deepEqual(removePhoto(groups, groups[0].key, 'u0'), groups);
    const two = groupOrderForms(photosOf(form(), form(), form({ customerName: '李小華' })));
    const after = removePhoto(two, two[0].key, 'u0');
    assert.deepEqual(after.map((g) => g.photos.map((p) => p.url)), [['u1'], ['u2']]);
    assert.equal(after[1], two[1]);
  });
});

describe('同一個月真的買兩次：不多一道', () => {
  test('日期不同', () => {
    const [card] = cardsOf(form(), form({ handwrittenDates: ['10/17'] }));
    assert.deepEqual(card.repeats, []);
    assert.deepEqual(blockersOf(card, []), []);
    assert.equal(repeatSay(card), '');
  });

  test('內容不同（套數、加購的次數、有沒有健檢）', () => {
    assert.deepEqual(cardsOf(form(), form({ packages: [{ printedName: '8萬筋骨強身', quantity: '2' }] }))[0].repeats, []);
    assert.deepEqual(cardsOf(form(), form({ handwrittenRows: [{ text: '任選(30)', quantity: '5' }] }))[0].repeats, []);
    assert.deepEqual(cardsOf(form(), form({ checkupTicked: [] }))[0].repeats, []);
  });

  test('便利貼特寫那一張（什麼都沒買）不算重拍', () => {
    const sticky = { readable: true, unreadable: [], customerName: '', stickyNotes: ['尾款下次付'] };
    assert.deepEqual(cardsOf(form(), sticky)[0].repeats, []);
    assert.deepEqual(cardsOf(form(), sticky, { ...sticky })[0].repeats, [], '兩張都沒買東西，沒有東西會變兩份');
  });

  test('只拍一張：一個字都不多', () => {
    const [card] = cardsOf(form());
    assert.deepEqual([card.repeats, blockersOf(card, []), repeatSay(card)], [[], [], '']);
  });

  test('沒帶 repeats 的舊卡（別的呼叫端）照舊', () => {
    const { draft, unresolved } = orderDraftFrom(form(), master);
    assert.deepEqual(blockersOf({ draft, unresolved, nameOk: true, who: 'new' }, []), []);
  });
});

describe('已知的洞（順手看、沒有做）', () => {
  test('同一張拍兩次、第二張名字抄錯一個字：照舊是兩張卡，這一支擋不到', () => {
    const cards = cardsOf(form(), form({ customerName: '王小朋' }));
    assert.equal(cards.length, 2);
    assert.deepEqual(cards.map((c) => c.repeats), [[], []]);
  });
});

describe('orderConfirm.js：那一句與兩顆按鈕（掃原始碼）', () => {
  const src = readFileSync(new URL('../public/js/ui/components/orderConfirm.js', import.meta.url), 'utf8');

  test('卡上的重拍是問 domain 的（repeatedPhotos／repeatSay／removePhoto），不在畫面裡比', () => {
    for (const name of ['repeatedPhotos(', 'repeatSay(', 'removePhoto(']) assert.ok(src.includes(name), name);
    assert.ok(src.includes('data-oc-remove'), '「拿掉這一張」是新的一顆');
    assert.ok(src.includes('data-oc-twice'), '「真的買了兩次」');
  });

  test('那一句會改變寫進去的東西（多一整套次數）：不收進 tip()', () => {
    const at = src.indexOf('function twiceHtml(');
    assert.ok(at > 0);
    const body = src.slice(at, src.indexOf('\n  }\n', at));
    assert.ok(!body.includes('tip('));
  });
});
