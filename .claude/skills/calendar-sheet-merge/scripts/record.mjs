// 她在決定頁上的回報 → 決定檔。**由程式寫，不由模型翻。**
//
// 她 2026-09-28：「用程式完成這件事而不是用語言模型紀錄，讓每次結果都可以穩定」。
// 以前是模型讀回報、一條一條手寫進 `merge-decisions.json` —— 同一份回報交給兩個 session，
// 寫出來的決定檔不保證一樣，而且沒有一條記著是哪一題來的。
//
// 決定頁（`board.mjs`）的每一個選項本身帶著「選了它要寫進哪幾條」（`ops`），回報原封不動帶過來，
// 這一支只做兩件事：
//
// 1. 把那幾條寫進決定檔對應的地方（`customers[分頁].slots` 那一類、整份的 `events`）
// 2. 把她的答案記在 `answers[鑰匙]`：選了什麼、備註、保留沒、哪一天、哪一份頁面、題目的樣子、
//    **這一次實際寫了哪幾條**（`applied`）
//
// 第 2 點的 `applied` 是「改主意」靠的東西：同一把鑰匙再來一次，先把上一次寫的那幾條退回去
// （加的拿掉、拿掉的放回去）再寫新的。所以同一份回報套兩次一模一樣，先選 A 再選 B 只剩 B。
// 原本就在決定檔裡、沒有鑰匙的舊決定一個字都不動 —— 除非她選的那一項明寫要拿掉它（⓪d）。
//
// 「其他（寫在備註）」那一種程式翻不了：什麼都不寫、記成 `needsTranslation`，不算答完。
// 要拿掉的那一條找不到（她改過決定檔、或那一條本來就長得不一樣）也不算答完：記成 `unmatched`、印出來 ——
// 安靜地記成「決定了」的話，舊的那一條一直留在檔裡，而決定頁以為處理好了。
//
// 用法：node record.mjs --decisions <決定檔> --answers <回報.json> [--at 2026-09-28]
//       寫回決定檔（原本那一份留一個 .bak），印出套了幾項、保留幾項、還有幾項待翻譯。

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 決定檔裡的一條，不看 `_` 開頭的欄位（`_why` 是給人看的）與 `q` */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).filter((key) => !key.startsWith('_') && key !== 'q').sort()
      .map((key) => [key, canon(v[key])]));
  }
  return v;
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** 客戶那一層寫得進去的幾格（`notes.drop`／`notes.add` 在 `notes` 底下）。決定頁產的 ops 只會用到這幾種 ＋ 整份的 `events` */
export const CUSTOMER_SECTIONS = ['slots', 'skipEvents', 'dropProblems', 'entitlements'];
const NOTE_SECTIONS = { 'notes.drop': 'drop', 'notes.add': 'add' };

/** ops 指到的那一個陣列（沒有就開一個） */
function listOf(d, op) {
  if (op.section === 'events') {
    d.events ??= [];
    return d.events;
  }
  if (!op.sheet) throw new Error(`「${op.section}」要有分頁名`);
  d.customers ??= {};
  const c = (d.customers[op.sheet] ??= {});
  if (NOTE_SECTIONS[op.section]) {
    c.notes ??= {};
    return (c.notes[NOTE_SECTIONS[op.section]] ??= []);
  }
  if (!CUSTOMER_SECTIONS.includes(op.section)) {
    throw new Error(`不認得的地方：${op.section}`);
  }
  return (c[op.section] ??= []);
}

const addTo = (list, value) => { if (!list.some((x) => same(x, value))) list.push(structuredClone(value)); };
function takeFrom(list, value) {
  const i = list.findIndex((x) => same(x, value));
  if (i < 0) return null;
  return list.splice(i, 1)[0];
}

/**
 * 照 ops 寫。回傳實際做了什麼（拿掉的那一條存原本的樣子，退回時放得回去）與找不到、沒拿掉的那幾條
 */
function applyOps(d, ops) {
  const done = [];
  const unmatched = [];
  for (const op of ops ?? []) {
    const list = listOf(d, op);
    if (op.add !== undefined) {
      const had = list.some((x) => same(x, op.add));
      addTo(list, op.add);
      if (!had) done.push({ sheet: op.sheet, section: op.section, add: op.add });
    }
    if (op.remove !== undefined) {
      const gone = takeFrom(list, op.remove);
      if (gone !== null) done.push({ sheet: op.sheet, section: op.section, remove: gone });
      else unmatched.push(op);
    }
  }
  return { done, unmatched };
}

/** 上一次寫的退回去：加的拿掉、拿掉的放回去 */
function undo(d, applied) {
  for (const op of [...(applied ?? [])].reverse()) {
    const list = listOf(d, op);
    if (op.add !== undefined) takeFrom(list, op.add);
    if (op.remove !== undefined) addTo(list, op.remove);
  }
}

/**
 * @param {object} decisions 決定檔（不會被改到，回傳新的一份）
 * @param {{ form?: string, exportedAt?: string, answers: object[] }} report 決定頁「複製回報」的內容
 * @param {{ at?: string }} [o] 記在答案上的日期（預設用回報匯出那一天）
 */
export function applyAnswers(decisions, report, { at = null } = {}) {
  const d = structuredClone(decisions ?? {});
  d.answers ??= {};
  const summary = { applied: 0, held: 0, translate: [], unmatched: [] };
  const when = at ?? (report?.exportedAt ? String(report.exportedAt).slice(0, 10) : null);

  for (const a of report?.answers ?? []) {
    if (!a?.key) continue;
    const prev = d.answers[a.key];
    const free = Boolean(a.free) || (!Array.isArray(a.ops) && a.choice != null);
    if (prev?.applied) undo(d, prev.applied);
    const { done: applied, unmatched } = free ? { done: [], unmatched: [] } : applyOps(d, a.ops);
    d.answers[a.key] = {
      choice: a.choice ?? null,
      label: a.label ?? null,
      note: a.note?.trim() || null,
      hold: Boolean(a.hold),
      ...(free ? { needsTranslation: true } : {}),
      ...(unmatched.length ? { unmatched } : {}),
      at: when,
      form: report?.form ?? null,
      snapshot: a.snapshot ?? prev?.snapshot ?? null,
      applied,
    };
    if (unmatched.length) summary.unmatched.push({ ...a, unmatched });
    if (free) summary.translate.push(a);
    else if (a.hold) summary.held += 1;
    else summary.applied += 1;
  }
  // 空的容器收掉 —— 改主意之後留下一堆 `skipEvents: []` 讀起來像有東西
  for (const c of Object.values(d.customers ?? {})) {
    for (const key of CUSTOMER_SECTIONS) if (Array.isArray(c[key]) && !c[key].length) delete c[key];
    if (c.notes) {
      for (const key of ['drop', 'add']) if (Array.isArray(c.notes[key]) && !c.notes[key].length) delete c.notes[key];
      if (!Object.keys(c.notes).length) delete c.notes;
    }
  }
  return { decisions: d, summary };
}

// ---------- CLI ----------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
  const file = arg('decisions');
  const answersFile = arg('answers');
  if (!file || !answersFile) {
    console.error('用法：node record.mjs --decisions <決定檔> --answers <回報.json> [--at 2026-09-28]');
    process.exit(1);
  }
  const before = JSON.parse(readFileSync(file, 'utf8'));
  const report = JSON.parse(readFileSync(answersFile, 'utf8'));
  const { decisions, summary } = applyAnswers(before, report, { at: arg('at') });
  copyFileSync(file, `${file}.bak`);
  writeFileSync(file, `${JSON.stringify(decisions, null, 1)}\n`);
  console.log(`這一份：套用 ${summary.applied} 項、保留 ${summary.held} 項（照她的答案先寫進去了）、待翻譯 ${summary.translate.length} 項`);
  for (const a of summary.translate) console.log(`  待翻譯｜${a.key}｜${a.label ?? ''}｜${a.note ?? ''}`);
  for (const a of summary.unmatched) console.log(`  ⚠ 要拿掉的那一條找不到（沒有拿掉）｜${a.key}｜${JSON.stringify(a.unmatched.map((o) => o.remove))}`);
  // 整份決定檔還有幾條等著翻 —— 只數這一份回報的話，上一次沒翻完的會被忘掉
  const pending = Object.entries(decisions.answers ?? {}).filter(([, x]) => x.needsTranslation || x.unmatched?.length);
  console.log(`整份決定檔：還有 ${pending.length} 條待翻譯或沒拿掉${pending.length ? `（${pending.map(([key]) => key).join('、')}）` : ''}`);
}
