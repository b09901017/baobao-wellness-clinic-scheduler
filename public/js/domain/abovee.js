// Abovee 上的寫法 → app 主檔（issue 12）。純函式。
//
// Abovee 列表右半邊跟 app 主檔講的是同一批東西，寫法不一樣（例子用假名）：
//
// | Abovee 那一格 | 寫的是 | app 主檔 |
// |---|---|---|
// | 服務資源（復能那一列） | 治療師全名 `陳小芳` | 她叫她 `小芳`；`LuLu` 那種全名推不出來的靠「Abovee 上的寫法」 |
// | 服務資源（二返那一列） | 醫師全名 `夏大同` | 醫師只有姓 `夏` |
// | 服務資源（ILIB 那一列） | 機器＋房間 `I1點10` | 診間 `點滴10` |
// | 診間 | `治療室5`、`點滴室10` | `治5`、`點滴10` |
// | 課程 | `SIS 60`、`ILIB 60`、`EECP60`、`二返60` | 器材 SIS、課程 ILIB／EECP／二返，分鐘另外算 |
//
// **認不出來一律 null，不猜**。符合的有好幾位也是 null —— 挑一位就是把一段時間記到別人身上，
// 而畫面上看起來是認得的（同 ADR-0103 的判斷）。

import { DOCTOR_ROLE, THERAPIST_ROLE, normalizeAlias } from './masterData.js';
import { SHEET_COURSE_ALIASES, rowShape } from './legacyImport.js';
import { EQUIPMENT_ALIASES, FLYER_COURSE_ALIASES } from './photoPlan.js';

const live = (rows) => (rows ?? []).filter((r) => r && !r.deletedAt && r.active !== false);
const squash = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '');
const same = (a, b) => Boolean(squash(a)) && squash(a).toLowerCase() === squash(b).toLowerCase();

// ---------- 治療師與醫師 ----------

/**
 * 服務資源那一格的人名 → 治療師或醫師。
 *
 * 1. 主檔上記住的「Abovee 上的寫法」（`aboveeNames`）完全相同 → 那一位
 * 2. 否則：**治療師的名字是全名的結尾**（陳小芳 → 小芳）、**醫師的姓是全名的開頭**（夏大同 → 夏），
 *    而且只有一位符合
 *
 * @returns {object|null}
 */
export function staffFrom(text, staff = []) {
  const s = normalizeAlias(text);
  if (!s) return null;
  const pool = live(staff);

  const byAlias = pool.filter((x) => (x.aboveeNames ?? []).some((a) => normalizeAlias(a) === s));
  if (byAlias.length) return byAlias.length === 1 ? byAlias[0] : null;

  const hits = pool.filter((x) => {
    const n = normalizeAlias(x.name);
    if (!n) return false;
    if (x.role === DOCTOR_ROLE) return s.startsWith(n);
    if (x.role === THERAPIST_ROLE) return s.endsWith(n);
    return false;
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 她替認不出來的寫法選了人 → 要寫進治療師主檔的那幾筆（issue 13 存檔時一起寫）。
 *
 * 本來就認得的（結尾規則、已經記著）不寫；**那個寫法已經是別人的也不寫** ——
 * 兩位不可以同一個寫法（`validators.staff()`）。
 *
 * @param {{text: string, staffId: string}[]} picks
 * @returns {{id: string, name: string, changes: {aboveeNames: string[]}}[]}
 */
export function aliasWrites(picks = [], staff = []) {
  const pool = live(staff);
  const out = new Map();
  for (const { text, staffId } of picks ?? []) {
    const t = String(text ?? '').trim();
    const person = pool.find((x) => x.id === staffId);
    if (!t || !person) continue;
    if (staffFrom(t, pool)?.id === staffId) continue;
    if (pool.some((x) => (x.aboveeNames ?? []).some((a) => normalizeAlias(a) === normalizeAlias(t)))) continue;

    const entry = out.get(staffId) ?? {
      id: person.id, name: person.name, before: (person.aboveeNames ?? []).length,
      changes: { aboveeNames: [...(person.aboveeNames ?? [])] },
    };
    if (!entry.changes.aboveeNames.some((a) => normalizeAlias(a) === normalizeAlias(t))) {
      entry.changes.aboveeNames.push(t);
    }
    out.set(staffId, entry);
  }
  return [...out.values()]
    .filter((e) => e.changes.aboveeNames.length > e.before)
    .map(({ before, ...rest }) => rest);
}

// ---------- 診間 ----------

/** Abovee 的房間寫法 → 主檔的全名。 */
const ROOM_WORDS = [
  [/^治療室(\d+)$/, '治$1'],
  [/^點滴室(\d+)$/, '點滴$1'],
  [/^VIP室(\d+)$/i, 'VIP$1'],
];

function roomByText(text, rooms) {
  let s = squash(text);
  if (!s) return null;
  for (const [re, to] of ROOM_WORDS) if (re.test(s)) s = s.replace(re, to);
  return live(rooms).find((r) => same(r.name, s) || (r.shortName && same(r.shortName, s))) ?? null;
}

/**
 * 診間那一格（`治療室5`）→ 診間；那一格空著或認不出來，就看服務資源裡的房間部分
 * （ILIB 那一列寫 `I1點10`、`I2治2`：前面是機器、後面是房間）。
 *
 * @returns {object|null}
 */
export function roomFrom(roomText, resourceText, rooms = []) {
  const direct = roomByText(roomText, rooms);
  if (direct) return direct;
  const m = squash(resourceText).match(/^I\d+(點|治)(\d+)$/i);
  return m ? roomByText(`${m[1] === '點' ? '點滴' : '治'}${m[2]}`, rooms) : null;
}

// ---------- 課程 ----------

function equipmentByName(name, equipment) {
  const s = squash(name);
  const full = EQUIPMENT_ALIASES[s] ?? EQUIPMENT_ALIASES[s.toUpperCase()] ?? s;
  return live(equipment).find((e) => same(e.name, full) || (e.shortName && same(e.shortName, full))) ?? null;
}

function courseByName(name, courses) {
  const s = squash(name);
  const want = FLYER_COURSE_ALIASES[s] ?? SHEET_COURSE_ALIASES[s] ?? s;
  return live(courses).find((c) => same(c.name, want) || (c.shortName && same(c.shortName, want))) ?? null;
}

/**
 * 課程那一格（`SIS 60`、`ILIB 60`、`EECP60`、`二返60`）→ 課程、器材、分鐘。
 *
 * 舊表那一支 `rowShape()` 認得的寫法先用它；其餘比器材的全名／別稱（器材推得出課程，ADR-0075），
 * 再比課程的全名／別稱。**器材欄一律帶著**同名的那一台（`ILIB 60` → eq-ilib）：
 * 四選一那一筆額度要知道選的是哪一台，單買 ILIB 的用不到它。
 *
 * @returns {{courseId: string, equipmentId: string|null, durationMin: number|null}|null}
 */
export function courseFrom(text, { courses = [], equipment = [] } = {}) {
  const s = String(text ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const m = s.match(/^(.*?\D)\s*(\d+)\s*(?:mins?|分鐘?)?$/i);
  const name = (m ? m[1] : s).trim();
  const durationMin = m ? Number(m[2]) : null;

  const shape = rowShape(durationMin ? `${name}(${durationMin})` : name);
  if (shape?.only) {
    const eq = equipmentByName(shape.only, equipment);
    if (eq?.courseId) return { courseId: eq.courseId, equipmentId: eq.id, durationMin };
  }
  if (shape?.kind === 'single') {
    const course = courseByName(shape.course, courses);
    if (course) return { courseId: course.id, equipmentId: equipmentByName(course.name, equipment)?.id ?? null, durationMin };
  }

  const eq = equipmentByName(name, equipment);
  if (eq?.courseId) return { courseId: eq.courseId, equipmentId: eq.id, durationMin };

  const course = courseByName(name, courses);
  return course
    ? { courseId: course.id, equipmentId: equipmentByName(course.name, equipment)?.id ?? null, durationMin }
    : null;
}
