// 舊試算表 × TimeTree 行事曆：對帳與合併。
//
// 這一支的工作是把兩份紀錄擺在一起，指出「哪些對得上、哪些對不上」，
// 並算出合併之後的完整來訪（補時間、診間、器材）。**它不寫入任何東西。**
//
// 為什麼要有它：她之前靠腦袋記，行事曆記了、試算表忘了記的情況真的發生過，
// 而那種漏勾在試算表上完全看不出來 —— 兩邊都只有自己那一半。
//
// 判斷的核心是三方對照，不是「看得懂行事曆的文字」：
// 一筆事件要被採用，必須那一天試算表有勾、名字對得上這位客戶、療程也對得上。
// 三邊都同意才填，對不上的一律列出來讓她判斷（ADR-0002：app 是記錄者不是判斷者）。
//
// 用法：
//   node merge.mjs --sheets <tsv 資料夾> --ics <檔案> [--year 2026]
//                  [--aliases <aliases.json>] [--out <資料夾>]

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..');
const { parseSheet, planForSheet } = await import(join(REPO, 'public/js/domain/legacyImport.js'));
const { SEED } = await import(join(REPO, 'public/js/domain/seed.js'));

// ---------- 速記語法 ----------
//
// 全部集中在這裡，因為這是「她怎麼寫字」而不是「規則是什麼」——
// 看到新的寫法時改這裡就好。細節與例子見 references/shorthand.md。

/** 同一個字的不同寫法。左邊是正規形，右邊會被換成左邊。 */
export const VARIANTS = [['啟', '啓'], ['惠', '慧'], ['崴', '威'], ['喩', '喻'], ['珮', '佩']];

/** 簡寫 → [課程, 器材]。由上到下比，一句話可以命中好幾個。 */
export const TOKENS = [
  [/ILIB|IL(?![A-Za-z])|靜脈/i, '靜脈', null],
  [/INDIBA|IN(?![A-Za-z])/i, '復能', 'INDIBA'],
  [/SIS|超磁/i, '復能', '超磁場'],
  [/高\s*能|高\s*60|雷射/i, '復能', '高能量雷射'],
  [/復能|賦能/, '復能', null],
  [/EECP/i, 'EECP', null],
  [/二返|2返|功能醫學/, '二返', null],
  [/健檢/, '健檢', null],
  [/復健科|復健門診|復健/, '復健科醫師門診', null],
  [/心臟評估|心臟門診|心超|HRV|ABI/, '心臟科評估', null],
  [/點滴|雪顏|護肝|腸道|排毒|亮彩|猛健樂|速利清|護心|NAC/, '營養點滴', null],
  [/營養諮詢|營養師/, '營養師諮詢', null],
  [/物理諮詢|物理治療師/, '物理治療師諮詢', null],
  [/Inbody|體脂|體組成/i, '身體組成分析', null],
  [/體適能/, '體適能檢查分析', null],
];

/** 舊表的療程列名稱 ↔ 行事曆簡寫算不算同一件事 */
const SAME = (course, want) => course === want
  || (course === '復能' && /復能|賦能/.test(want))
  || (course === '健檢' && want.includes('健檢'))
  || (course === '二返' && /二返|功能醫學/.test(want))
  || (course === '靜脈' && /靜脈|ILIB/.test(want));

export const normVariant = (s) => VARIANTS.reduce((acc, [a, b]) => acc.split(b).join(a), String(s ?? ''));

export function coursesOf(summary) {
  const s = normVariant(summary);
  return TOKENS.filter(([re]) => re.test(s)).map(([, course, equip]) => ({ course, equip }));
}

/**
 * 她在標題最前面自己寫的時間。**這個比行事曆的時間欄準** ——
 * 標題是她打的字（原文），時間欄是她點下去的那一格，會歪（量到過 3:45 存成 18:00）。
 *
 * 院內作業時間 8:00–20:00，所以小於 8 一律是下午：`2.30` = 14:30。
 * `1~3.`、`11.～12.30` 這種區間取起點，長度另外回傳 —— 兩小時的區間
 * 很可能是連著做的兩個時段（真的發生過：兩次復能寫成 `1~3.`）。
 */
export function timeInSummary(summary) {
  const s = String(summary).replace(/[（(][^）)]*[）)]/g, ' ');
  const re = /(\d{1,2})\s*[.：:]?\s*(\d{2})?\s*(?:[~～\-–]\s*(\d{1,2})\s*[.：:]?\s*(\d{2})?)?/;
  const m = re.exec(s.replace(/^[^\d]*/, ''));
  if (!m) return null;
  const to24 = (h, mi) => {
    let hh = Number(h);
    if (!Number.isInteger(hh) || hh > 23) return null;
    if (hh < 8) hh += 12;
    const mm = mi ? Number(mi) : 0;
    return mm > 59 ? null : hh * 60 + mm;
  };
  const start = to24(m[1], m[2]);
  if (start == null) return null;
  const end = m[3] ? to24(m[3], m[4]) : null;
  const hhmm = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  return { start: hhmm(start), spanMin: end && end > start ? end - start : null };
}

/**
 * 把一句標題裡「認得出來的東西」全部拿掉之後，還剩下什麼中文字。
 *
 * 用來判斷一筆沒寫名字的事件安不安全：`9：30復能`、`10.IL治2` 剩下空的，
 * 那真的只是她懶得寫名字；`12：30蘇ILIB`、`2：30秀鑾IL治2` 剩下「蘇」「秀鑾」，
 * 那是**別人**的療程 —— 把它補到這位客戶身上，等於憑空給她一次沒發生過的來訪。
 * 這種錯在畫面上看不出來，所以寧可漏補也不要補錯。
 *
 * 認得的治療師名字要一起扣掉，否則 `9.30 IN 姿璇` 會被當成寫了人名。
 */
export function residualNames(summary, therapists = []) {
  let s = normVariant(summary);
  for (const [re] of TOKENS) s = s.replace(new RegExp(re.source, `g${re.flags.replace('g', '')}`), ' ');
  for (const t of therapists) s = s.split(t).join(' ');
  return s
    .replace(/治\s*\d+|點滴\s*\d+|床\s*[A-Za-z]/g, ' ')
    .replace(/[^\u4e00-\u9fff]/g, '')
    .trim();
}

/**
 * 這句話裡提到的治療師。名單從主檔（config/staff）來，不從文字猜 ——
 * 括號裡也可能是別的東西（`（要生日`、`（療程單`），猜錯會把一句備註掛成治療師。
 * 行事曆上的寫法與主檔不一定一樣（騰威／騰崴、新穎／欣穎），所以先過 normVariant，
 * 再讓對照表補剩下的。
 */
export function therapistOf(summary, staff = []) {
  const s = normVariant(summary);
  for (const t of staff) {
    const norm = normVariant(t.name);
    if (s.includes(norm) || (t.aka ?? []).some((a) => s.includes(normVariant(a)))) return t.name;
  }
  return null;
}

/** 營養點滴當天用的品項。她寫簡寫（雪顏、護肝、腸道），主檔是全名。 */
export function ivProductOf(summary, products = []) {
  const s = normVariant(summary);
  for (const p of products) {
    const name = normVariant(p.name);
    for (let n = 2; n <= name.length; n += 1) {
      if (s.includes(name.slice(0, n))) return p.name;
    }
  }
  return null;
}

/** `治3` = 治療室3；`IL.9`、`IL 9` = 點滴9（使用者確認過：IL 後面的數字是點滴室）。 */
export function roomOf(summary) {
  const s = String(summary).replace(/\s+/g, '');
  const t = /治(\d+)/.exec(s);
  if (t) return `治${t[1]}`;
  const il = /(?:ILIB|IL)[.．]?(\d+)/i.exec(s);
  return il ? `點滴${il[1]}` : null;
}

// ---------- 名字 ----------

/**
 * 這位客戶在行事曆上可能被叫成什麼。
 *
 * 她寫的是給自己看的字：只寫姓、只寫名、寫暱稱（老爸／Dad）、打錯字（惠↔慧）、
 * 用異體字（啟↔啓）都很常見。全名對不到就掉一整筆來訪，所以這裡放寬，
 * 但**放寬的代價由「療程也要對得上」那一關擋住**，不是無限制地猜。
 *
 * 暱稱沒辦法從名字推出來，只能靠對照表。對照表裡是真名，**永遠不進版控**。
 */
export function nameForms(raw, aliases = {}) {
  const clean = normVariant(String(raw).replace(/\\n/g, ' ').replace(/\d+/g, ' '));
  const forms = new Set();
  const main = clean.replace(/[(（][^)）]*[)）]/g, '').trim();
  if (main) {
    forms.add(main);
    if (main.length >= 3) forms.add(main.slice(1)); // 去姓：陳何淑子 → 何淑子
  }
  // A2 有時候把配偶或家屬的名字寫在括號裡，那個人也會出現在行事曆上
  for (const m of clean.matchAll(/[(（]([^)）]*)[)）]/g)) {
    const inner = m[1].trim();
    if (/^[一-鿿]{2,4}$/.test(inner)) {
      forms.add(inner);
      if (inner.length >= 3) forms.add(inner.slice(1));
    }
  }
  for (const [who, list] of Object.entries(aliases)) {
    if (main.includes(who) || who.includes(main)) for (const a of list) forms.add(normVariant(a));
  }
  return [...forms].filter(Boolean);
}

/** 事件文字裡出現了這個名字最長的幾個連續字 */
export function nameHit(summary, name) {
  let best = 0;
  for (let i = 0; i < name.length; i += 1) {
    for (let j = i + 1; j <= name.length; j += 1) {
      const piece = name.slice(i, j);
      if (piece.length > best && summary.includes(piece)) best = piece.length;
    }
  }
  return best;
}

// ---------- 行事曆 ----------

export function parseIcs(text) {
  const raw = String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const out = [];
  for (const block of raw.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const d = {};
    for (const line of body.split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) d[line.slice(0, i).split(';')[0]] = line.slice(i + 1).trim();
    }
    const m = /^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?/.exec(d.DTSTART ?? '');
    if (!m) continue;
    out.push({
      uid: d.UID ?? `${d.DTSTART}-${d.SUMMARY}`,
      date: `${m[1]}-${m[2]}-${m[3]}`,
      clock: m[4] ? `${m[4]}:${m[5]}` : null, // 行事曆時間欄，只當佐證
      summary: d.SUMMARY ?? '',
      color: d.COLOR ?? '',
      repeats: Boolean(d.RRULE),
    });
  }
  return out;
}

// ---------- 配對 ----------

const DEFAULT_SLOT_MIN = 60;

/**
 * 一位客戶的一天：試算表勾了哪些時段、行事曆上有哪些事件，怎麼配。
 *
 * 回傳每個時段配到什麼（`high` 三方同意／`low` 要她確認／`null` 配不到），
 * 以及這一天剩下沒用到的線索。
 */
export function matchDay(visit, forms, dayEvents, othersForms = [], therapists = [], master = {}) {
  const surnames = [...new Set(forms.filter((f) => f.length >= 2).map((f) => f[0]))];

  const scored = dayEvents.map((e) => {
    const norm = normVariant(e.summary);
    const courses = coursesOf(e.summary);
    let hit = Math.max(0, ...forms.map((f) => nameHit(norm, f)));
    // 只寫一個姓（`3.15陳IL.7`）只有在她也寫了療程的時候才算數
    if (hit < 2 && courses.length && surnames.some((c) => norm.includes(c))) hit = 1;
    return { e, hit, courses, time: timeInSummary(e.summary) };
  });

  const mine = scored.filter((x) => x.hit > 0).sort((a, b) => b.hit - a.hit);
  // 「沒寫是誰」必須是**真的沒寫**：一筆寫著別位客戶名字的事件，從這位客戶的角度
  // 看起來也是「沒提到我」，拿來補她的時段就會把別人的療程掛到她頭上（真的發生過）。
  // 另外要求標題裡有寫時間 —— 沒有時間的多半是待辦（`記復能行事曆`），不是來訪。
  const nameless = scored.filter((x) => x.hit === 0 && x.courses.length && x.time
    && !othersForms.some((f) => f.length >= 2 && normVariant(x.e.summary).includes(f))
    && !residualNames(x.e.summary, therapists));

  // 一筆事件通常是一個時段，但兩小時的區間是連著做的兩個（`1~3.` = 兩次復能）
  const pool = [];
  for (const c of mine) {
    const times = c.time?.spanMin && c.time.spanMin >= DEFAULT_SLOT_MIN * 2
      ? Array.from({ length: Math.floor(c.time.spanMin / DEFAULT_SLOT_MIN) },
        (_, i) => addMin(c.time.start, i * DEFAULT_SLOT_MIN))
      : [c.time?.start ?? c.e.clock];
    times.forEach((t, i) => pool.push({ ...c, start: t, part: times.length > 1 ? i + 1 : 0, of: times.length }));
  }

  const used = new Set();
  const filled = visit.slots.map((slot) => {
    const hit = pool.find((c) => !used.has(c) && c.courses.some((x) => SAME(x.course, slot.courseName)));
    if (!hit) return { slot, match: null };
    used.add(hit);
    return {
      slot,
      match: {
        confidence: 'high',
        startsAt: hit.start,
        room: roomOf(hit.e.summary),
        equipmentName: hit.courses.find((x) => SAME(x.course, slot.courseName))?.equip ?? null,
        therapistName: therapistOf(hit.e.summary, master.staff ?? []),
        ivProductName: /點滴/.test(slot.courseName) ? ivProductOf(hit.e.summary, master.ivProducts ?? []) : null,
        evidence: hit.e.summary,
        clock: hit.e.clock,
        part: hit.part ? `${hit.part}/${hit.of}` : null,
      },
    };
  });

  // 沒配到的時段，還有兩種救法，兩種都標成要她確認：
  const openSlots = filled.filter((x) => !x.match);
  const spare = pool.filter((c) => !used.has(c));

  // (1) 她只寫了名字沒寫療程（`8.15胡玉嬌13`），而那天就剩這一筆對得上她
  const blank = spare.filter((c) => !c.courses.length && c.hit >= 2);
  if (openSlots.length === 1 && blank.length === 1) {
    openSlots[0].match = {
      confidence: 'low', startsAt: blank[0].start, room: roomOf(blank[0].e.summary),
      equipmentName: null, evidence: blank[0].e.summary, clock: blank[0].e.clock,
      why: '事件上沒寫是什麼療程，那天只有這一筆對得上她',
    };
  }

  // (2) 她只寫了療程沒寫名字（`9：30復能`、`10.IL治2`）
  for (const open of filled.filter((x) => !x.match)) {
    const hit = nameless.find((c) => c.courses.some((x) => SAME(x.course, open.slot.courseName)));
    if (!hit) continue;
    nameless.splice(nameless.indexOf(hit), 1);
    open.match = {
      confidence: 'low', startsAt: hit.time?.start ?? hit.e.clock, room: roomOf(hit.e.summary),
      equipmentName: hit.courses.find((x) => SAME(x.course, open.slot.courseName))?.equip ?? null,
      evidence: hit.e.summary, clock: hit.e.clock,
      why: '事件上沒寫是誰，但那天只有她勾了這個療程',
    };
  }

  // 兩邊講的不是同一件事：試算表那天還有時段沒配到，而行事曆那天有一筆
  // **名字明確對得上**（不是只沾到一個姓）的事件也沒被用掉。
  // 只有這兩件事同時成立才值得她看 —— 少了任何一邊都只是「那天她還做了別的」。
  const stillOpen = filled.filter((x) => !x.match).length;
  const conflicts = stillOpen
    ? spare.filter((c) => c.hit >= 2 && c.courses.length)
    : [];

  return { filled, conflicts, named: mine.filter((x) => x.hit >= 2).length, usedUids: new Set(filled.filter((f) => f.match).map((f) => f.match.evidence)) };
}

const addMin = (hhmm, min) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + min;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

// ---------- 整批 ----------

export function reconcile({ sheetsDir, icsPath, year, aliases = {}, therapists = [], doctors = [], noise = [], today = null }) {
  const ctx = {
    courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts,
    plans: SEED.plans, existingCustomers: [], year, importedAt: null,
  };
  const plans = readdirSync(sheetsDir)
    .filter((f) => f.endsWith('.tsv') && !f.includes('模板'))
    .sort((a, b) => a.localeCompare(b, 'zh-TW'))
    .map((f) => planForSheet(
      parseSheet(readFileSync(join(sheetsDir, f), 'utf8'), { sheetName: f.replace(/\.tsv$/, '') }), ctx,
    ));

  const events = parseIcs(readFileSync(icsPath, 'utf8'));
  const byDate = new Map();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const span = events.length
    ? [events.reduce((a, e) => (e.date < a ? e.date : a), events[0].date),
      events.reduce((a, e) => (e.date > a ? e.date : a), events[0].date)]
    : [null, null];

  // 主檔的治療師名單 ＋ 對照表補的別名。認得這些字，`residualNames()` 才不會把
  // 「9.30 IN 姿璇」判成「寫了別人的名字」而放棄那一筆。
  const staff = [
    ...SEED.staff.map((x) => ({ name: x.name, aka: [] })),
    ...therapists.filter((t) => !SEED.staff.some((x) => normVariant(x.name) === normVariant(t)))
      .map((t) => ({ name: t, aka: [] })),
  ];
  const therapistWords = [...staff.map((x) => x.name), ...therapists, ...(doctors ?? []), ...(noise ?? [])];

  const usedSummaries = new Set();
  const customers = [];
  for (const p of plans) {
    if (p.skip) { customers.push({ ...p, days: [], forms: [] }); continue; }
    const forms = nameForms(p.customerName, aliases);
    const others = plans.filter((q) => q !== p && !q.skip)
      .flatMap((q) => nameForms(q.customerName, aliases));
    const days = p.visits.map((v) => {
      const r = matchDay(v, forms, byDate.get(v.date) ?? [], others, therapistWords, { staff, ivProducts: SEED.ivProducts });
      for (const s of r.usedUids) usedSummaries.add(`${v.date}|${s}`);
      return { date: v.date, ...r };
    });
    customers.push({ ...p, forms, days });
  }

  // 沒寫名字的事件是靠「那天只有她勾了這個療程」推出來的，而那個判斷是一位一位做的 ——
  // 兩位客戶那天都勾了靜脈時，同一筆 `10.IL治2` 會被補給兩個人。兩個都留等於憑空多一次
  // 來訪，所以兩個都退回，改成列出來讓她指認。
  const claims = new Map();
  for (const c of customers) {
    for (const d of c.days ?? []) {
      for (const f of d.filled) {
        if (f.match?.confidence !== 'low' || !f.match.why?.includes('沒寫是誰')) continue;
        const key = `${d.date}|${f.match.evidence}`;
        claims.set(key, [...(claims.get(key) ?? []), { c, d, f }]);
      }
    }
  }
  const ambiguous = [];
  for (const [key, list] of claims) {
    if (list.length < 2) continue;
    ambiguous.push({
      date: list[0].d.date, evidence: list[0].f.match.evidence,
      who: list.map((x) => x.c.customerName), course: list[0].f.slot.courseName,
    });
    for (const x of list) x.f.match = null;
    usedSummaries.delete(key);
  }

  // 行事曆上沒有被任何一個時段用掉的事件，分三堆
  const leftover = { calendarOnly: [], future: [], personal: [] };
  const known = plans.filter((p) => !p.skip)
    .map((p) => ({ name: p.customerName, forms: nameForms(p.customerName, aliases), dates: new Set(p.visits.map((v) => v.date)) }));
  for (const e of events) {
    if (usedSummaries.has(`${e.date}|${e.summary}`)) continue;
    const norm = normVariant(e.summary);
    const who = known.map((c) => ({ c, hit: Math.max(0, ...c.forms.map((f) => nameHit(norm, f))) }))
      .filter((x) => x.hit >= 2).sort((a, b) => b.hit - a.hit)[0];
    const courses = coursesOf(e.summary);
    if (!who || !courses.length) { leftover.personal.push(e); continue; }
    const row = { event: e, customer: who.c.name, course: courses[0].course, sheetHasThatDay: who.c.dates.has(e.date) };
    if (today && e.date > today) leftover.future.push(row);
    else leftover.calendarOnly.push(row);
  }

  return { plans: customers, events, span, leftover, ambiguous, year };
}

// ---------- 給 app 的合併檔 ----------

/**
 * **名字不是 id** —— id 是她自己在主檔建的，這支腳本看不到她的 Firestore
 * （也不該看得到）。app 那一側拿名字去對自己的主檔，對不到就報出來，不要猜
 * （同一個判準見 `domain/legacyImport.js` 的 `resolveCourse()`）。
 *
 * 每個時段都帶 `confidence` 與 `evidence`：低信心的那幾筆長得跟高信心的一模一樣，
 * 沒有這兩個欄位，她在 app 裡分不出哪幾筆是推測來的。
 *
 * 三份候選清單（未來的預約、行事曆有試算表沒勾、對不到客戶的）**一律 `include: false`**。
 * 那是她說的：全部列出來，她一筆一筆決定。預設匯入等於替她做了決定，
 * 而錯的那幾筆會在日曆上長出她沒有的事。
 */
export function importJson(r, { generatedAt = new Date().toISOString(), calendar = '' } = {}) {
  const courseByName = new Map(SEED.courses.map((c) => [c.name, c]));
  const endOf = (start, courseName) => (start
    ? addMin(start, courseByName.get(courseName)?.durationMin ?? 60)
    : null);
  const timeOf = (e) => timeInSummary(e.summary)?.start ?? e.clock ?? null;

  return {
    format: 'baobao-merge/v1',
    generatedAt,
    year: r.year,
    calendar: { file: calendar, span: r.span, events: r.events.length },
    customers: r.plans.filter((p) => !p.skip).map((p) => ({
      sheetName: p.sheetName,
      name: p.customer?.name ?? p.customerName,
      source: p.customer?.source ?? null,
      notes: p.customer?.notes ?? '',
      entitlements: p.entitlements.map((e) => ({
        key: e.key,
        type: e.doc.type,
        label: e.doc.label,
        totalQty: e.doc.totalQty,
        courseName: SEED.courses.find((c) => c.id === e.doc.courseId)?.name ?? null,
        optionEquipmentNames: (e.doc.optionEquipmentIds ?? [])
          .map((id) => SEED.equipment.find((x) => x.id === id)?.name ?? id),
        productName: e.productName,
      })),
      visits: p.days.map((d) => ({
        date: d.date,
        status: 'done',
        slots: d.filled.map((f) => ({
          entitlementKey: f.slot.entitlementKey,
          courseName: f.slot.courseName,
          startsAt: f.match?.startsAt ?? null,
          endsAt: endOf(f.match?.startsAt ?? null, f.slot.courseName),
          roomName: f.match?.room ?? null,
          therapistName: f.match?.therapistName ?? null,
          equipmentName: f.match?.equipmentName ?? null,
          ivProductName: f.match?.ivProductName ?? null,
          confidence: f.match?.confidence ?? null,
          evidence: f.match?.evidence ?? null,
        })),
      })),
    })),
    // 已確認、還沒來 —— 所以是 confirmed 不是 done，會算進「已排未上」
    futureVisits: r.leftover.future.map((x) => ({
      customerName: x.customer, date: x.event.date, status: 'confirmed',
      courseName: x.course, startsAt: timeOf(x.event),
      evidence: x.event.summary, include: false,
    })),
    missingFromSheet: r.leftover.calendarOnly.map((x) => ({
      customerName: x.customer, date: x.event.date, courseName: x.course,
      startsAt: timeOf(x.event), evidence: x.event.summary,
      sheetHasThatDay: x.sheetHasThatDay, include: false,
    })),
    eventCandidates: r.leftover.personal.map((e) => ({
      title: e.summary,
      startDate: e.date, endDate: e.date,
      startTime: timeOf(e), endTime: null,
      category: 'personal', repeats: e.repeats, include: false,
    })),
    ambiguous: r.ambiguous,
  };
}

// ---------- 報告 ----------

const width = (t) => [...String(t)].reduce((n, ch) => n + (/[⺀-꓏가-힣豈-﫿︰-﹏＀-｠]/.test(ch) ? 2 : 1), 0);
const padStart = (t, to) => `${' '.repeat(Math.max(to - width(t), 0))}${t}`;
const pad = (t, to) => `${t}${' '.repeat(Math.max(to - width(t), 0))}`;

export function reportText(r) {
  const L = [];
  const slots = r.plans.flatMap((p) => p.days.flatMap((d) => d.filled));
  const high = slots.filter((s) => s.match?.confidence === 'high').length;
  const low = slots.filter((s) => s.match?.confidence === 'low').length;
  const miss = slots.filter((s) => !s.match).length;
  const conflicts = r.plans.flatMap((p) => p.days.flatMap((d) => d.conflicts.map((c) => ({ p, d, c }))));

  L.push('試算表 × 行事曆 — 對帳報告（還沒有寫入任何東西）', '');
  L.push(`行事曆涵蓋 ${r.span[0]} ～ ${r.span[1]}，共 ${r.events.length} 筆事件`);
  L.push(`試算表 ${r.plans.length} 張分頁，${slots.length} 個時段`);
  L.push(`  三方對得上（人＋日期＋療程）  ${high}`);
  L.push(`  要你確認（只寫了一半）        ${low}`);
  L.push(`  配不到，時間維持不詳          ${miss}`);
  L.push('');

  // 一位客戶整批對不上，幾乎一定是名字的問題（行事曆上叫暱稱、打錯字、只寫姓）。
  // 這件事要排在最前面：別名補上之後底下每一段的結論都會變，先跑下去只是白算一次。
  // 判準不是「一筆都沒配到」—— 沒寫名字的事件那條規則會替她補上幾筆，看起來就不像
  // 名字有問題了。真正的訊號是**行事曆上從來沒有一天寫過她的名字**。
  const blind = r.plans.filter((p) => p.days.length >= 2 && p.days.every((d) => !d.named));
  if (blind.length) {
    L.push('━━━ ⓪ 先補別名，再看底下 ━━━');
    L.push('   行事曆上從頭到尾沒有一天寫過這幾位的名字。多半不是她們沒來，是叫法不一樣', '');
    for (const p of blind) {
      const days = p.days.map((d) => d.date).join('、');
      L.push(`   ${short(p.customerName)}｜試算表有 ${p.days.length} 天（${days}）｜行事曆上找不到這個名字`);
      L.push(`      現在會找的寫法：${p.forms.join('、')}`);
    }
    L.push('   → 問她「行事曆上你都怎麼叫這幾位」，寫進 .local/aliases.json 再跑一次。', '');
  }

  L.push('━━━ ① 兩邊講的不是同一件事 ━━━');
  L.push('   試算表勾了一件事、行事曆那天寫的是另一件。行事曆通常是對的。', '');
  if (!conflicts.length) L.push('   （沒有）');
  for (const { p, d, c } of conflicts) {
    const open = d.filled.filter((x) => !x.match).map((x) => x.slot.courseName);
    L.push(`   ${d.date} ${short(p.customerName)}`);
    L.push(`      試算表：${open.length ? open.join('、') : '（那天的時段都配掉了）'}`);
    L.push(`      行事曆：「${c.e.summary}」→ ${c.courses.map((x) => x.course).join('、')}`);
  }
  L.push('');

  L.push('━━━ ② 行事曆上有，試算表沒勾 ━━━');
  L.push('   最危險的一種：她那天做了，但忘記回去打勾，次數因此少算。', '');
  if (!r.leftover.calendarOnly.length) L.push('   （沒有）');
  for (const x of r.leftover.calendarOnly.sort((a, b) => a.event.date.localeCompare(b.event.date))) {
    L.push(`   ${x.event.date} ${short(x.customer)}｜${x.course}｜「${x.event.summary}」`
      + (x.sheetHasThatDay ? '（那天試算表有勾別的）' : '（那天試算表整天沒勾）'));
  }
  L.push('');

  L.push('━━━ ③ 試算表有，行事曆沒有 ━━━');
  L.push('   可能是沒記行事曆，也可能是勾錯人 —— 同一天有另一位客戶的同樣療程只出現在');
  L.push('   行事曆上時，底下會標「⇄ 可能勾錯人」。', '');
  const orphans = [];
  for (const p of r.plans) {
    for (const d of p.days) {
      const open = d.filled.filter((x) => !x.match);
      if (!open.length) continue;
      const alt = r.leftover.calendarOnly.filter((x) => x.event.date === d.date
        && open.some((o) => SAME(x.course, o.slot.courseName)));
      orphans.push({ name: p.customerName, date: d.date, courses: open.map((o) => o.slot.courseName), alt });
    }
  }
  if (!orphans.length) L.push('   （沒有）');
  for (const o of orphans.sort((a, b) => a.date.localeCompare(b.date))) {
    const outside = r.span[0] && o.date < r.span[0];
    L.push(`   ${o.date} ${short(o.name)}｜${o.courses.join('、')}`
      + (outside ? '（在行事曆的涵蓋範圍之前，本來就查不到）' : '')
      + (o.alt.length ? `\n      ⇄ 可能勾錯人：同一天「${o.alt[0].event.summary}」記的是 ${short(o.alt[0].customer)}` : ''));
  }
  L.push('');

  L.push('━━━ ④ 補到了什麼 ━━━', '');
  for (const p of r.plans) {
    if (!p.days.length) { L.push(`   ${short(p.customerName)}｜${p.skip ?? '沒有來訪'}`); continue; }
    L.push(`   ── ${short(p.customerName)}`);
    for (const d of p.days) {
      for (const f of d.filled) {
        const m = f.match;
        L.push(`      ${d.date} ${pad(f.slot.courseName, 18)}`
          + (m ? `${m.startsAt ?? '??:??'}${m.part ? `（第 ${m.part} 段）` : ''}`
            + `${m.room ? `　${m.room}` : ''}${m.equipmentName ? `　${m.equipmentName}` : ''}`
            + `${m.confidence === 'low' ? `　⚠ ${m.why}：「${m.evidence}」` : ''}`
            + `${m.clock && m.startsAt && m.clock !== m.startsAt ? `　（行事曆時間欄是 ${m.clock}，以標題為準）` : ''}`
            : '時間不詳'));
      }
    }
  }
  if (r.ambiguous.length) {
    L.push('━━━ ④b 同一筆事件兩個人都可能 ━━━');
    L.push('   行事曆上沒寫是誰，而那天有兩位客戶都勾了這個療程。兩邊都不補，等你指認。', '');
    for (const a of r.ambiguous) {
      L.push(`   ${a.date}｜「${a.evidence}」｜${a.course}｜可能是：${a.who.map(short).join(' 或 ')}`);
    }
    L.push('');
  }
  L.push('━━━ ⑤ 未來的預約 ━━━');
  L.push('   對得到客戶與療程、日期在今天之後。這幾筆是「已確認、還沒來」，會算進已排未上。', '');
  if (!r.leftover.future.length) L.push('   （沒有）');
  for (const x of r.leftover.future) {
    L.push(`   ${x.event.date} ${timeInSummary(x.event.summary)?.start ?? x.event.clock}`
      + ` ${short(x.customer)}｜${x.course}｜「${x.event.summary}」`);
  }
  L.push('');

  L.push(`━━━ ⑥ 對不到客戶的 ${r.leftover.personal.length} 筆，全部列在這裡 ━━━`);
  L.push('   個人行程、公司的事、待辦全部混在一起，而且顏色分不出來。');
  L.push('   一律**預設不匯入**，由她一筆一筆決定 —— 猜錯會在日曆上長出她沒有的事。', '');
  let month = '';
  for (const e of [...r.leftover.personal].sort((a, b) => (a.date + a.summary).localeCompare(b.date + b.summary))) {
    if (e.date.slice(0, 7) !== month) {
      month = e.date.slice(0, 7);
      L.push(`   ── ${month}`);
    }
    L.push(`   ${e.date} ${padStart(timeInSummary(e.summary)?.start ?? e.clock ?? '', 5)}  ${e.summary}`
      + (e.repeats ? '　（重複事件）' : ''));
  }
  return L.join('\n');
}

const short = (n) => String(n).replace(/\\n/g, '/').replace(/\s+/g, ' ');

// ---------- CLI ----------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k, d = null) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const sheetsDir = arg('sheets');
  const icsPath = arg('ics');
  if (!sheetsDir || !icsPath) {
    console.error('用法：node merge.mjs --sheets <tsv 資料夾> --ics <檔案> [--year 2026] [--aliases a.json] [--out 資料夾]');
    process.exit(1);
  }
  const aliasPath = arg('aliases');
  const aliases = aliasPath ? JSON.parse(readFileSync(aliasPath, 'utf8')) : {};
  const r = reconcile({
    sheetsDir, icsPath, year: Number(arg('year', new Date().getFullYear())),
    aliases: aliases.nicknames ?? aliases,
    therapists: aliases.therapists ?? [],
    doctors: aliases.doctors ?? [],
    noise: aliases.noise ?? [],
    today: arg('today', new Date().toISOString().slice(0, 10)),
  });
  const text = reportText(r);
  const out = arg('out');
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'report.txt'), `${text}\n`);
    writeFileSync(join(out, 'import.json'),
      `${JSON.stringify(importJson(r, { calendar: icsPath.split('/').pop() }), null, 2)}\n`);
    console.error(`寫到 ${out}/report.txt 與 import.json`);
  }
  console.log(text);
}
