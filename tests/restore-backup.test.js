// 還原腳本（`scripts/restore-backup.mjs`）。
//
// 這一支測的是**看得懂備份檔**那一半：型別還原、形狀檢查、路徑組法。
// 真的寫進 Firestore 那一半在模擬器上演練（見 README 的「還原演練」），
// 這裡不碰網路。
//
// 最重要的一段是最後那個 describe：**`SECTIONS` 要跟 `data/backup.js` 的
// `exportAll()` 對得上**。那邊新增一個集合卻沒有回來加這裡，症狀是
// 「還原完少了一整類資料」—— 而那要等到她去找那一類東西才會發現。
// `backup.js` 的檔頭已經記過一次同樣的教訓（`notes` 與 `events` 被漏掉過）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SECTIONS, parseArgs, isSerialisedTimestamp, reviveValue, docDataOf,
  checkCoverage, checkShape,
} from '../scripts/restore-backup.mjs';

const BACKUP_SRC = readFileSync(
  new URL('../public/js/data/backup.js', import.meta.url),
  'utf8',
);

/** 一份最小的、通得過檢查的備份。 */
const backup = (over = {}) => ({
  version: 2,
  exportedAt: '2026-09-02T00:00:00.000Z',
  includesDeleted: true,
  settings: {},
  config: {},
  customers: [],
  entitlements: [],
  availability: [],
  visits: [],
  tasks: [],
  batches: [],
  notes: [],
  events: [],
  formInvites: [],
  formResponses: [],
  counts: {},
  ...over,
});

describe('指令列', () => {
  test('--project 兩種寫法都認得', () => {
    assert.equal(parseArgs(['a.json', '--project', 'staging']).project, 'staging');
    assert.equal(parseArgs(['a.json', '--project=staging']).project, 'staging');
  });

  test('沒給 --yes 就是不寫', () => {
    const args = parseArgs(['a.json', '--project', 'staging']);
    assert.equal(args.yes, false);
    assert.equal(args.allowProd, false, '正式環境預設要被擋');
  });

  test('檔名認得出來，不會把旗標當成檔名', () => {
    const args = parseArgs(['--dry-run', '備份.json', '--project', 'staging', '--wipe']);
    assert.equal(args.file, '備份.json');
    assert.equal(args.dryRun, true);
    assert.equal(args.wipe, true);
  });

  test('--project 後面那個值不會被當成檔名', () => {
    // 以前這裡會把 'staging' 當成檔案路徑，然後說「找不到檔案 staging」。
    assert.equal(parseArgs(['--project', 'staging', 'x.json']).file, 'x.json');
  });
});

describe('把 JSON 換回 Firestore 的型別', () => {
  test('新版 SDK 的 Timestamp（帶 type 標記）認得出來', () => {
    const v = { type: 'firestore/timestamp/1.0', seconds: 1756000000, nanoseconds: 5 };
    assert.equal(isSerialisedTimestamp(v), true);
    const out = reviveValue(v, 'x');
    assert.equal(out.constructor.name, 'Timestamp');
    assert.equal(out.seconds, 1756000000);
  });

  test('舊版的（只有 seconds / nanoseconds）也認得出來', () => {
    assert.equal(isSerialisedTimestamp({ seconds: 1, nanoseconds: 2 }), true);
  });

  test('長得像但不是的不要誤認', () => {
    // 多一個欄位就不是 Timestamp 了 —— 猜錯會把一份資料變成一個時間。
    assert.equal(isSerialisedTimestamp({ seconds: 1, nanoseconds: 2, note: 'x' }), false);
    assert.equal(isSerialisedTimestamp({ seconds: '1', nanoseconds: 2 }), false);
    assert.equal(isSerialisedTimestamp(null), false);
    assert.equal(isSerialisedTimestamp([1, 2]), false);
  });

  test('巢狀的與陣列裡的都換得到', () => {
    const out = reviveValue({
      deliveries: [{ at: { seconds: 10, nanoseconds: 0 }, productIds: ['p1'] }],
      meta: { inner: { seconds: 20, nanoseconds: 0 } },
    }, 'x');
    assert.equal(out.deliveries[0].at.constructor.name, 'Timestamp');
    assert.equal(out.deliveries[0].productIds[0], 'p1');
    assert.equal(out.meta.inner.constructor.name, 'Timestamp');
  });

  test('null 與一般的值原樣通過', () => {
    assert.equal(reviveValue(null, 'x'), null);
    assert.equal(reviveValue('王小明', 'x'), '王小明');
    assert.equal(reviveValue(12, 'x'), 12);
    assert.deepEqual(reviveValue({ a: [1, 'b', null] }, 'x'), { a: [1, 'b', null] });
  });

  test('還原不回來的型別要丟例外，不可以猜', () => {
    // 安靜地把一個 GeoPoint 變成一坨 map，要幾個月後才會有人發現。
    assert.throws(
      () => reviveValue({ type: 'firestore/geopoint/1.0', latitude: 1, longitude: 2 }, '某處'),
      /geopoint/,
    );
  });
});

describe('一筆資料要寫成什麼', () => {
  const section = SECTIONS.find((s) => s.key === 'entitlements');

  test('id 不會被寫進內容裡 —— 它是文件 id', () => {
    const data = docDataOf({ id: 'e1', customerId: 'c1', label: '復能' }, section);
    assert.equal('id' in data, false);
  });

  test('子集合的 customerId 拿掉 —— 那是匯出時貼上去的，原本沒有', () => {
    const data = docDataOf({ id: 'e1', customerId: 'c1', label: '復能' }, section);
    assert.equal('customerId' in data, false);
    assert.deepEqual(data, { label: '復能' });
  });

  test('頂層集合的欄位一個都不拿掉', () => {
    const visits = SECTIONS.find((s) => s.key === 'visits');
    const data = docDataOf({ id: 'v1', customerId: 'c1', date: '2026-09-10' }, visits);
    assert.deepEqual(data, { customerId: 'c1', date: '2026-09-10' });
  });

  test('路徑組得對', () => {
    assert.equal(section.path({ customerId: 'c1' }), 'customers/c1/entitlements');
    assert.equal(SECTIONS.find((s) => s.key === 'visits').path({}), 'visits');
  });
});

describe('備份檔的形狀檢查', () => {
  test('一份好的備份沒有話講', () => {
    assert.deepEqual(checkShape(backup()), []);
    assert.deepEqual(checkCoverage(backup()), []);
  });

  test('版本不對要擋下來', () => {
    assert.match(checkShape(backup({ version: 1 }))[0], /第 1 版/);
  });

  test('不含已刪除資料的備份要講出來', () => {
    // 那種備份救不回誤刪，而誤刪正是最需要備份的情境。
    assert.ok(checkShape(backup({ includesDeleted: false })).some((p) => /已刪除/.test(p)));
  });

  test('子集合少了 customerId 要講出來，不要猜一個', () => {
    const problems = checkShape(backup({ entitlements: [{ id: 'e1', label: 'x' }] }));
    assert.ok(problems.some((p) => /e1.*customerId/.test(p)));
  });

  test('認不得的段落要擋下來', () => {
    const unknown = checkCoverage(backup({ invoices: [] }));
    assert.deepEqual(unknown, ['invoices']);
  });
});

// ---------------------------------------------------------------------------
// 這一段是整支測試最重要的部分
// ---------------------------------------------------------------------------

describe('SECTIONS 要跟 data/backup.js 對得上', () => {
  /**
   * `exportAll()` 實際上匯出了哪幾個集合。
   *
   * 從 `repo.listWithDeleted('x')` 與 `repo.listGroup('x')` 兩種呼叫裡挖出來 ——
   * 那是那支檔案唯一讀集合的方式。
   */
  function exportedCollections() {
    const names = new Set();
    for (const m of BACKUP_SRC.matchAll(/repo\.list(?:WithDeleted|Group)\('([a-zA-Z]+)'/g)) {
      names.add(m[1]);
    }
    // 稽核是選填的（設定頁的勾選框），還原也是 --audit 才做，不算在必備裡。
    names.delete('audit');
    return names;
  }

  test('backup.js 匯出的每一個集合，這支腳本都寫得回去', () => {
    const exported = exportedCollections();
    const handled = new Set(SECTIONS.map((s) => s.key));
    const missing = [...exported].filter((name) => !handled.has(name));

    assert.deepEqual(
      missing,
      [],
      `data/backup.js 匯出了這些，但 restore-backup.mjs 的 SECTIONS 沒有：${missing.join('、')}\n`
      + '還原完會少一整類資料，而且要等到她去找那一類東西才會發現。',
    );
  });

  test('反過來也要成立 —— 不要還原一個沒有被備份的集合', () => {
    const exported = exportedCollections();
    const extra = SECTIONS.map((s) => s.key).filter((key) => !exported.has(key));
    assert.deepEqual(extra, [], `SECTIONS 有這些，但備份檔裡不會有：${extra.join('、')}`);
  });

  test('BACKUP_VERSION 跟腳本認得的版本一樣', () => {
    const m = /BACKUP_VERSION = (\d+)/.exec(BACKUP_SRC);
    assert.ok(m, 'backup.js 找不到 BACKUP_VERSION');
    assert.deepEqual(
      checkShape(backup({ version: Number(m[1]) })),
      [],
      `backup.js 的格式跳到第 ${m[1]} 版了，restore-backup.mjs 的 checkShape() 要跟著改`,
    );
  });
});
