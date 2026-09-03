// 備忘錄／SOP：她自己整理的流程與心得。純函式，不碰 IO。
//
// 她的原話：
//
// > 我可以記錄一些自己的心得或是要注意的事項……像是復健科流程 這個就是屬於
// > 我會習慣的我會漸漸上手的，只需要當下打開備忘錄看就好，不用什麼事前提醒
// > 或是事後提醒……在手機版可一鍵隨時查閱，**不需要變成打勾任務**。
//
// ## 它跟「隨手記」是兩種東西
//
// `CONTEXT.md` 的「隨手記」原本把「備忘錄」列在 `_Avoid_` 裡，
// 2026-09-03 她決定拿掉那一項並在兩個詞條上各寫一行界線：
//
//   隨手記   客人臨時說的一件小事，會被勾掉，掛了日期就上日曆，選填綁客戶
//   備忘錄   她自己整理的一段流程，不會消失，不上日曆，綁**課程**不綁人
//
// ## 它綁課程不綁人
//
// 綁客戶的東西已經有三種了（永久限制、備註、隨手記），第四種只會讓她每次
// 都要想一下該記在哪裡。而「點滴要注意什麼」對每一位客人都一樣 ——
// 不一樣的那些是臨床提醒（ADR-0064）。
//
// ## 一節可以標「時機」，那是這一整支唯一系統看得懂的東西
//
// 其餘全部是給人讀的字。標了時機的那一節會在她真的在做那件事的時候自己
// 浮出來（`ui/components/playbookHint.js`）—— 那就是「飯後打針該何時提醒」
// 的答案：不多開一張要勾的東西。
//
// 見 docs/adr/0067-a-playbook-is-read-not-ticked.md。

const trimmed = (v) => String(v ?? '').trim();

/**
 * 一節是什麼時候要看的。**`null` 是預設**（隨時看）。
 *
 * 這四個不是我們發明的分段，是她自己的筆記本來就有的結構
 *（點滴那一份寫成「前情提醒／當天／結束」）。
 */
export const SECTION_WHEN = [
  { id: 'before', label: '事前' },
  { id: 'onday', label: '當天' },
  { id: 'after', label: '結束後' },
  { id: null, label: '隨時看' },
];

const WHEN_IDS = new Set(SECTION_WHEN.map((w) => w.id));

/** 時機 id → 那兩個字。認不得的當成「隨時看」，不要印一個空白。 */
export function whenLabel(id) {
  return (SECTION_WHEN.find((w) => w.id === (id ?? null)) ?? SECTION_WHEN[3]).label;
}

export const MAX_TITLE = 40;
export const MAX_TAG = 12;
export const MAX_HEADING = 20;
export const MAX_BODY = 2000;
/** 一份最多幾節。再多她自己也翻不完，而那時候該拆成兩份。 */
export const MAX_SECTIONS = 20;

/** 沒有分類的那一組。**刻意不叫「其他」** —— 那三個字在待辦與回顧上另有意思。 */
export const NO_TAG = '沒有分類';

/** 一節的空白起點。加一節時用。 */
export const BLANK_SECTION = Object.freeze({ heading: '', when: null, body: '' });

function normalizeSection(section) {
  const when = section?.when ?? null;
  return {
    heading: trimmed(section?.heading),
    when: WHEN_IDS.has(when) ? when : null,
    // 內文不 trim 每一行，只去頭尾：她可能刻意用縮排分層。
    body: String(section?.body ?? '').trim(),
  };
}

/**
 * 存檔前把形狀整理好。
 *
 * **空字串一律變成 `null`**（`tag`）—— Firestore 上「沒有分類」與「分類是空字串」
 * 是兩回事，而後者會在清單上長出一個沒有名字的群組（同 ADR-0044 對隨手記
 * `date` 的判斷）。
 *
 * 整節都空白的丟掉：她加了一節又沒填，存進去只會在閱讀頁上留一塊空的。
 */
export function normalize(playbook = {}) {
  const sections = (playbook.sections ?? [])
    .map(normalizeSection)
    .filter((s) => s.heading || s.body);

  return {
    title: trimmed(playbook.title),
    tag: trimmed(playbook.tag) || null,
    courseIds: [...new Set((playbook.courseIds ?? []).filter(Boolean))],
    sections,
    pinned: playbook.pinned === true,
  };
}

/**
 * 存檔前的檢查。回傳訊息陣列，空陣列代表可以存。
 *
 * 前端擋一次、Firestore Rules 再擋一次（SPEC 第 6.7 節）——
 * Rules 那一層只擋型別與大小，逐節的內容在這裡。
 */
export function validatePlaybook(playbook) {
  const errors = [];
  const p = normalize(playbook);

  if (!p.title) errors.push('要有一個標題');
  else if (p.title.length > MAX_TITLE) errors.push(`標題太長了（最多 ${MAX_TITLE} 字）`);

  if (p.tag && p.tag.length > MAX_TAG) {
    errors.push(`分類太長了（最多 ${MAX_TAG} 字）。分類是用來分組的，長的那種寫進標題`);
  }

  if (!p.sections.length) errors.push('至少要寫一節，不然這一份打開是空的');
  if (p.sections.length > MAX_SECTIONS) {
    errors.push(`最多 ${MAX_SECTIONS} 節（現在有 ${p.sections.length} 節）。再多的話拆成兩份比較翻得完`);
  }

  p.sections.forEach((s, i) => {
    const at = `第 ${i + 1} 節`;
    if (s.heading.length > MAX_HEADING) errors.push(`${at}：標題太長了（最多 ${MAX_HEADING} 字）`);
    if (s.body.length > MAX_BODY) errors.push(`${at}：內容太長了（最多 ${MAX_BODY} 字）`);
    if (!s.body) errors.push(`${at}：只有標題沒有內容`);
  });

  return errors;
}

/**
 * 一節的內文拆成行。空行丟掉。
 *
 * 閱讀頁與「自己浮出來」那一塊共用這一支 —— 兩份寫法遲早有一份會把空行
 * 畫成一個空的項目符號，而那看起來像資料壞了。
 */
export function linesOf(section) {
  return String(section?.body ?? '')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim());
}

/**
 * 清單依分類分組。
 *
 * **釘選的排在最前面**，而且是**跨分類**的一組 —— 她釘起來的意思是
 * 「這一份我常看」，不是「這一份在它那一類裡比較重要」。
 *
 * 沒有分類的收在最後一組，抬頭 `NO_TAG`。
 *
 * @param {object[]} playbooks
 * @returns {{tag: string, pinned: boolean, rows: object[]}[]}
 */
export function groupByTag(playbooks = []) {
  const alive = (playbooks ?? []).filter((p) => p && !p.deletedAt);
  const pinned = alive.filter((p) => p.pinned);
  const rest = alive.filter((p) => !p.pinned);

  const groups = new Map();
  for (const p of rest) {
    const tag = trimmed(p.tag) || NO_TAG;
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag).push(p);
  }

  const byTitle = (a, b) => String(a.title ?? '').localeCompare(String(b.title ?? ''), 'zh-Hant');
  const out = [...groups.entries()]
    .map(([tag, rows]) => ({ tag, pinned: false, rows: rows.slice().sort(byTitle) }))
    // 沒有分類的永遠最後，其餘照分類名
    .sort((a, b) => {
      if (a.tag === NO_TAG) return 1;
      if (b.tag === NO_TAG) return -1;
      return a.tag.localeCompare(b.tag, 'zh-Hant');
    });

  return pinned.length
    ? [{ tag: '常看的', pinned: true, rows: pinned.slice().sort(byTitle) }, ...out]
    : out;
}

/** 現有的分類，去重、照筆數多的在前。編輯時做成可以點的丸子。 */
export function tagsOf(playbooks = []) {
  const counts = new Map();
  for (const p of playbooks ?? []) {
    const tag = trimmed(p?.tag);
    if (!tag || p.deletedAt) continue;
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
}

/** 搜尋：標題、分類、每一節的標題與內文都比。 */
export function matches(playbook, query) {
  const q = trimmed(query).toLowerCase();
  if (!q) return true;
  const hay = [
    playbook?.title,
    playbook?.tag,
    ...(playbook?.sections ?? []).flatMap((s) => [s.heading, s.body]),
  ].map((x) => String(x ?? '').toLowerCase());
  return hay.some((x) => x.includes(q));
}

/**
 * 這一筆來訪掛得到哪幾份備忘錄。
 *
 * 比的是**時段的課程**：一天兩段兩個課程就可能掛到兩份，各自畫一塊。
 * 同一份只回一次 —— 同一天兩段點滴不該讓同一份備忘錄出現兩次。
 *
 * 回傳的順序照 `playbooks` 進來的順序，呼叫端要什麼順序自己排。
 */
export function playbooksForVisit(playbooks = [], visit = null) {
  const courseIds = new Set((visit?.slots ?? []).map((s) => s?.courseId).filter(Boolean));
  if (!courseIds.size) return [];
  return (playbooks ?? []).filter(
    (p) => p && !p.deletedAt && (p.courseIds ?? []).some((id) => courseIds.has(id)),
  );
}

/**
 * 這一筆來訪**現在**該看哪一節。
 *
 * | 那一筆 | 看哪一節 |
 * |---|---|
 * | 日期在今天之後 | `before` |
 * | 日期就是今天 | `onday` —— **不管狀態還是不是待確認**，人已經要來了 |
 * | 日期過了，或已完成／未到 | `after` |
 *
 * 判斷放在 domain 而不是各自的畫面裡：兩個入口問的是同一句話，而同一筆
 * 來訪在兩個畫面浮出不同的一節，她不會知道哪個算數
 *（同 ADR-0028、ADR-0043 的理由）。
 *
 * 日期讀不出來時回 `null`（不浮任何一節）—— **不要猜一個**。
 * 猜錯的代價是她照著「結束後」那一節去做一件還沒發生的事。
 */
export function whenForVisit(visit, today) {
  const date = trimmed(visit?.date);
  if (!date || !trimmed(today)) return null;
  if (['done', 'no_show'].includes(visit?.status)) return 'after';
  if (date > today) return 'before';
  if (date === today) return 'onday';
  return 'after';
}

/**
 * 一份備忘錄裡該浮出來的那一節。
 *
 * 找不到那個時機的節就回 `null`，**不要退回第一節** —— 退回去的那一節
 * 講的是別的時候的事，而她不會知道自己看的是哪一段。
 */
export function sectionFor(playbook, when) {
  if (!when) return null;
  return (playbook?.sections ?? []).find((s) => (s?.when ?? null) === when) ?? null;
}

/**
 * 一份備忘錄有哪幾種時機，照 `SECTION_WHEN` 的順序。清單上那一行摘要用。
 * 一節時機都沒標的回 `['隨時看']`。
 */
export function whensOf(playbook) {
  const have = new Set((playbook?.sections ?? []).map((s) => s?.when ?? null));
  return SECTION_WHEN.filter((w) => have.has(w.id)).map((w) => w.label);
}
