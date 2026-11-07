// 隨手記的共用情境檔（tests/fixtures/notes-parity.json）：拿網頁真的那幾支重算每一題的 `out`。
//
//   node scripts/notes-parity.mjs           只比：哪幾題的答案跟檔案不一樣（不寫）
//   node scripts/notes-parity.mjs --write   重算、寫回檔案
//
// 什麼時候用：改了網頁的隨手記規則（domain/notes.js、data/notes.js、repo.js 的 commit、nameSuggestions()…），
// tests/notes-parity.test.js 紅了 —— 先確定新的答案是你要的，再 --write、看 git diff，
// 接著 Android 那一側（android/core 的 ParityTest，`./gradlew :core:test`）會紅，照著把 Kotlin 改到綠（ADR-0180）。
// 新增一題：在檔案裡加 { name, in }（先不寫 out），跑 --write。

import { canonicalJson, computeAll, readParity, writeParity } from '../tests/helpers/notesParity.js';

const write = process.argv.includes('--write');
const file = readParity();
const got = await computeAll(file);

let changed = 0;
for (const [name, cases] of Object.entries(file.sections)) {
  cases.forEach((c, i) => {
    if ('out' in c && canonicalJson(c.out) === canonicalJson(got[name][i])) return;
    changed += 1;
    console.log(`${write ? '改了' : '不一樣'}：${name} 第 ${i + 1} 題「${c.name}」`);
    c.out = got[name][i];
  });
}

if (write && changed) writeParity(file);
console.log(changed ? `${changed} 題${write ? '已寫回' : '跟檔案不一樣（--write 寫回）'}` : '每一題都跟檔案一樣');
process.exitCode = !write && changed ? 1 : 0;
