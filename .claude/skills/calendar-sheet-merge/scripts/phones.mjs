#!/usr/bin/env node
// 電話名單：從 Abovee 截圖的擷取結果建（gift-and-trial 08）。`merge.mjs --phones` 讀它（合併檔 v7 的 `phone`）。
//
//   node phones.mjs <擷取結果.json> [<另一份.json> …] --out .local/references/phones.json
//
// 擷取結果是 `pixel-exact-screenshot-extraction` 產的（`rows[]` 每一列有 `chartNo`、`name`、`phone`）。
// 一位客人在 Abovee 上有很多列（每一段一列）：**有病歷號的照病歷號收、沒有的照名字**，同一位的電話去重（只比數字）；
// 不只一支就整串留著（`merge.mjs` 的 `applyPhones()` 看到不只一支就不寫、進報告）。
//
// **有真名與電話**：輸出只准寫進 `.local/`（同 `--board`）。**終端機只印數字。**

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** 擷取結果的列 → `{ "<病歷號或名字>": "<電話>" | ["<電話>", …] }`。 */
export function phoneList(rows) {
  const out = new Map();
  for (const r of rows ?? []) {
    const phone = String(r?.phone ?? '').trim();
    const key = String(r?.chartNo ?? '').trim() || String(r?.name ?? '').trim();
    if (!phone || !key) continue;
    const have = out.get(key) ?? [];
    if (!have.some((x) => x.replace(/\D/g, '') === phone.replace(/\D/g, ''))) out.set(key, [...have, phone]);
  }
  return Object.fromEntries([...out].map(([k, list]) => [k, list.length === 1 ? list[0] : list]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--out');
  const outPath = at >= 0 ? args[at + 1] : null;
  const inputs = args.filter((a, i) => a !== '--out' && i !== at + 1);
  if (!outPath || !inputs.length) {
    console.error('用法：node phones.mjs <擷取結果.json> … --out .local/references/phones.json');
    process.exit(1);
  }
  const where = relative(REPO, resolve(outPath));
  const inLocal = where === '.local' || where.startsWith(`.local${sep}`) || where.startsWith('.local/');
  if (!where.startsWith('..') && !isAbsolute(where) && !inLocal) {
    console.error(`電話名單有真名與電話，不可以寫進 repo（${where}）。放 .local/references/`);
    process.exit(1);
  }
  const rows = inputs.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).rows ?? []);
  const list = phoneList(rows);
  writeFileSync(outPath, `${JSON.stringify(list, null, 2)}\n`);
  const values = Object.values(list);
  console.error(`${rows.length} 列 → ${values.length} 位（不只一支的 ${values.filter(Array.isArray).length} 位）`);
}
