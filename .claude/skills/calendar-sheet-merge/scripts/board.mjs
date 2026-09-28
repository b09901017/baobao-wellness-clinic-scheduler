// 決定頁的資料：把對帳報告的每一筆攤成「一項」。
//
// 她 2026-09-28：「必須一樣完整不能遺漏或簡化各種問題」「之前我做過的決定就不要再問了」。
// 以前問卷是模型讀報告手挑、手寫的 —— 挑漏了沒有東西擋，答過的也認不得。
// 這一支把兩件事都交給程式：
//
// 1. **報告的每一段，每一筆都變成一項。** 筆數由 `tests/merge-board.test.js` 拿報告上印的數字對，
//    少一筆就紅。
// 2. **每一項有一把固定的鑰匙**（分頁名＋日期＋行事曆原文那一類，不是題號）。她答過的記在決定檔的
//    `answers[鑰匙]`（`record.mjs` 寫），鑰匙對得上就標成已決定、不再問。她改了行事曆或舊表上的字，
//    鑰匙跟著變 —— 那一項會重新出現，原本那一條決定會進 ⓪d（「之前的決定沒對到」），不會安靜失效。
//
// 每一個選項本身帶著「選了它要寫進決定檔的哪幾條」（`ops`），所以回報不用模型翻：
// `record.mjs` 照著寫。寫不出來的（「其他（備註寫）」）標成 `free`，記成待翻譯、不算答完。
//
// ops 的形狀：`{ sheet, section, add?, remove? }`
//   section：'slots' | 'skipEvents' | 'dropProblems' | 'notes.drop' | 'notes.add' | 'entitlements'（客戶那一層）
//            'events'（整份那一層，sheet 是 null）
//   add／remove 就是決定檔裡那一條原本的樣子（格式見 SKILL.md「決定檔」）

import {
  importJson, orphansOf, sheetProblems, purchaseProblems, classifyEvent, timeOf,
  displayName, isPastEvent, mentionsCustomer, blindOf,
} from './merge.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const repoModule = (rel) => import(pathToFileURL(join(REPO, rel)).href);
const { planForCustomer, KIND_LABEL } = await repoModule('public/js/domain/mergeImport.js');
const { SEED } = await repoModule('public/js/domain/seed.js');
const { addDays } = await repoModule('public/js/domain/dates.js');

/**
 * 每一種長什麼樣。順序就是「看種類」那一頁的順序：要她決定的在前、資訊在後。
 * `required`：沒決定就算在「要你決定」裡。以後的雜事預設照建議（她 8/21：未來的都要匯），看一眼就好。
 */
export const KINDS = {
  alias: { label: '行事曆上從來沒寫過她', short: '叫法？', color: 'red', required: true },
  calendarOnly: { label: '行事曆有、舊表沒勾', short: '漏勾？', color: 'red', required: true },
  conflict: { label: '兩邊寫的不一樣', short: '不一樣', color: 'orange', required: true },
  wrongPerson: { label: '可能勾錯人', short: '勾錯人？', color: 'orange', required: true },
  guess: { label: '時間是推測的', short: '推測', color: 'amber', required: true },
  who: { label: '兩個人都可能', short: '是誰？', color: 'purple', required: true },
  future: { label: '以後的預約', short: '預約', color: 'green', required: true },
  stale: { label: '之前的決定沒對到', short: '沒對到', color: 'pink', required: true },
  purchase: { label: '購買名稱對不上', short: '購買', color: 'teal', required: true },
  sheet: { label: '舊表上的問題', short: '舊表', color: 'brown', required: true },
  master: { label: 'app 主檔裡沒有', short: '主檔', color: 'slate', required: true },
  pastTodo: { label: '最近兩週的待辦', short: '待辦？', color: 'violet', required: true },
  question: { label: '以前的題目', short: '以前的題目', color: 'violet', required: true },
  event: { label: '以後的雜事', short: '雜事', color: 'blue', required: false },
  sheetOnly: { label: '舊表有、行事曆沒記', short: '只有舊表', color: 'grey', required: false },
  sheetInfo: { label: '舊表的小提醒', short: '提醒', color: 'grey', required: false },
  dropped: { label: '今天以前的雜事（照你的規則不匯）', short: '不匯', color: 'grey', required: false },
  unreadable: { label: '讀不出來的行事曆', short: '讀不到', color: 'grey', required: false },
};

/** 最近幾天的待辦要拿出來給她確認一次（她：「如果有你覺得重要的可以和我確認」） */
export const PAST_TODO_DAYS = 14;

/** 一項的鑰匙：種類＋分頁名＋日期＋原文那一類。她改了原文，鑰匙跟著變 —— 那一項會重新出現 */
const keyOf = (...parts) => parts.map((x) => String(x ?? '')).join('|');
const mdOf = (date) => (date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : '');
const quote = (text) => `「${text}」`;
const OTHER = { id: 'other', label: '其他（寫在備註）', free: true };

/** ⓪b 裡純粹是提醒、不用她決定的那幾種（年份她 9/15 答過全部 2026） */
const SHEET_INFO = /沒有寫年份|同一天有 \d+ 欄|營養品不排班/;

/**
 * @param {object} r `reconcile()` 的結果
 * @param {{ decisions?: object }} [o]
 * @returns {{ items: object[], today: string|null, customers: object[], context: object }}
 */
export function boardItems(r, { decisions = null } = {}) {
  const today = r.today ?? null;
  const answers = decisions?.answers ?? {};
  const json = importJson(r, { generatedAt: '' });
  const plans = r.plans ?? [];
  const planOf = new Map(plans.map((p) => [p.customerName, p]));
  const nameOf = (p) => displayName(p.customer?.name ?? p.customerName, { renames: r.renames, sheetName: p.sheetName });
  const whoOf = (customerName) => {
    const p = planOf.get(customerName);
    return { who: p ? nameOf(p) : customerName, sheet: p?.sheetName ?? null };
  };
  const byDate = new Map();
  for (const e of r.events ?? []) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  // 那一天舊表底下寫的字（「她忘記」「客人有事」）—— 已經收進那位的備註，開頭是日期
  const notesOn = (p, date) => (p?.customer?.marks ?? [])
    .map((m) => m.text).filter((t) => t.startsWith(`${mdOf(date)} `));
  // 同一天行事曆上其他提到她的句子、提到取消的句子
  const sameDay = (p, date, except) => (byDate.get(date) ?? []).filter((e) => e.summary !== except
    && (mentionsCustomer(e.summary, p?.forms) || /取消/.test(e.summary)));
  // 「不是來訪／不要」：那一句不算來訪（skipEvents）**而且**不匯成雜事（events 的 skip）。
  // 只寫前者的話，那一句下一輪會掉進雜事、以後的日期 app 照樣勾起來 —— 等於又回來問她一次
  const notAVisit = (sheet, e) => [
    { sheet, section: 'skipEvents', add: { date: e.date, title: e.summary } },
    { sheet: null, section: 'events', add: { date: e.date, title: e.summary, skip: '她在決定頁說不是來訪' } },
  ];
  const stateOf = (a, orElse) => (a ? (a.hold ? 'held' : (a.needsTranslation || a.unmatched?.length) ? 'translate' : 'decided') : orElse);
  const prevOf = (a) => ({ choice: a.choice, label: a.label, note: a.note ?? null, at: a.at ?? null, form: a.form ?? null });
  const line = (e) => `${e.date === today ? '今天 ' : ''}${timeOf(e) ?? ''} ${quote(e.summary)}`.trim();

  const items = [];
  const push = (item) => items.push({ required: KINDS[item.kind].required, urgent: false, options: [], ...item });

  // ---------- ⓪ 行事曆上從來沒寫過她（多半是叫法不一樣）----------
  for (const p of blindOf(r)) {
    push({
      key: keyOf('alias', p.sheetName), kind: 'alias', date: null, who: nameOf(p), sheet: p.sheetName,
      title: '行事曆上你都怎麼叫她？',
      facts: [['舊表', `有 ${p.days.length} 天：${p.days.map((d) => mdOf(d.date)).join('、')}`], ['現在會找的寫法', (p.forms ?? []).join('、')]],
      now: '她的來訪都照舊表匯、時間不詳',
      options: [
        { id: 'alias', label: '行事曆上寫的是…（寫在備註，我加進對照表）', free: true },
        { id: 'none', label: '她真的沒記在行事曆上，沒關係', ops: [] },
      ],
    });
  }

  // ---------- ② 行事曆有、舊表沒勾 ----------
  for (const x of r.leftover.calendarOnly) {
    const p = planOf.get(x.customer);
    const { who, sheet } = whoOf(x.customer);
    const e = x.event;
    const notes = notesOn(p, e.date);
    const around = sameDay(p, e.date, e.summary);
    const cancelled = notes.length > 0 || around.some((o) => /取消/.test(o.summary));
    push({
      key: keyOf('calendarOnly', sheet, e.date, e.summary),
      kind: 'calendarOnly', date: e.date, who, sheet,
      title: `${mdOf(e.date)} 這一段${x.course}有做嗎？`,
      facts: [
        ['行事曆', [line(e), ...around.map(line)]],
        ['舊表', [x.sheetHasThatDay ? '那天有勾別的，這一段沒勾' : '那天整天沒勾',
          ...notes.map((t) => `那天底下寫${quote(t.slice(mdOf(e.date).length + 1))}`)]],
      ],
      now: '沒匯（舊表沒勾的先當沒做）',
      options: [
        { id: 'no', label: '沒做，不匯', rec: cancelled, ops: notAVisit(sheet, e) },
        { id: 'yes', label: `有做，補這一段${x.course}`, ops: [{ sheet, section: 'slots', add: { date: e.date, add: { course: x.course, fromEvent: e.summary } } }] },
        OTHER,
      ],
    });
  }

  // ---------- ① 兩邊寫的不一樣 ----------
  for (const p of plans) {
    for (const d of p.days ?? []) {
      for (const c of d.conflicts ?? []) {
        const open = d.filled.filter((f) => !f.match).map((f) => f.slot.courseName);
        push({
          key: keyOf('conflict', p.sheetName, d.date, c.e.summary),
          kind: 'conflict', date: d.date, who: nameOf(p), sheet: p.sheetName,
          title: `${mdOf(d.date)} 舊表跟行事曆寫的不一樣，哪邊對？`,
          facts: [['舊表', `勾的是 ${open.join('、') || '（那天都配掉了）'}`], ['行事曆', line(c.e)]],
          now: '照舊表匯，行事曆那一句沒用',
          options: [
            { id: 'sheet', label: '舊表對', ops: notAVisit(p.sheetName, c.e) },
            { id: 'cal', label: '行事曆對（寫在備註是哪裡要改）', free: true },
          ],
        });
      }
    }
  }

  // ---------- ③ 舊表有、行事曆沒有 ----------
  for (const o of orphansOf(r)) {
    const p = plans.find((x) => x.sheetName === o.sheet);
    const base = { date: o.date, who: nameOf(p), sheet: o.sheet };
    const before = r.span?.[0] && o.date < r.span[0];
    if (o.alt.length) {
      push({
        ...base, kind: 'wrongPerson', urgent: true,
        key: keyOf('wrongPerson', o.sheet, o.date, o.courses.join('+')),
        title: `${mdOf(o.date)} 舊表勾了${o.courses.join('、')}，會不會勾錯人？`,
        facts: [['舊表', `勾了 ${o.courses.join('、')}，行事曆上沒有她`], ['行事曆', `同一天${quote(o.alt[0].event.summary)}記的是 ${whoOf(o.alt[0].customer).who}`]],
        now: '照舊表匯（時間不詳）',
        options: [{ id: 'keep', label: '沒勾錯，照舊表', ops: [] }, { id: 'wrong', label: '勾錯人了（寫在備註）', free: true }],
      });
    } else {
      push({
        ...base, kind: 'sheetOnly',
        key: keyOf('sheetOnly', o.sheet, o.date, o.courses.join('+')),
        title: `${mdOf(o.date)} ${o.courses.join('、')}：舊表有勾、行事曆沒記`,
        facts: [['為什麼', before ? '那天在行事曆的範圍之前，本來就查不到' : '照你 9/15 說的：舊表有勾的就是有']],
        now: '照舊表匯（時間不詳）',
      });
    }
  }

  // ---------- ④ 推測的時間、④b 兩個人都可能 ----------
  const staleSlot = new Set((r.decisionLog?.stale ?? []).filter((s) => s.section === 'slots' && s.op?.course)
    .map((s) => keyOf(s.sheet, s.op.date, s.op.course, s.op.nth ?? 1)));
  let folded = 0;
  for (const p of plans) {
    for (const d of p.days ?? []) {
      const nthOf = new Map();
      for (const f of d.filled) {
        const nth = (nthOf.get(f.slot.courseName) ?? 0) + 1;
        nthOf.set(f.slot.courseName, nth);
        if (f.match?.confidence !== 'low') continue;
        // 同一段已經有一條「之前的決定沒對到」—— 那一項會問，這裡不重問一次
        if (staleSlot.has(keyOf(p.sheetName, d.date, f.slot.courseName, nth))) { folded += 1; continue; }
        const ref = { date: d.date, course: f.slot.courseName, ...(nth > 1 ? { nth } : {}) };
        push({
          key: keyOf('guess', p.sheetName, d.date, f.slot.courseName, nth, f.match.evidence),
          kind: 'guess', date: d.date, who: nameOf(p), sheet: p.sheetName,
          title: `${mdOf(d.date)} ${f.slot.courseName} 的時間是 ${f.match.startsAt ?? '？'} 嗎？`,
          facts: [['行事曆', quote(f.match.evidence)], ['為什麼是推測', f.match.why ?? '']],
          now: `先照 ${f.match.startsAt ?? ''}${f.match.room ? ` ${f.match.room}` : ''}（標成推測）`,
          options: [
            { id: 'yes', label: '對', rec: false, ops: [{ sheet: p.sheetName, section: 'slots', add: { ...ref, set: { fromEvent: f.match.evidence } } }] },
            { id: 'no', label: '不對，時間不詳就好', ops: [{ sheet: p.sheetName, section: 'slots', add: { ...ref, clear: true } }] },
          ],
        });
      }
    }
  }
  for (const a of r.ambiguous ?? []) {
    const people = a.who.map((w) => whoOf(w));
    push({
      key: keyOf('who', a.date, a.evidence),
      kind: 'who', date: a.date, who: people.map((x) => x.who).join('／'), sheet: null,
      title: `${mdOf(a.date)}${quote(a.evidence)}是誰的？`,
      facts: [['行事曆', `${quote(a.evidence)}沒寫名字`], ['舊表', `那天 ${people.map((x) => x.who).join('、')} 都勾了${a.course}`]],
      now: '兩位都先當時間不詳',
      options: [
        ...people.map((x, i) => ({ id: `p${i}`, label: `是 ${x.who}`, ops: [{ sheet: x.sheet, section: 'slots', add: { date: a.date, course: a.course, set: { fromEvent: a.evidence } } }] })),
        { id: 'none', label: '不確定，時間不詳就好', ops: [] },
      ],
    });
  }

  // ---------- ⑤ 以後的預約 ----------
  for (const x of r.leftover.future) {
    const { who, sheet } = whoOf(x.customer);
    const e = x.event;
    push({
      key: keyOf('future', sheet, e.date, e.summary),
      kind: 'future', date: e.date, who, sheet,
      title: `${mdOf(e.date)} 這一個${x.course}要建成預約嗎？`,
      facts: [['行事曆', line(e)], ['舊表', '還沒勾（以後的）']],
      now: '建成已確認的預約（app 以後的預設會勾）',
      options: [
        { id: 'yes', label: '建成預約', rec: true, ops: [{ sheet, section: 'slots', add: { date: e.date, add: { course: x.course, fromEvent: e.summary } } }] },
        { id: 'no', label: '不要', ops: notAVisit(sheet, e) },
        OTHER,
      ],
    });
  }

  // ---------- ⓪d 之前的決定沒對到 ----------
  for (const s of r.decisionLog?.stale ?? []) {
    const p = plans.find((x) => x.sheetName === s.sheet);
    const who = p ? nameOf(p) : null;
    const drop = { id: 'drop', label: '這一條不用了', ops: [{ sheet: s.sheet, section: s.section, remove: s.op }] };
    const item = {
      key: keyOf('stale', s.sheet, s.section, JSON.stringify(s.op)),
      kind: 'stale', date: s.op?.date ?? null, who, sheet: s.sheet,
      title: '你之前的一個決定，這一次找不到對象',
      facts: [['那一條', s.text.replace(/^[^：]*：/, '')]],
      now: '這一條這一次沒有用上',
      options: [drop, OTHER],
    };
    // 時段那一條：行事曆那一句她改過字，這一次那一段讀到的是新的那一句
    if (s.section === 'slots' && s.op?.set?.fromEvent && s.op.course) {
      const d = p?.days.find((x) => x.date === s.op.date);
      const f = (d?.filled ?? []).filter((x) => x.slot.courseName === s.op.course)[(s.op.nth ?? 1) - 1];
      const now = f?.match?.evidence;
      item.title = `${mdOf(s.op.date)} ${s.op.course}：行事曆那一句改過了，照新的嗎？`;
      item.facts = [['你之前對過的', quote(s.op.set.fromEvent)], ['行事曆現在', now ? quote(now) : '那天找不到對得上的句子']];
      if (now) {
        item.now = `先照新的那一句${f.match.startsAt ? `（${f.match.startsAt}${f.match.room ? ` ${f.match.room}` : ''}）` : ''}，標成推測`;
        item.options = [
          { id: 'new', label: '照新的那一句', rec: true, ops: [{ sheet: s.sheet, section: 'slots', remove: s.op },
            { sheet: s.sheet, section: 'slots', add: { ...s.op, set: { ...s.op.set, fromEvent: now } } }] },
          { ...drop, label: '這一條不用了（時間不詳）' },
          OTHER,
        ];
      }
    }
    // 備註那一條：舊表上那一句她改過字
    if (s.section === 'notes.drop') {
      const now = (p?.customer?.marks ?? []).map((m) => m.text).filter((t) => t.includes(s.op) && t !== s.op);
      item.title = '舊表上那一則備註改過字了，要怎麼寫？';
      item.facts = [['你之前說要刪的', quote(s.op)], ['舊表現在', now.length ? now.map(quote) : '找不到']];
      item.now = now.length ? '兩則都在（原文＋你之前改寫的那一則）' : '沒有東西要刪';
      if (now.length) {
        item.options = [
          { id: 'new', label: `刪掉現在那一則${quote(now[0])}`, rec: true, ops: [{ sheet: s.sheet, section: 'notes.drop', remove: s.op },
            { sheet: s.sheet, section: 'notes.drop', add: now[0] }] },
          { ...drop, label: '兩則都留' },
          OTHER,
        ];
      }
    }
    if (s.section === 'dropProblems') {
      item.title = '一條「購買名稱不用再問」這一次沒出現';
      item.options = [{ ...drop, label: '這一條不用了（舊表改過了）', rec: true }, OTHER];
    }
    push(item);
  }

  // ---------- ⓪c 購買名稱對不上 ----------
  for (const p of plans) {
    for (const why of p.purchaseProblems ?? []) {
      push({
        key: keyOf('purchase', p.sheetName, why),
        kind: 'purchase', date: null, who: nameOf(p), sheet: p.sheetName,
        title: '買的東西，舊表兩個地方寫得不一樣',
        facts: [['舊表 B2（購買名稱）', quote(p.source ?? '')], ['對不上的', why]],
        now: '照應有次數（D 欄）匯',
        options: [
          { id: 'keep', label: '照應有次數就對', ops: [{ sheet: p.sheetName, section: 'dropProblems', add: why }] },
          OTHER,
        ],
      });
    }
  }
  // ---------- ⓪b 舊表上的問題 ----------
  for (const p of plans) {
    for (const x of p.problems ?? []) {
      const info = SHEET_INFO.test(x.why);
      push({
        // 理由那一句裡的數字（「勾了 6 次」）不進鑰匙：她每多勾一天數字就變，而那是同一件事 ——
        // 變了就重問的話，答過的會一直回來。那一格原文（raw）變了才算新的一項
        key: keyOf(info ? 'sheetInfo' : 'sheet', p.sheetName, x.where, x.raw, String(x.why).replace(/\d+/g, '#')),
        kind: info ? 'sheetInfo' : 'sheet', date: null, who: nameOf(p), sheet: p.sheetName,
        title: info ? x.why : `${x.where}${x.raw ? quote(x.raw) : ''}：${x.why}`,
        facts: [['舊表', `${x.where ?? ''}${x.raw ? ` ${quote(x.raw)}` : ''}`]],
        now: info ? '' : '照這樣匯',
        ...(info ? {} : { options: [{ id: 'keep', label: '照這樣就好', ops: [] }, OTHER] }),
      });
    }
  }

  // ---------- app 主檔裡沒有 ----------
  const ctx = { courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts, rooms: SEED.rooms, staff: SEED.staff, today };
  const master = new Map();
  for (const c of json.customers) {
    for (const pr of planForCustomer(c, ctx, json).problems ?? []) {
      const key = keyOf('master', pr.why, pr.raw);
      const m = master.get(key) ?? { pr, who: new Set() };
      m.who.add(c.name);
      master.set(key, m);
    }
  }
  for (const [key, { pr, who }] of master) {
    push({
      key, kind: 'master', date: null, who: [...who].join('、'), sheet: null,
      title: `app 的設定裡沒有${quote(pr.raw)}`,
      facts: [['會怎樣', pr.why], ['在哪裡', pr.where ?? '']],
      now: '那一格匯進去是空的',
      options: [
        { id: 'add', label: '匯入前我去設定加上', ops: [] },
        OTHER,
      ],
    });
  }

  // ---------- ⑥ 對不到客戶的雜事 ----------
  const since = today ? addDays(today, -PAST_TODO_DAYS) : null;
  const known = plans.filter((p) => !p.skip);
  for (const e of r.leftover.personal) {
    const dec = r.eventDecisions?.get(`${e.date}|${e.summary}`) ?? null;
    const auto = classifyEvent(e.summary);
    const kind = dec?.kind ?? auto.kind;
    // 跟合併檔同一支（`isPastEvent()`）：各判一次的話，決定頁印「不匯」、合併檔卻匯進去
    const past = isPastEvent(e, dec, today);
    const kept = !past && today && e.endDate < today;
    const mentions = known.filter((p) => mentionsCustomer(e.summary, p.forms)).map(nameOf);
    const base = {
      date: e.date, endDate: e.endDate > e.date ? e.endDate : null, who: mentions.join('、') || null, sheet: null,
      // prev：決定檔裡這一筆原本的那一條（沒有就 null）—— 決定頁改它的時候要先拿掉它
      event: { title: e.summary, time: e.allDay ? null : timeOf(e), kind, autoKind: auto.kind, why: dec?.kind ? '照你之前的決定' : auto.why, repeats: e.repeats ?? false, prev: dec },
    };
    if (!past) {
      push({
        ...base, kind: 'event', key: keyOf('event', e.date, e.summary),
        title: e.summary,
        now: dec?.skip ? '你之前說不匯' : kept ? `你說要留（匯成${KIND_LABEL[kind]}）` : `匯成${KIND_LABEL[kind]}`,
        decidedBefore: Boolean(dec),
      });
    } else if (auto.kind === 'note' && e.date >= since) {
      push({
        ...base, kind: 'pastTodo', key: keyOf('pastTodo', e.date, e.summary),
        title: `${mdOf(e.date)}${quote(e.summary)}還要留著嗎？`,
        facts: [['為什麼問你', `這是一件待辦，${mdOf(e.date)} 已經過了。今天以前的雜事照你的規則不匯 —— 只有最近兩週的待辦拿出來問一次`]],
        now: '不匯',
        options: [
          { id: 'drop', label: '不用了', rec: true, ops: [] },
          { id: 'keep', label: '留著，匯成待辦', ops: [{ sheet: null, section: 'events', add: { date: e.date, title: e.summary, kind: 'note', include: true } }] },
        ],
        decidedBefore: dec?.include === true,
      });
    } else {
      push({ ...base, kind: 'dropped', key: keyOf('dropped', e.date, e.summary), title: e.summary, now: '不匯' });
    }
  }
  for (const x of r.unreadable ?? []) {
    push({ kind: 'unreadable', key: keyOf('unreadable', x.summary, x.raw), date: null, who: null, sheet: null, title: x.summary, facts: [['為什麼', x.why], ['原文', x.raw ?? '']], now: '沒有匯' });
  }

  // 行事曆上同一天兩筆一模一樣的（她按了兩次）：照出現的順序編 #2、#3 —— 行事曆的順序是固定的，所以鑰匙也是
  const times = new Map();
  for (const it of items) {
    const n = (times.get(it.key) ?? 0) + 1;
    times.set(it.key, n);
    if (n > 1) it.key = `${it.key}#${n}`;
  }

  // ---------- 她答過的 ----------
  const seen = new Set();
  for (const it of items) {
    seen.add(it.key);
    const a = answers[it.key];
    it.state = stateOf(a, it.decidedBefore ? 'decided' : 'open');
    if (a) it.prev = prevOf(a);
  }
  // 保留中、但這一次沒有產生的（例：9/16 那 20 題 —— 決定已經套上了，報告上不會再有那一筆）
  // 照存下來的那一份題目再問；答過的留在「以前的決定」裡，點得開
  for (const [key, a] of Object.entries(answers)) {
    if (seen.has(key)) continue;
    const snap = a.snapshot ?? { kind: 'question', title: a.label ?? key };
    items.push({
      options: [], facts: [], ...snap,
      kind: KINDS[snap.kind] ? snap.kind : 'question',
      key, required: a.hold ? true : false, urgent: Boolean(snap.urgent),
      state: stateOf(a, null) === 'decided' ? 'record' : stateOf(a, null),
      prev: prevOf(a),
      fromRecord: true,
    });
  }

  const customers = known.map((p) => ({ sheet: p.sheetName, name: nameOf(p) }));
  return { items, today, customers, folded, context: contextOf(r, nameOf) };
}

/**
 * 日曆上「那一天已經對上的來訪」—— 不用決定，讓她點開一天時看得到那天的全貌。
 * @returns {{ visits: {date, who, sheet, course, startsAt, room, confidence}[] }}
 */
function contextOf(r, nameOf) {
  const visits = [];
  for (const p of r.plans ?? []) {
    for (const d of p.days ?? []) {
      for (const f of d.filled) {
        visits.push({
          date: d.date, who: nameOf(p), sheet: p.sheetName, course: f.slot.courseName,
          startsAt: f.match?.startsAt ?? null, room: f.match?.room ?? null, confidence: f.match?.confidence ?? null,
        });
      }
    }
  }
  return { visits };
}

/** 報告那幾段各有幾筆 —— 測試拿它跟決定頁的項數比 */
export function reportCounts(r) {
  const slots = r.plans.flatMap((p) => p.days.flatMap((d) => d.filled));
  return {
    calendarOnly: r.leftover.calendarOnly.length,
    conflict: r.plans.reduce((n, p) => n + p.days.reduce((m, d) => m + (d.conflicts?.length ?? 0), 0), 0),
    orphans: orphansOf(r).length,
    low: slots.filter((s) => s.match?.confidence === 'low').length,
    who: r.ambiguous.length,
    future: r.leftover.future.length,
    personal: r.leftover.personal.length,
    sheet: sheetProblems(r).length,
    purchase: purchaseProblems(r).length,
    stale: r.decisionLog?.misses.length ?? 0,
    unreadable: (r.unreadable ?? []).length,
    blind: blindOf(r).length,
  };
}
