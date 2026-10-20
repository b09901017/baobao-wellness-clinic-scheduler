// ADR 索引（`docs/adr/README.md`）跟每一支 ADR 自己寫的「推翻：」要對得上。
//
// 舊的 ADR 一個字都不改，連「狀態：」那一行也不加註記（`docs/agents/domain.md`）——
// 所以從舊的那一支看不出它被推翻了，另一個 AI 讀到它會照著做。2026-10-20 她問：
//
// > 有沒有一些 adr 其實是矛盾的……能幫我保留最新的決定就好嗎
//
// 答案是不改舊的、多一頁索引。這一支盯兩件事：
//
//   1. 每一支 ADR 都在索引的「全部」裡（新寫一支忘了登記會紅）
//   2. 一支 ADR 開頭寫了「推翻 ADR-NNNN」，索引裡 NNNN 那幾列就要提到它
//      （新的推翻了舊的、索引沒跟上會紅 —— 那正是這一頁要擋的形狀）
//
// 只看開頭那一段（第一個 `## ` 之前）：內文裡的「推翻」寫法太自由（「那會推翻 ADR-0002」是假設語氣），
// 開頭那一段是每一支 ADR 正式宣告推翻什麼的地方。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { fromRoot } from './helpers/paths.js';

const DIR = fromRoot('docs/adr/');
const INDEX = readFileSync(`${DIR}README.md`, 'utf8');
const ADRS = readdirSync(DIR).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort();

/**
 * 開頭那一段寫了「推翻」但其實不是推翻那一支的（寫在推翻清單裡、當作說明提到的）。
 * 0149 推翻 ADR-0116 那一條的括號：「（ADR-0144 推翻的那一格照 ADR-0144）」—— 0149 沒有推翻 0144。
 */
const MENTIONED_NOT_OVERTURNED = {
  '0149': ['0144'],
};

/** 開頭那一段裡被宣告推翻（或取代）的 ADR 編號 */
export function overturnedBy(text) {
  const lines = text.split(/\r?\n/);
  const end = lines.findIndex((l, i) => i > 0 && l.startsWith('## '));
  const head = lines.slice(1, end < 0 ? lines.length : end).join('\n')
    // 「ADR-0075 沒有被推翻」「ADR-0077 的立論沒有被推翻」不是推翻
    .replace(/ADR-?\d{4}[^，。；\n]{0,12}沒有被推翻/g, '')
    .replace(/\]\(\.\/[^)]*\)/g, ']');
  const found = new Set();
  const re = /推翻|取代/g;
  let m;
  while ((m = re.exec(head))) {
    const before = head.slice(Math.max(0, m.index - 3), m.index);
    if (/不$|沒有被$|沒有$|不是$|會$/.test(before)) continue; // 「不推翻」「那會推翻」
    if (/被\s*\[?ADR-?\d{4}\]?\s*$/.test(head.slice(Math.max(0, m.index - 14), m.index))) continue; // 「被 ADR-0089 取代」是反方向
    // 到下一個標籤（延伸／不推翻／例外／接續）或這一句結束
    const rest = head.slice(m.index);
    const stop = rest.search(/(?:\n|\s)(?:延伸|不推翻|例外|接續)[：:]|。\s*\n\s*\n/);
    const segment = stop < 0 ? rest : rest.slice(0, stop);
    for (const ref of segment.matchAll(/ADR-?(\d{4})/g)) found.add(ref[1]);
  }
  return [...found];
}

/** 索引「全部」那張表裡那一支的那一列，加上「被推翻的」那張表裡以它開頭的每一列 */
function indexRowsOf(n) {
  return INDEX.split('\n').filter((l) => l.startsWith(`| [${n}](`));
}

test('每一支 ADR 都在索引的「全部」裡', () => {
  const missing = ADRS.map((f) => f.slice(0, 4)).filter((n) => indexRowsOf(n).length === 0);
  assert.deepEqual(missing, [], `這幾支沒有登記在 docs/adr/README.md：${missing.join('、')}`);
});

test('ADR 開頭寫明推翻了哪一支，索引裡那一支就要提到它', () => {
  const problems = [];
  for (const f of ADRS) {
    const n = f.slice(0, 4);
    const skip = MENTIONED_NOT_OVERTURNED[n] ?? [];
    for (const old of overturnedBy(readFileSync(DIR + f, 'utf8'))) {
      if (old === n || skip.includes(old)) continue;
      const rows = indexRowsOf(old).join('\n');
      if (!rows.includes(`ADR-${n}`) && !rows.includes(`[${n}](`)) {
        problems.push(`ADR-${n} 推翻了 ADR-${old}，但索引裡 ${old} 那一列沒提到 ${n}`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('認得出「沒有被推翻」「不推翻」「被 X 取代」那幾種寫法', () => {
  assert.deepEqual(overturnedBy('# x\n日期：2026-01-01\n推翻：ADR-0075 沒有被推翻；`naming.js` 那一版被取代\n'), []);
  assert.deepEqual(overturnedBy('# x\n推翻一部分：ADR-0078（三種名字）\n延伸：ADR-0003、ADR-0004\n'), ['0078']);
  assert.deepEqual(overturnedBy('# x\n狀態：已接受（被 ADR-0089 取代：那一顆收掉了）\n'), []);
  assert.deepEqual(overturnedBy('# x\n延伸：ADR-0145 —— 不推翻，系統照舊不替她搬。\n'), []);
  assert.deepEqual(overturnedBy('# x\n推翻：[ADR-0093](./0093-a.md)「那一點」\n\n## 背景\n推翻 ADR-0001\n'), ['0093']);
});
