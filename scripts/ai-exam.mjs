#!/usr/bin/env node
// 拍照辨識的考試（issue 04，ADR-0100、0101）。**用真資料**（她：「不用假資料考試，就直接拿真資料考試」）。
//
//   node scripts/ai-exam.mjs --thinking low
//   node scripts/ai-exam.mjs --thinking medium --only orderForm
//
// - 照片：`.local/references/images/`；答案：`.local/references/ai-exam/answers.json`（人訂的，不是模型的輸出）
// - 縮圖跟 app 一樣：長邊 2000px、JPEG 0.85、照 EXIF 轉正（`ui/components/camera.js`）
// - **直接叫 Agent Platform，不經過 Function**：考試不該被上限擋住，也不該算進她的用量頁。
//   用本機 `gcloud auth application-default login` 那一份授權（她本人）
// - 格式、提示詞、回來之後的重組都 import `functions/` 那一份 —— 考的就是上線的那一套
// - 結果（含辨識出來的字，**有真名**）寫進 `.local/references/ai-exam/result-日期-thinking.json`
// - **終端機只印數字**：這裡的輸出會進對話紀錄
//
// 這支檔案一個真名、病歷號都沒有。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { makeGeminiModel } from '../functions/lib/geminiModel.js';
import { parseJson } from '../functions/lib/extract.js';
import { estimateUsd, MAX_OUTPUT_TOKENS } from '../functions/lib/pricing.js';
import { promptFor, sanitize, schemaFor } from '../functions/transcripts/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IMAGES = `${ROOT}.local/references/images/`;
const EXAM = `${ROOT}.local/references/ai-exam/`;

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const THINKING = arg('--thinking', 'low').toUpperCase();
const ONLY = arg('--only', '').split(',').filter(Boolean);
const PROJECT = arg('--project', 'wellness-clinic-staging');
// 一次一張：同時送三張時四成被 429 擋下（2026-09-17 第一次考試），app 那一側也是一張一張送
const CONCURRENCY = Number(arg('--concurrency', '1'));

// ---------- 比對用的正規化（跟 domain 讀的方式同一個方向：字不一樣、值一樣就算對） ----------

const CN_DIGIT = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, '—': 1, '－': 1, '-': 1 };

/** 「1」「一」「—」→ 1；「×15」→ 15。讀不出來回 null。 */
export function readQuantity(text) {
  const s = String(text ?? '').replace(/\s/g, '');
  if (!s) return null;
  if (CN_DIGIT[s] != null) return CN_DIGIT[s];
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** 「8萬」「80000,-」「12.9万」「3W」→ 元。空白回 0（尚欠尾款沒寫就是沒欠）。 */
export function readAmount(text) {
  const s = String(text ?? '').replace(/[\s,，.\-－]+$/g, '').replace(/[,，\s]/g, '');
  if (!s) return 0;
  const wan = s.match(/^(\d+(?:\.\d+)?)[萬万wW]/);
  if (wan) return Math.round(Number(wan[1]) * 10000);
  const n = s.match(/^(\d+(?:\.\d+)?)/);
  return n ? Math.round(Number(n[1])) : null;
}

/** 日期只比月／日（答案沒帶年；年份怎麼補是 14 的事）。「115/6/8」「06/08」→ 6/8。 */
export function readMonthDay(text) {
  const parts = String(text ?? '').match(/\d+/g);
  if (!parts || parts.length < 2) return null;
  const [m, d] = parts.slice(-2).map(Number);
  return `${m}/${d}`;
}

const squash = (s) => String(s ?? '').replace(/[\s・‧·、，,()（）:：\-－]/g, '');
const digitsOnly = (s) => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '');

/** 器材簡寫 → 同一個代號（療程單上 IN／Indiba、超磁場／SIS、高能／高能量雷射、ILIB／靜脈雷射）。 */
function equipmentTokens(text) {
  const s = String(text ?? '').toLowerCase();
  const out = new Set();
  if (/indiba|\bin\b|^in$|in(?=\+|$)/.test(s)) out.add('indiba');
  if (/sis|超磁/.test(s)) out.add('sis');
  if (/高能/.test(s)) out.add('hil');
  if (/ilib|靜脈/.test(s)) out.add('ilib');
  return out;
}

// ---------- 計分 ----------

function tally() {
  const t = new Map();
  return {
    add(field, ok) {
      const cur = t.get(field) ?? { ok: 0, total: 0 };
      cur.total += 1;
      if (ok) cur.ok += 1;
      t.set(field, cur);
    },
    rows: () => [...t.entries()],
  };
}

function scoreOrderForm(ans, got, s) {
  if (ans.customerName) s.add('姓名', squash(got.customerName) === squash(ans.customerName));
  if (Array.isArray(ans.checkupTicked)) {
    const norm = (xs) => [...new Set((xs ?? []).map((x) => readAmount(x)))].sort().join(',');
    s.add('功醫健檢勾選', norm(got.checkupTicked) === norm(ans.checkupTicked));
  }
  if (Array.isArray(ans.packages)) {
    for (const p of ans.packages) {
      const hit = (got.packages ?? []).find((g) => squash(g.printedName).includes(p.key));
      s.add('套組數量', hit ? readQuantity(hit.quantity) === Number(p.quantity) : false);
    }
    // 答案說沒有的，抄出來也不該有
    s.add('套組沒有多抄', (got.packages ?? []).length === ans.packages.length);
  }
  if (Array.isArray(ans.handwrittenRows)) {
    for (const r of ans.handwrittenRows) {
      const hit = (got.handwrittenRows ?? []).find((g) => squash(g.text).toUpperCase().includes(r.key.toUpperCase()));
      const qty = hit ? (readQuantity(hit.quantity) ?? readQuantity(String(hit.text).match(/[x×X]\s*(\d+)/)?.[1])) : null;
      s.add('手寫列辨認', Boolean(hit));
      s.add('手寫數量', qty === Number(r.quantity));
    }
  }
  if (ans.unpaid !== null && ans.unpaid !== undefined) {
    s.add('尚欠尾款', readAmount(got.unpaid) === readAmount(ans.unpaid));
  }
  if (ans.obNoteHas) s.add('OB備註', String(got.obNote ?? '').includes(ans.obNoteHas));
  if (ans.stickyNotes) s.add('便利貼', (got.stickyNotes ?? []).length >= ans.stickyNotes);
}

function scoreTreatmentSheet(ans, got, s) {
  s.add('姓名', squash(got.customerName) === squash(ans.customerName));
  s.add('客戶編號', digitsOnly(got.customerNumber) === digitsOnly(ans.customerNumber));
  const gotRows = (got.rows ?? []).map((r) => ({ ...r, md: readMonthDay(r.date) }));
  const pool = [...gotRows];
  for (const r of ans.rows) {
    const i = pool.findIndex((g) => g.md === r.date);
    s.add('日期', i >= 0);
    if (i < 0) continue;
    const g = pool.splice(i, 1)[0];
    if (r.signed !== undefined) s.add('有沒有簽', g.signed === r.signed);
    if (r.item) {
      const want = equipmentTokens(r.item);
      const have = new Set([...equipmentTokens(g.itemText), ...(g.ticked ?? []).flatMap((x) => [...equipmentTokens(x)])]);
      s.add('勾的器材', [...want].every((x) => have.has(x)) && have.size === want.size);
    }
  }
  s.add('沒有多抄日期', gotRows.length === ans.rows.length);
}

function scoreAbovee(ans, got, s) {
  const cols = got.columns ?? [];
  const rows = got.rows ?? [];
  s.add('列數', rows.length === ans.rows.length);
  const fields = Object.keys(ans.rows[0] ?? {});
  for (const f of fields) s.add(`欄位 ${f} 有抄到`, cols.includes(f));
  ans.rows.forEach((want, i) => {
    const row = rows[i] ?? [];
    for (const f of fields) {
      const j = cols.indexOf(f);
      const v = j >= 0 ? row[j] : undefined;
      const norm = f === '病歷號' ? (x) => String(x ?? '').trim() : (x) => squash(x);
      s.add(f, norm(v) === norm(want[f]));
    }
  });
  if (ans.pageText) s.add('頁數', squash(got.pageText) === squash(ans.pageText));
}

function scorePlanFlyer(ans, got, s) {
  s.add('方案名', squash(got.title).includes(ans.title));
  s.add('會籍', squash(got.membershipText).includes(squash(ans.membershipText)));
  for (const it of ans.items) {
    const hit = (got.items ?? []).find((g) => squash(g.text).includes(it.key));
    s.add('項目次數', hit ? readQuantity(hit.quantityText) === Number(it.quantityText) : false);
  }
  s.add('項目數', (got.items ?? []).length === ans.items.length);
}

const SCORERS = {
  orderForm: scoreOrderForm, treatmentSheet: scoreTreatmentSheet, aboveeList: scoreAbovee, planFlyer: scorePlanFlyer,
};

// ---------- 跑 ----------

async function shrink(file) {
  const { default: sharp } = await import('sharp');
  return sharp(`${IMAGES}${file}`, { limitInputPixels: false })
    .rotate()
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

async function main() {
  const { items } = JSON.parse(readFileSync(`${EXAM}answers.json`, 'utf8'));
  const todo = items.filter((it) => !ONLY.length || ONLY.includes(it.kind));
  const model = makeGeminiModel({ project: PROJECT, thinkingLevel: THINKING });

  console.log(`考 ${todo.length} 張，thinking ${THINKING}`);
  const started = Date.now();

  const results = await pool(todo, CONCURRENCY, async (it, i) => {
    const jpeg = await shrink(it.file);
    const t0 = Date.now();
    try {
      const out = await model.generate({
        image: jpeg.toString('base64'), schema: schemaFor(it.kind), prompt: promptFor(it.kind), maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
      const parsed = parseJson(out.text);
      process.stdout.write(`  ${i + 1}/${todo.length}\r`);
      return {
        file: it.file, kind: it.kind, ms: Date.now() - t0, bytes: jpeg.length, usage: out.usage,
        transcript: parsed ? sanitize(it.kind, parsed) : null,
      };
    } catch (e) {
      return { file: it.file, kind: it.kind, ms: Date.now() - t0, error: e?.status ?? e?.name ?? 'error' };
    }
  });

  const byKind = new Map();
  let usd = 0;
  let failed = 0;
  for (const r of results) {
    const ans = todo.find((it) => it.file === r.file);
    if (!byKind.has(r.kind)) byKind.set(r.kind, tally());
    const s = byKind.get(r.kind);
    if (r.usage) usd += estimateUsd(r.usage);
    s.add('辨識成功（readable）', Boolean(r.transcript?.readable));
    if (!r.transcript) { failed += 1; continue; }
    SCORERS[r.kind](ans.answer, r.transcript, s);
  }

  console.log(`\n用了 ${((Date.now() - started) / 1000).toFixed(0)} 秒；失敗 ${failed} 張；估計 US$${usd.toFixed(3)}（照 2027 價格）`);
  const ms = results.filter((r) => r.ms).map((r) => r.ms).sort((a, b) => a - b);
  console.log(`每張秒數：中位數 ${(ms[Math.floor(ms.length / 2)] / 1000).toFixed(1)}、最慢 ${(ms.at(-1) / 1000).toFixed(1)}`);
  const summary = {};
  for (const [kind, s] of byKind) {
    console.log(`\n[${kind}]`);
    summary[kind] = {};
    for (const [field, { ok, total }] of s.rows()) {
      const pct = total ? Math.round((ok / total) * 100) : 0;
      summary[kind][field] = { ok, total, pct };
      console.log(`  ${field.padEnd(14, '　')} ${String(ok).padStart(3)}/${String(total).padEnd(3)} ${String(pct).padStart(3)}%${pct < 90 ? '  ← 低於 90%' : ''}`);
    }
  }

  mkdirSync(EXAM, { recursive: true });
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  const out = `${EXAM}result-${day}-${THINKING.toLowerCase()}${ONLY.length ? `-${ONLY.join('+')}` : ''}.json`;
  writeFileSync(out, JSON.stringify({ day, thinking: THINKING, usd, summary, results }, null, 2));
  console.log(`\n結果寫在 .local/references/ai-exam/（有真名，不進版控）`);
}

main().catch((e) => {
  console.error('考試跑不起來：', e?.message?.slice(0, 200));
  process.exit(1);
});
