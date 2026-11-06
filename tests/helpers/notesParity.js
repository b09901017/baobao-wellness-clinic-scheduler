// 隨手記的共用情境檔（`tests/fixtures/notes-parity.json`）：網頁這一側怎麼跑。
//
// 情境檔一段一段（`sections`），每一段是 { in, out } 的清單。這一支拿**網頁真的那幾支**算出 `out`：
// `tests/notes-parity.test.js` 比它跟檔案一樣、`scripts/notes-parity.mjs --write` 拿它重寫檔案。
// Android 那一側（`android/core` 的 `ParityTest`）讀同一份、拿 Kotlin 那一份算，**兩邊對同一份答案**（ADR-0180）。
//
// 值的寫法：Firestore 的時間寫 `{ "$ts": [秒, 奈秒] }`、伺服器時間寫 `"$server"`；自動產生的 id 照出現的順序換成 `$1`、`$2`…
// （排序過的鍵、深度優先 —— Kotlin 那一側同一套 `canonical()`）。

import { readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { mock } from 'node:test';
import { pathToFileURL } from 'node:url';

import { fromRoot } from './paths.js';

export const PARITY_FILE = fromRoot('tests/fixtures/notes-parity.json');

const FAKE_URL = pathToFileURL(fromRoot('tests/helpers/fakeFirestore.js')).href;

let hooked = false;
function hookFirestore() {
  if (hooked) return;
  hooked = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('https://www.gstatic.com/firebasejs/')) return { url: FAKE_URL, shortCircuit: true };
      if (specifier === './firebase.js' && context.parentURL?.endsWith('/public/js/data/repo.js')) {
        return { url: FAKE_URL, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}

async function modules() {
  hookFirestore();
  const [notes, dates, customers, masterData, identify, data, firestore] = await Promise.all([
    import('../../public/js/domain/notes.js'),
    import('../../public/js/domain/dates.js'),
    import('../../public/js/domain/customers.js'),
    import('../../public/js/domain/masterData.js'),
    import('../../public/js/domain/identify.js'),
    import('../../public/js/data/notes.js'),
    import(FAKE_URL),
  ]);
  return { notes, dates, customers, masterData, identify, data, firestore };
}

// ---------- 值的轉換 ----------

/** 檔案裡的值 → 網頁那幾支吃的值（`$ts` → Timestamp）。 */
function revive(v, FakeTs) {
  if (Array.isArray(v)) return v.map((x) => revive(x, FakeTs));
  if (v && typeof v === 'object') {
    if (Array.isArray(v.$ts)) return new FakeTs(v.$ts[0], v.$ts[1]);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x, FakeTs)]));
  }
  return v;
}

/** 網頁算出來的 → 檔案的寫法（undefined 拿掉，跟 JSON 一樣）。 */
function plain(v, { FakeTs, SERVER }) {
  if (v === SERVER) return '$server';
  if (v instanceof FakeTs) return { $ts: [v.seconds, v.nanoseconds] };
  if (Array.isArray(v)) return v.map((x) => plain(x, { FakeTs, SERVER }));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => [k, plain(x, { FakeTs, SERVER })]));
  }
  return v;
}

/** 排過鍵的 JSON（Kotlin 那一側的 `canonical()` 同一套）。 */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** 自動產生的 id（`gen-N`）照出現的順序換成 `$1`、`$2`…。 */
function renameIds(v) {
  const text = canonicalJson(v);
  const seen = new Map();
  for (const m of text.matchAll(/gen-\d+/g)) if (!seen.has(m[0])) seen.set(m[0], `$${seen.size + 1}`);
  const swap = (x) => {
    if (typeof x === 'string') return x.replace(/gen-\d+/g, (id) => seen.get(id));
    if (Array.isArray(x)) return x.map(swap);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, swap(y)]));
    return x;
  };
  return swap(v);
}

// ---------- 每一段怎麼算 ----------

const ids = (list) => list.map((n) => n.id);

const SECTIONS = {
  normalize: ({ notes }, a) => notes.normalize(a.note),
  normalizePatch: ({ notes }, a) => notes.normalizePatch(a.changes),
  validateNote: ({ notes }, a) => notes.validateNote(a.note).errors,
  dates: ({ dates }, a) => ({ valid: dates.isValidDate(a.iso), short: dates.isValidDate(a.iso) ? dates.shortDate(a.iso) : null }),
  doneAt: (_m, a) => new Date(a.ms).toISOString(),
  sortNotes: ({ notes }, a) => ids(notes.sortNotes(a.notes)),
  openCount: ({ notes }, a) => notes.openCount(a.notes),
  groupLinked: ({ notes }, a) => notes.groupLinked(a.notes, a.today).map((row) => ({
    note: row.note.id, members: ids(row.members), days: row.days, badge: notes.linkedBadge(row),
  })),
  linkedPeers: ({ notes }, a) => ids(notes.linkedPeers(a.note, a.notes)),
  linkedChanges: ({ notes }, a) => notes.linkedChanges(a.before, a.patch, a.peers),
  copyPlan: ({ notes }, a) => notes.copyPlan(a.note, a.dates, { linked: a.linked, group: a.group, newLinkId: a.newLinkId }),
  copiedSay: ({ notes }, a) => notes.copiedSay(a),
  linkedReach: ({ notes }, a) => notes.linkedReach(a.note, a.peers),
  noteActions: ({ notes }, a) => notes.noteActions(a.note, { reach: a.reach }),
  dateChoices: ({ notes }, a) => notes.dateChoices(a.note, { today: a.today, onCalendar: a.onCalendar }),
  normalizeAlias: ({ masterData }, a) => masterData.normalizeAlias(a.raw),
  normalizeChartNo: ({ identify }, a) => identify.normalizeChartNo(a.raw),
  chartNosOf: ({ identify }, a) => identify.chartNosOf(a.customer),
  nameHas: ({ customers }, a) => customers.nameHas(a.name, a.query),
  chartNoHas: ({ customers }, a) => customers.chartNoHas(a.customer, a.query),
  nameSuggestions: ({ customers }, a) => {
    const got = customers.nameSuggestions(a.text, a.caret ?? a.text.length, a.people, { currentId: a.currentId ?? null });
    return { from: got.from, to: got.to, ids: ids(got.matches) };
  },
  links: (_m, a) => ({ note: `${a.origin}/#/todo/notes/note/${a.id}`, newGive: `${a.origin}/#/todo/notes/new/give` }),
};

const CALLS = {
  create: (d, [data]) => d.create(data),
  update: (d, [id, changes]) => d.update(id, changes),
  setDone: (d, [id, done]) => d.setDone(id, done),
  remove: (d, [id, reason]) => d.remove(id, reason),
  removeRow: (d, [note, reason]) => d.removeRow(note, reason),
  copyTo: (d, [note, dates, linked]) => d.copyTo(note, dates, { linked }),
  unlink: (d, [id]) => d.unlink(id),
};

/** `writes` 那一段：拿真的 `data/notes.js` 跑，記下送進 `writeBatch()` 的每一筆。 */
async function runWrites(m, a) {
  const { fake, FakeTs } = m.firestore;
  const store = new Map();
  for (const [col, docs] of Object.entries(a.store ?? {})) {
    for (const [id, doc] of Object.entries(docs)) store.set(`${col}/${id}`, revive(doc, FakeTs));
  }
  fake.reset({ store, uid: a.uid });
  mock.timers.enable({ apis: ['Date'], now: a.now ?? 0 });
  let result;
  let error;
  try {
    result = await CALLS[a.call](m.data, revive(a.args, FakeTs));
  } catch (e) {
    error = e.message;
  } finally {
    mock.timers.reset();
  }
  const out = { writes: fake.writes };
  if (error !== undefined) out.error = error;
  else if (result !== undefined) out.result = result;
  return renameIds(plain(out, m.firestore));
}

/** 整份情境檔：每一段每一題網頁算出來的 `out`。 */
export async function computeAll(file) {
  const m = await modules();
  const out = {};
  for (const [name, cases] of Object.entries(file.sections)) {
    out[name] = [];
    for (const c of cases) {
      const args = name === 'writes' ? c.in : revive(c.in, m.firestore.FakeTs);
      const got = name === 'writes' ? await runWrites(m, args) : await SECTIONS[name](m, args);
      out[name].push(plain(got, m.firestore));
    }
  }
  return out;
}

export const readParity = () => JSON.parse(readFileSync(PARITY_FILE, 'utf8'));

/** 短的值寫在一行裡（一個值一行的話這份檔案有七千行）。 */
function pretty(v, indent) {
  const flat = JSON.stringify(v);
  if (flat === undefined || flat.length + indent.length <= 120 || v === null || typeof v !== 'object') return flat;
  const inner = `${indent}  `;
  if (Array.isArray(v)) return `[\n${v.map((x) => inner + pretty(x, inner)).join(',\n')}\n${indent}]`;
  const entries = Object.entries(v).filter(([, x]) => x !== undefined);
  return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner)}`).join(',\n')}\n${indent}}`;
}

/** 寫回檔案：看不見的空白寫成 `\uXXXX`（檔案裡看得出來是哪一種），中文照原樣。 */
export function writeParity(file) {
  const text = `${pretty(file, '')}\n`
    .replace(/[\u0080-\u00A0\u1680\u2000-\u200F\u2028\u2029\u202F\u205F\u3000\uFEFF]/g,
      (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  writeFileSync(PARITY_FILE, text, { encoding: 'utf8' });
}
