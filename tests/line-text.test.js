// 從 LINE 貼過來那一段字的清洗。domain/lineText.js。
//
// 這一支盯的是**兩個方向的錯**：換得不夠（代碼留在畫面上）與換過頭
// （把她自己打的全形括號、內文裡的數字一起改掉）。第二種比第一種嚴重得多 ——
// 留下來的代碼她看得到，被改掉的字她看不到。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeLinePaste, describeCleanup, EMOJI_PLACEHOLDER, EMOJI_ROW,
} from '../public/js/domain/lineText.js';

/** 她從 LINE 筆記本複製出來的那一段（真名換成客戶A）。 */
const HERS = [
  '(emoji)今天反思：客訴×顧客會點滴（客戶A）',
  '(emoji)前情提醒',
  '(加1)飯後打針 （通知客人）',
  '(2)預約系統註記（*第一針或*血管難打）',
  '(emoji)當天',
  '(加1)前一天詢問阿長房間負責人',
  '(2)提早10分，來檢查房間（乾淨度），開好冷氣',
  '*休2 萬用卡',
  '(3)檢查療程單在幾樓',
  '(4)結束後，拆止血帶＆詢問車牌號碼＆收回房間鑰匙',
  '(emoji)結束',
  '四樓要清理',
].join('\n');

test('她那一整段，逐行都對', () => {
  assert.deepEqual(sanitizeLinePaste(HERS).split('\n'), [
    '🐻 今天反思：客訴×顧客會點滴（客戶A）',
    '🐻 前情提醒',
    '1️⃣ 飯後打針 （通知客人）',
    '2️⃣ 預約系統註記（*第一針或*血管難打）',
    '🐻 當天',
    '1️⃣ 前一天詢問阿長房間負責人',
    '2️⃣ 提早10分，來檢查房間（乾淨度），開好冷氣',
    // 括號外面的數字一個都不准動
    '*休2 萬用卡',
    '3️⃣ 檢查療程單在幾樓',
    '4️⃣ 結束後，拆止血帶＆詢問車牌號碼＆收回房間鑰匙',
    '🐻 結束',
    '四樓要清理',
  ]);
});

test('冪等：清過的再清一次一模一樣', () => {
  const once = sanitizeLinePaste(HERS);
  assert.equal(sanitizeLinePaste(once), once);
});

test('全形括號一個字都不動 —— 她的內文到處是這種', () => {
  const text = '（乾淨度）（通知客人）（1）（emoji）';
  assert.equal(sanitizeLinePaste(text), text);
});

test('(11) 以上原樣留著 —— 沒有對應的字元，硬拼會變豆腐格', () => {
  assert.equal(sanitizeLinePaste('(11)第十一件事'), '(11)第十一件事');
  assert.equal(sanitizeLinePaste('(加11)x'), '(加11)x');
  assert.equal(sanitizeLinePaste('(0)x'), '(0)x');
  assert.equal(sanitizeLinePaste('(123)x'), '(123)x');
});

test('(10) 換得掉，因為 🔟 存在', () => {
  assert.equal(sanitizeLinePaste('(10)最後一件'), '🔟 最後一件');
});

test('後面已經有空白就不要再補一個', () => {
  assert.equal(sanitizeLinePaste('(1) 飯後打針'), '1️⃣ 飯後打針');
  assert.equal(sanitizeLinePaste('(1)\n下一行'), '1️⃣\n下一行');
  // 代碼在最後面，後面什麼都沒有
  assert.equal(sanitizeLinePaste('結束(emoji)'), '結束🐻');
});

test('行尾空白去掉，連續空行收成一個', () => {
  assert.equal(sanitizeLinePaste('一   \n\n\n\n二'), '一\n\n二');
  // 一個空行是她自己排的版，留著
  assert.equal(sanitizeLinePaste('一\n\n二'), '一\n\n二');
});

test('行首的縮排不動 —— 她可能刻意用它分層', () => {
  assert.equal(sanitizeLinePaste('一\n    二\n\t三'), '一\n    二\n\t三');
});

test('空的與 null 收得下', () => {
  assert.equal(sanitizeLinePaste(''), '');
  assert.equal(sanitizeLinePaste(null), '');
  assert.equal(sanitizeLinePaste(undefined), '');
});

test('describeCleanup 只在真的換掉東西時說話', () => {
  assert.equal(describeCleanup(HERS, sanitizeLinePaste(HERS)), '換掉 10 個貼圖代碼');
  assert.equal(describeCleanup('沒有代碼', '沒有代碼'), '');
  // 換不掉的不算
  assert.equal(describeCleanup('(11)x', sanitizeLinePaste('(11)x')), '');
});

test('自動換上的那一顆，在下面那一排 emoji 裡找得到', () => {
  // 兩份清單分家的話，她會發現想換掉自動換上的那顆卻找不到同一顆
  assert.ok(EMOJI_ROW.includes(EMOJI_PLACEHOLDER));
  assert.ok(EMOJI_ROW.includes('1️⃣'));
  assert.equal(new Set(EMOJI_ROW).size, EMOJI_ROW.length, '一排裡不可以有重複的');
});
