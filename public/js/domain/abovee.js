// Abovee 上的寫法 → app 主檔（issue 12；2026-10-05 abovee-and-master/07 補齊）。純函式。
//
// Abovee 列表右半邊跟 app 主檔講的是同一批東西，寫法不一樣（例子用假名）：
//
// | Abovee 那一格 | 寫的是 | app 主檔 |
// |---|---|---|
// | 服務資源（復能那一列） | 治療師全名 `陳小芳` | 她叫她 `小芳`；`LuLu` 那種全名推不出來的靠「Abovee 上的寫法」 |
// | 服務資源（二返那一列） | 醫師全名 `夏大同` | 醫師只有姓 `夏` |
// | 服務資源（ILIB 那一列） | 機器＋房間 `I1點10` | 診間 `點滴10` |
// | 服務資源（點滴那一列） | 房間 `點滴5`、`點滴8A`、`4樓休2` | 診間 `點滴5`、`點滴8`、`VIP2` |
// | 診間 | `治療室5`、`點滴室10`、`點滴室8床A`、`休息室3` | `治5`、`點滴10`、`點滴8`、`VIP3` |
// | 課程 | `SIS 60`、`ILIB 60`、`EECP60`、`二返60`、`腸道修復`、`三返30`、`任選60` | 器材、課程、品項，分鐘另外算 |
//
// **主檔上的「Abovee 上的寫法」（`aboveeNames`）先比**：課程、器材、營養點滴品項、診間、治療師與醫師
// 都有那一格，她在設定頁改得動（2026-10-05：「也可以記錄abovee怎麼寫的…之後都還要能改」）。
// 寫法跟著那一筆走，所以她把「高能量雷射」改名之後 `高能量60` 照樣認得 —— 這是寫在主檔上、
// 不寫死在這裡的理由。人名的寫法**只能**活在她的主檔上（真名不進 repo）。
//
// **認不出來一律 null，不猜**。符合的有好幾位也是 null —— 挑一位就是把一段時間記到別人身上，
// 而畫面上看起來是認得的（同 ADR-0103 的判斷）。

import {
  DOCTOR_ROLE, THERAPIST_ROLE, hasAlias, isUncounted, normalizeAlias, oneCharOff, picksDoctor,
} from './masterData.js';
import { SHEET_COURSE_ALIASES, rowShape } from './legacyImport.js';
import { EQUIPMENT_ALIASES, FLYER_COURSE_ALIASES } from './photoPlan.js';
import { isFollowupCourse } from './followups.js';
import { MAX_NTH, MIN_NTH, nthLabel } from './nthFollowup.js';

const live = (rows) => (rows ?? []).filter((r) => r && !r.deletedAt && r.active !== false);
const squash = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '');
const same = (a, b) => Boolean(squash(a)) && squash(a).toLowerCase() === squash(b).toLowerCase();

/** 全名、別稱、Abovee 上的寫法其中一個對得上。 */
const named = (row, text) => same(row.name, text) || (row.shortName && same(row.shortName, text)) || hasAlias(row, text);

// ---------- 治療師與醫師 ----------

/**
 * 服務資源那一格的人名 → 治療師或醫師。
 *
 * 1. 主檔上記住的「Abovee 上的寫法」（`aboveeNames`）完全相同 → 那一位
 * 2. 否則：**治療師的名字是全名的結尾**（陳小芳 → 小芳）、**醫師的姓是全名的開頭**（夏大同 → 夏），
 *    而且只有一位符合
 *
 * **知道這一列要哪一種人時只在那一種人裡找**（`role`，`staffRoleFor()` 算）：復能那一列的治療師
 * 姓李、醫師也有一位「李」的話，兩條規則都符合 → 以前兩位都符合就放棄（她那 353 筆裡有 29 筆是這樣）。
 * 不知道時（`role` 是 null）照舊兩種都找。
 *
 * 3. 上面兩條都沒有人、**而且知道這一列要哪一種人**：同一個角色裡，她記著的寫法跟照片上的字差一個字
 *    （`oneCharOff()`，ADR-0128）、而且只有一位 → 那一位。不知道角色（認不出課程）就不放寬 —— 治療師與醫師一起比的話，
 *    差一個字的那一位可能是另一種人。**結尾／開頭那兩條不放寬** —— 兩個字的名字差一個字就是一半
 *
 * @param {{role?: string|null}} [o]
 * @returns {object|null}
 */
export function staffFrom(text, staff = [], { role = null } = {}) {
  const s = normalizeAlias(text);
  if (!s) return null;
  const pool = live(staff).filter((x) => !role || x.role === role);

  const byAlias = pool.filter((x) => hasAlias(x, s));
  if (byAlias.length) return byAlias.length === 1 ? byAlias[0] : null;

  const hits = pool.filter((x) => {
    const n = normalizeAlias(x.name);
    if (!n) return false;
    if (x.role === DOCTOR_ROLE) return s.startsWith(n);
    if (x.role === THERAPIST_ROLE) return s.endsWith(n);
    return false;
  });
  if (hits.length) return hits.length === 1 ? hits[0] : null;

  if (!role) return null;
  const near = pool.filter((x) => (x.aboveeNames ?? []).some((a) => oneCharOff(s, normalizeAlias(a))));
  return near.length === 1 ? near[0] : null;
}

/**
 * 這一列（`courseFrom()` 認出來的那一門課）的服務資源寫的是哪一種人。
 * 課程要治療師而不用醫師 → 治療師；要醫師而不用治療師 → 醫師；兩種都要、兩種都不要、認不出課程 → null（兩種都找）。
 *
 * 看的是課程本身的 `assigns`，不是 `assignsFor()`：擇一池還沒選器材時那一支回 null，
 * 但 `任選60` 那一列寫的照樣是治療師。
 */
export function staffRoleFor(course, { courses = [] } = {}) {
  const row = course ? (courses ?? []).find((c) => c.id === course.courseId) : null;
  if (!row) return null;
  const therapist = row.assigns === 'therapist';
  const doctor = picksDoctor(row);
  if (therapist === doctor) return null;
  return therapist ? THERAPIST_ROLE : DOCTOR_ROLE;
}

/**
 * 她替認不出來的寫法選了人 → 要寫進治療師主檔的那幾筆（issue 13 存檔時一起寫）。
 *
 * 本來就認得的（結尾規則、已經記著）不寫；**那個寫法已經是別人的也不寫** ——
 * 兩位不可以同一個寫法（`validators.staff()`）。
 *
 * 「本來就認得」問的是**不分角色**的那一次：只有分了角色才認得的（復能那一列的「李小芳」），
 * 換到一列認不出課程的就又認不得了，所以她選過一次就記下來。
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
    if (pool.some((x) => hasAlias(x, t))) continue;

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

/**
 * Abovee 的房間寫法 → 主檔的全名。
 *
 * `休息室N`（診間那一格）與 `4樓休N`（點滴那一列的服務資源）都是 VIP 那幾間 ——
 * 2026-09-08 她把那一層叫 VIP（`seed.js` 的診間清單）。
 */
const ROOM_WORDS = [
  [/^治療室(\d+)$/, '治$1'],
  [/^點滴室(\d+)$/, '點滴$1'],
  [/^VIP室(\d+)$/i, 'VIP$1'],
  [/^休息室(\d+)$/, 'VIP$1'],
  [/^4樓休(\d+)$/, 'VIP$1'],
];

/** 房號後面的床位（`點滴室8床A`、`點滴8B`、`4樓休7a`）。 */
const BED = /^(.*\d)床?([AB])$/i;

/**
 * 一格房間的字 → 診間。
 *
 * 床位那幾間 2026-10-06 起是各自的診間（點滴8A／8B、VIP7A／7B，ADR-0127），所以順序是：
 *
 * 1. 她記在主檔上的寫法（`aboveeNames`）—— 照舊最優先
 * 2. **帶著床位比**：`點滴室8床A`／`點滴8A` → 點滴8A
 * 3. 對不到才**拿掉床位**再比：還沒按資料健檢、主檔上只有「點滴8」的資料庫照舊認得；別間寫了床位的也是
 * 4. 還是沒有 → **停用的那幾間**裡找（不含刪掉的）。點滴8、VIP7 是「沒選床位」的那一間，
 *    她：「abovee辨識可以不選床位，沒選床位就寫.8，VIP7等等不要留空」—— 那一格沒寫床時認成它，不是 null
 */
function roomByText(text, rooms) {
  const raw = squash(text);
  if (!raw) return null;
  const pool = live(rooms);
  // 她記在主檔上的寫法先比（同一種主檔裡不會重複，`validators.rooms()` 擋）
  const byAlias = pool.filter((r) => hasAlias(r, raw));
  if (byAlias.length) return byAlias.length === 1 ? byAlias[0] : null;

  const word = (s) => {
    for (const [re, to] of ROOM_WORDS) if (re.test(s)) return s.replace(re, to);
    return s;
  };
  const named = (list, s) => list.find((r) => same(r.name, s) || (r.shortName && same(r.shortName, s))) ?? null;
  const m = raw.match(BED);
  const bare = word(m ? m[1] : raw);
  const retired = (rooms ?? []).filter((r) => r && !r.deletedAt && r.active === false);
  return (m ? named(pool, `${bare}${m[2].toUpperCase()}`) : null)
    ?? named(pool, bare)
    ?? named(retired, bare);
}

/**
 * 診間那一格（`治療室5`）→ 診間；那一格空著或認不出來，就看服務資源裡的房間部分
 * （ILIB 那一列寫 `I1點10`、`I2治2`：前面是機器、後面是房間），再不然整格就是房間
 * （營養點滴那一列寫 `點滴5`、`4樓休2`）。
 *
 * @returns {object|null}
 */
export function roomFrom(roomText, resourceText, rooms = []) {
  const direct = roomByText(roomText, rooms);
  if (direct) return direct;
  const m = squash(resourceText).match(/^I\d+(點|治)(\d+)$/i);
  if (m) return roomByText(`${m[1] === '點' ? '點滴' : '治'}${m[2]}`, rooms);
  return roomByText(resourceText, rooms);
}

// ---------- 課程 ----------

function equipmentByName(name, equipment) {
  const s = squash(name);
  const full = EQUIPMENT_ALIASES[s] ?? EQUIPMENT_ALIASES[s.toUpperCase()] ?? s;
  return live(equipment).find((e) => named(e, s) || same(e.name, full) || (e.shortName && same(e.shortName, full))) ?? null;
}

function courseByName(name, courses) {
  const s = squash(name);
  const want = FLYER_COURSE_ALIASES[s] ?? SHEET_COURSE_ALIASES[s] ?? s;
  return live(courses).find((c) => named(c, s) || same(c.name, want) || (c.shortName && same(c.shortName, want))) ?? null;
}

/** 要選品項的那一門課（營養點滴）。不只一門就說不出是哪一門 → null。 */
function ivCourseOf(courses) {
  const hits = live(courses).filter((c) => c.requiresIvProduct);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 寫死的兩個字之一：`三返`、`四返`…… → n返（ADR-0063）。**它不是主檔**：n返 借二返的課程，
 * 時段上沒有額度（`nthFollowup.js`），所以主檔上沒有一筆可以記「三返」這個寫法。
 * 名字走 `nthLabel()`（全站叫它的那一支）。回第幾返，不是就 null。
 */
function nthOf(name) {
  const s = squash(name);
  for (let n = MIN_NTH; n <= MAX_NTH; n += 1) if (s === nthLabel(n)) return n;
  return null;
}

/**
 * 課程那一格 → 這一段做什麼。
 *
 * 順序（越具體越先；同一種主檔裡不會有兩筆同一個寫法，`validate()` 擋）：
 *
 * 1. **整格原字**比主檔的 Abovee 寫法：品項 → 器材 → 課程。要在拆數字之前 ——
 *    `EECP20` 是 EECP 體驗那一門課，拆成「EECP＋20 分」就認成正式課了（她 10/5 答過）
 * 2. 拆成「名字＋結尾的數字」，名字依序比**品項**（→ 要選品項的那一門課，品項帶著）、
 *    **器材**（→ 它算哪一門課，ADR-0075）、**課程**。每一種都比全名、別稱、Abovee 寫法
 * 3. 寫死的那個字：`三返`（`nthOf()`）→ n返，借二返的課程
 * 4. 舊表的寫法（`rowShape()`：`任選(60)` → 復能池、還沒選哪一台）
 * 5. **前面都認不出來**才比「差一個字」（`nearFrom()`，ADR-0128）：結果多一格 `near`（照片上的原字、認成哪一筆），
 *    確認層講出來。本來認得的一筆都不會走到這裡
 *
 * `durationMin` 是結尾的數字（整格對上的是 null —— 那個數字是名字的一部分）：
 * 挑額度時 `SIS 30` 與 `SIS 60` 是兩筆、二返約的時候選 30 或 60（ADR-0122）都讀它。
 *
 * **器材欄一律帶著**同名的那一台（`ILIB 60` → eq-ilib）：四選一那一筆額度要知道選的是哪一台，
 * 單買 ILIB 的用不到它。
 *
 * @param {string} text
 * @param {{courses?: object[], equipment?: object[], ivProducts?: object[]}} master
 * @returns {{courseId: string, equipmentId: string|null, ivProductId: string|null,
 *            durationMin: number|null, nth: number|null, uncounted: boolean}|null}
 *   `nth`：n返 的第幾返（只有 `三返` 那種寫法有）；`uncounted`：那門課不算次數（ADR-0121）
 */
export function courseFrom(text, { courses = [], equipment = [], ivProducts = [] } = {}) {
  const s = String(text ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!s) return null;

  const result = (course, { equipmentId, ivProductId = null, durationMin = null, nth = null } = {}) => (course ? {
    courseId: course.id,
    equipmentId: equipmentId !== undefined ? equipmentId : (equipmentByName(course.name, equipment)?.id ?? null),
    ivProductId,
    durationMin,
    nth,
    uncounted: !nth && isUncounted(course),
  } : null);
  const byEquipment = (eq, durationMin) => {
    const course = eq?.courseId ? live(courses).find((c) => c.id === eq.courseId) : null;
    return course ? result(course, { equipmentId: eq.id, durationMin }) : null;
  };
  const byIv = (iv, durationMin) => (iv ? result(ivCourseOf(courses), { equipmentId: null, ivProductId: iv.id, durationMin }) : null);

  // 1. 整格原字 × Abovee 上的寫法
  const whole = squash(s);
  const hit = byIv(live(ivProducts).find((p) => hasAlias(p, whole)), null)
    ?? byEquipment(live(equipment).find((e) => hasAlias(e, whole)), null)
    ?? result(live(courses).find((c) => hasAlias(c, whole)), {});
  if (hit) return hit;

  // 2. 名字＋結尾的數字
  const m = s.match(/^(.*?\D)\s*(\d+)\s*(?:mins?|分鐘?)?$/i);
  const name = (m ? m[1] : s).trim();
  const durationMin = m ? Number(m[2]) : null;

  const found = byIv(live(ivProducts).find((p) => named(p, name)), durationMin)
    ?? byEquipment(equipmentByName(name, equipment), durationMin)
    ?? result(courseByName(name, courses), { durationMin });
  if (found) return found;

  // 3. 三返
  const nth = nthOf(name);
  if (nth) {
    const followup = live(courses).find((c) => isFollowupCourse(c.id, live(courses)));
    return result(followup, { equipmentId: null, durationMin, nth });
  }

  // 4. 舊表的寫法
  const shape = rowShape(durationMin ? `${name}(${durationMin})` : name);
  const old = (shape?.only && byEquipment(equipmentByName(shape.only, equipment), durationMin))
    || (shape?.kind === 'single' && result(courseByName(shape.course, courses), { durationMin }))
    // 沒指定哪一台的池（`任選(60)`）：課程照池，器材留給她選
    || (shape?.kind === 'pool' && result(courseByName(shape.course, courses), { equipmentId: null, durationMin }))
    || null;
  if (old) return old;

  // 5. 差一個字
  return nearFrom({ text: s, whole, name, durationMin }, { courses, equipment, ivProducts }, { result, byEquipment, byIv });
}

/**
 * 課程那一格前四步都認不出來 → 差一個字的那一筆（ADR-0128）。她 10/6：「圖片辨識參考中的內容應該有助於辨識更準確」。
 *
 * 拿名字的部分（拆掉分鐘的）與整格原字去比主檔的全名、別稱、Abovee 寫法，**照「品項 → 器材 → 課程」一種一種看**：
 * 那一種主檔裡剛好一筆符合就用它、不再往下看；兩筆以上 → null（不猜）。不跨種一起數 ——
 * `ILIB` 同時是器材與課程的名字，一起數的話最常見的那一種反而永遠是兩筆。
 * 太短的不放寬（`oneCharOff()`：`二返`／`三返`、`SIS`／`IN`）。
 */
function nearFrom({ text, whole, name, durationMin }, { courses, equipment, ivProducts }, { result, byEquipment, byIv }) {
  const part = normalizeAlias(name);
  const cell = normalizeAlias(whole);
  /** 這一筆的哪一個名字差一個字：名字的部分對上 → 帶分鐘；整格對上 → 不帶（那個數字是名字的一部分） */
  const hitOf = (row) => {
    const names = [row.name, row.shortName, ...(row.aboveeNames ?? [])].map(normalizeAlias).filter(Boolean);
    if (names.some((n) => oneCharOff(part, n))) return { minutes: durationMin };
    if (cell !== part && names.some((n) => oneCharOff(cell, n))) return { minutes: null };
    return null;
  };
  const kinds = [
    [live(ivProducts), (row, m) => byIv(row, m)],
    [live(equipment), (row, m) => byEquipment(row, m)],
    [live(courses), (row, m) => result(row, { durationMin: m })],
  ];
  for (const [rows, build] of kinds) {
    const hits = rows.map((row) => ({ row, hit: hitOf(row) })).filter((x) => x.hit);
    if (!hits.length) continue;
    if (hits.length > 1) return null;
    const [{ row, hit }] = hits;
    const out = build(row, hit.minutes);
    // 照片上的原字（整格）與認成哪一筆 —— 確認層講出來（`aboveeImport.js` 的 `nearSay()`）
    return out ? { ...out, near: { seen: text, as: row.name } } : null;
  }
  return null;
}
