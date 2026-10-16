#!/usr/bin/env node
// 逐像素驗證的「候選字」：app 裡的名字、病歷號（Abovee 的寫法：補滿 8 位）、主檔上 Abovee 的寫法。
//
//   node vocab.mjs <快照.json> <候選字.json>
//
// 候選只拿來省時間：抄的字對不上時拿它們去比，**吻合與否照樣由像素決定**（pixel_verify.py）。
// 所以從 app 拿名字不是「拿 app 的答案去填 Abovee」—— 截圖上真的寫別的字，這些候選一個都不會吻合。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const { chartNosOf } = await import(pathToFileURL(resolve(REPO, 'public/js/domain/identify.js')).href);

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('用法：node vocab.mjs <快照.json> <候選字.json>');
  process.exit(2);
}
const snap = JSON.parse(readFileSync(src, 'utf8'));
const alive = (x) => x && !x.deletedAt;
const uniq = (xs) => [...new Set(xs.map((x) => String(x ?? '').trim()).filter(Boolean))];

const customers = snap.customers.filter(alive);
const name = uniq(customers.map((c) => c.name));
const chartNo = uniq(customers.flatMap((c) => chartNosOf(c)).map((n) => String(n).padStart(8, '0')));
const aliases = (rows) => (rows ?? []).filter(alive).flatMap((r) => [r.name, ...(r.aboveeNames ?? [])]);
const course = uniq([...aliases(snap.master.courses), ...aliases(snap.master.ivProducts), ...aliases(snap.master.equipment)]);
const resource = uniq([...aliases(snap.master.staff), ...(snap.master.staff ?? []).filter(alive).map((s) => s.shortName)]);
const room = uniq(aliases(snap.master.rooms));

writeFileSync(out, JSON.stringify({ name, chartNo, course, resource, room }, null, 1));
console.log(JSON.stringify({ name: name.length, chartNo: chartNo.length, course: course.length, resource: resource.length, room: room.length }));
