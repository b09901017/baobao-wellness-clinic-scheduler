// 備忘錄／SOP：她自己整理的流程與心得。純函式，不碰 IO。
//
// 她的原話（2026-09-03）：
//
// > 我可以記錄一些自己的心得或是要注意的事項……像是復健科流程 這個就是屬於
// > 我會習慣的我會漸漸上手的，只需要當下打開備忘錄看就好，不用什麼事前提醒
// > 或是事後提醒……在手機版可一鍵隨時查閱，**不需要變成打勾任務**。
//
// 2026-09-04 她點過第一版之後：
//
// > 不用特地幫我分什麼事前事後，那些全部都給我一個大框框，像是一般的備忘錄
// > app 一樣，只要有標題、掛那個課程，以及很大的輸入框就好。
// > 不需要章節，不需要分類，也不需要多餘的說明。
//
// 所以現在只有三個欄位：**標題、掛哪些課程、一大塊字**。
// 被拿掉的那幾個（章節、時機、分類、釘選）與為什麼可以拿掉，見 ADR-0069。
//
// ## 它跟「隨手記」是兩種東西
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
// 見 docs/adr/0067-a-playbook-is-read-not-ticked.md 與
// docs/adr/0069-a-memo-is-one-box-of-text.md。

const trimmed = (v) => String(v ?? '').trim();

export const MAX_TITLE = 40;

/**
 * 內文的上限。
 *
 * 第一版是 2000，但那時候一份可以有 20 節、每節各 2000 字。現在只有一格，
 * 上限跟著放大才不會變成另一種「存不下去」——
 * 那正是 `tests/number-fields.test.js` 檔頭在講的同一件事。
 */
export const MAX_BODY = 5000;

/**
 * 掛在來訪上的時候先給幾行。
 *
 * 她原本擔心的是洗版（「不用什麼事前提醒或是事後提醒」）。第一版用「時機」
 * 擋，現在用**行數**擋 —— 行數比時機好懂：她看得到自己寫的第幾行會出現在
 * 日曆的卡片上，而時機要她先在腦袋裡跑一次 `whenForVisit()`。
 */
export const PREVIEW_LINES = 4;

/**
 * 存檔前把形狀整理好。
 *
 * `courseIds` 去重；內文只去頭尾的空白，**不逐行 trim** ——
 * 她可能刻意用縮排分層。
 *
 * ## 舊形狀的退路
 *
 * 2026-09-03 到 09-04 之間的那一版存的是 `sections: [{heading, when, body}]`。
 * `playbooks` 這個集合在那之前不存在，所以正式資料裡一筆都沒有 ——
 * 但她自己在本機點過，而那正是她發現這些問題的方式。
 *
 * **只在讀的時候接起來，不自動改寫資料**：她一存檔就自然變成新的形狀。
 */
export function normalize(playbook = {}) {
  return {
    title: trimmed(playbook.title),
    courseIds: [...new Set((playbook.courseIds ?? []).filter(Boolean))],
    // 掛哪幾家合作機構（ADR-0076）。**存字串不存 id** —— 客戶身上存的也是字串
    // （`customer.partners`），比對的兩邊要是同一種東西。課程那一邊存 id 是
    // 因為時段上本來就寫著 `courseId`，兩邊也都是 id。
    partners: [...new Set((playbook.partners ?? []).map(trimmed).filter(Boolean))],
    body: bodyOf(playbook),
  };
}

/** 內文。舊形狀（只有 `sections`）接得起來，節標題自成一行。 */
export function bodyOf(playbook) {
  const body = String(playbook?.body ?? '').trim();
  if (body) return body;

  return (playbook?.sections ?? [])
    .map((s) => [trimmed(s?.heading), String(s?.body ?? '').trim()].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * 存檔前的檢查。回傳訊息陣列，空陣列代表可以存。
 *
 * 前端擋一次、Firestore Rules 再擋一次（SPEC 第 6.7 節）——
 * Rules 那一層只擋型別與大小。
 */
export function validatePlaybook(playbook) {
  const errors = [];
  const p = normalize(playbook);

  if (!p.title) errors.push('要有一個標題');
  else if (p.title.length > MAX_TITLE) errors.push(`標題太長了（最多 ${MAX_TITLE} 字）`);

  if (!p.body) errors.push('內容是空的 —— 這一份打開會什麼都沒有');
  else if (p.body.length > MAX_BODY) errors.push(`內容太長了（最多 ${MAX_BODY} 字）`);

  return errors;
}

/**
 * 內文拆成行。空行丟掉。
 *
 * 閱讀的那一面與掛在來訪上的預覽共用這一支 —— 兩份寫法遲早有一份會把空行
 * 畫成一個空的項目，而那看起來像資料壞了。
 */
export function linesOf(playbook) {
  return bodyOf(playbook)
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim());
}

/**
 * 掛在來訪上時要印的那幾行，以及還剩幾行沒印。
 *
 * @returns {{lines: string[], rest: number}}
 */
export function previewOf(playbook, max = PREVIEW_LINES) {
  const all = linesOf(playbook);
  return { lines: all.slice(0, max), rest: Math.max(0, all.length - max) };
}

/**
 * 一疊卡的順序：**她寫下來的順序，新的在最後面**。
 *
 * 不用「最近改過的在前」（一般備忘錄 app 的作法）：那一疊會在她編輯完之後
 * 自己重排，而卡牌的全部價值就是「我正在看第三張」這件事站得住。
 * 也不用標題排序 —— 那個順序對她沒有意義。
 *
 * `createdAt` 讀不出來的（剛存還沒回填、匯進來的）排最後，
 * 同一批之內維持進來的順序。
 */
export function deckOrder(playbooks = []) {
  return (playbooks ?? [])
    .filter((p) => p && !p.deletedAt)
    .map((p, i) => ({ p, i, at: millisOf(p.createdAt) }))
    .sort((a, b) => (a.at - b.at) || (a.i - b.i))
    .map((x) => x.p);
}

/** Firestore 的 Timestamp、Date、ISO 字串、毫秒數都吃得下。讀不出來回無限大。 */
function millisOf(value) {
  if (value == null) return Number.POSITIVE_INFINITY;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** 搜尋：標題與內文都比。 */
export function matches(playbook, query) {
  const q = trimmed(query).toLowerCase();
  if (!q) return true;
  return [playbook?.title, bodyOf(playbook)]
    .map((x) => String(x ?? '').toLowerCase())
    .some((x) => x.includes(q));
}

/**
 * 這一筆來訪、這一位客戶，掛得到哪幾份備忘錄。
 *
 * 兩種掛法：
 *
 *   課程    比的是**時段的課程**。一天兩段兩個課程就可能掛到兩份
 *   合作機構 比的是**這位客戶掛了哪幾家**（ADR-0076）
 *
 * 同一份只回一次 —— 同一天兩段點滴不該讓同一份出現兩次，一份同時掛了課程
 * 與機構也只畫一塊。
 *
 * 回傳的順序照 `playbooks` 進來的順序，呼叫端要什麼順序自己排。
 *
 * **拿不到客戶時只回課程配到的那幾份**，不要整個回空 ——
 * 少一份提醒比整塊消失好。
 */
export function playbooksFor({ playbooks = [], visit = null, customer = null } = {}) {
  const courseIds = new Set((visit?.slots ?? []).map((s) => s?.courseId).filter(Boolean));
  const partners = new Set((customer?.partners ?? []).map(trimmed).filter(Boolean));
  if (!courseIds.size && !partners.size) return [];

  return (playbooks ?? []).filter((p) => {
    if (!p || p.deletedAt) return false;
    if ((p.courseIds ?? []).some((id) => courseIds.has(id))) return true;
    return (p.partners ?? []).some((name) => partners.has(trimmed(name)));
  });
}

/**
 * 舊的那一支。**留著**是因為它有呼叫端也有測試，而且它就是
 * `playbooksFor()` 的一個薄殼（沒有客戶＝只比課程）。
 */
export function playbooksForVisit(playbooks = [], visit = null) {
  return playbooksFor({ playbooks, visit });
}
