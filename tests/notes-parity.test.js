// 隨手記的共用情境檔（ADR-0180）：網頁這一側照不照檔案上的答案。
//
// Android 小工具（`android/core`）照抄網頁的隨手記規則與寫入，兩邊的單元測試讀**同一份** `tests/fixtures/notes-parity.json`：
// 網頁改了一條規則 → 這裡紅 → 確定是要的就 `node scripts/notes-parity.mjs --write` → Android 那一側（`./gradlew :core:test`）紅 → 改 Kotlin。
// `writes` 那一段拿**真的** `data/notes.js` ＋ `repo.js` 跑（Firestore 換成 `helpers/fakeFirestore.js`），連稽核那一則一個字都比。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fromRoot } from './helpers/paths.js';
import { canonicalJson, computeAll, readParity } from './helpers/notesParity.js';

const file = readParity();
const got = await computeAll(file);

for (const [section, cases] of Object.entries(file.sections)) {
  cases.forEach((c, i) => {
    test(`notes-parity ${section}：${c.name}`, () => {
      assert.ok('out' in c, '答案還沒算：node scripts/notes-parity.mjs --write');
      assert.equal(canonicalJson(got[section][i]), canonicalJson(c.out),
        '網頁的答案跟情境檔不一樣：改了規則的話 node scripts/notes-parity.mjs --write，再把 Android 那一側（android/core）改到綠');
    });
  });
}

const read = (rel) => readFileSync(fromRoot(rel), 'utf8').replace(/\r\n/g, '\n');

test('notes-parity：Android 那一側每一段都有在跑（ParityTest 認得每一段的名字）', () => {
  const kotlin = read('android/core/src/test/kotlin/tw/baofu/notes/core/ParityTest.kt');
  const missing = Object.keys(file.sections).filter((s) => !kotlin.includes(`"${s}" ->`));
  assert.deepEqual(missing, [], '情境檔多了一段，ParityTest 要多一個分支');
  assert.match(read('android/core/build.gradle.kts'), /tests\/fixtures\/notes-parity\.json/, 'Kotlin 的測試讀的是同一份');
});

test('notes-parity：給小工具的兩條網址真的登記在網頁上', () => {
  const views = read('public/js/ui/views.js');
  assert.match(views, /'\/todo\/notes\/note\/:id'/);
  assert.match(views, /'\/todo\/notes\/new\/give'/);
  const [link] = file.sections.links;
  assert.equal(link.out.note, `${link.in.origin}/#/todo/notes/note/${link.in.id}`);
});
