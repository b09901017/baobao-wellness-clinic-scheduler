// 要貼到 LINE 的那六則話，長什麼樣。純函式。
//
// 她的原話（2026-09-04）：
//
// > 我需要一個地方可以一次修改所有回復的模板，可以放在設定那邊。
//
// 在這之前這六則的字寫死在 `domain/messages.js` 裡，她想把「呦～」改成
// 「喔～」都要改程式。現在字在這裡（預設值）與 `config/app` 的
// `messageTemplates`（她改過的），而 `messages.js` 只負責**算變數**。
//
// ## 為什麼要拆成兩層
//
// 六則裡有五則的變數是**有條件的**：
//
//   - 「問壓好的時間」的 `{slots}` 要先排序、每一筆只取第一個時段的開始時間
//     （她問客戶的是「那天幾點來」，不是把三個療程的時刻表念一遍）
//   - 「來訪前提醒」的 `{when}` 是「明天 9/3」還是「9/3」，看今天是不是前一天
//   - 「收到了」的 `{lines}` 是好幾行，每行前面一顆「・」
//
// 那些判斷一行都不該搬到這裡來，也不該讓她在設定頁上重寫一次。
// 所以：**算變數留在 `messages.js`，排字交給這裡。**
//
// ## 用字不要「順」它
//
// 預設值就是 2026-09-04 之前 `messages.js` 裡那幾句，**一個字都沒有改**
// （含斷行、全形引號與那個「呦～」）。她跟客戶講話就是長這樣，
// 而 `tests/messages.test.js` 逐字盯著。

/**
 * 一則模板最多幾個字。
 *
 * 600 是「她真的會寫多長」的三倍有餘（最長的預設值是 76 字）。
 * 上限存在的理由不是排版，是**別讓一則模板變成一篇文章**貼進 LINE ——
 * 但寧可寬鬆：「存不下去而且看不懂錯在哪」這個坑這個 repo 已經踩過三次
 *（見 `tests/number-fields.test.js` 的檔頭）。
 */
export const MAX_TEMPLATE = 600;

/**
 * 六則。**順序就是設定頁上的順序**，照她一輪裡用到它們的先後：
 * 問時間 → 收到回覆 → 問壓好的時間 → 來訪前提醒 → 臨時空出一格。
 *
 * `vars` 是那一則吃得到的佔位符，設定頁上做成一排點得到的丸子。
 * `hint` 只寫**看不出來的那一件事**（例：`{courses}` 自己帶一個「的」），
 * 看得出來的不要寫 —— 這一頁已經有六個框了。
 */
export const TEMPLATES = [
  {
    id: 'ask',
    label: '問這一輪的時間',
    where: '待辦中心「問這輪的時間」、客戶詳情',
    vars: ['name', 'month'],
    text: '{name}大哥/姐姐\n'
      + '即將幫您安排 {month} 月的課程\n'
      + '請問您 {month} 月有哪幾天不方便呢？',
  },
  {
    id: 'askWithLink',
    label: '問這一輪的時間（附表單連結）',
    where: '同上，產生連結之後換成這一則',
    vars: ['name', 'month', 'link'],
    // 給了連結就**不要再問「哪幾天方便」** —— 那會讓客戶用打字的回你，
    // 於是連結白給了。改成一句「點一點就好」，把動作講清楚。
    hint: '有連結時不要再問「哪幾天不方便」—— 那會讓客戶改用打字回你',
    text: '{name}大哥/姐姐\n'
      + '即將幫您安排 {month} 月的課程\n'
      + '請您點下面這個連結，把 {month} 月\n'
      + '“不方便”的日子都點起來呦～\n'
      + '{link}',
  },
  {
    id: 'received',
    label: '收到他填的時間，回一句',
    where: '收件匣 #/todo/inbox',
    vars: ['name', 'month', 'lines'],
    hint: '{lines} 是系統讀到的每一條限制，一行一條',
    text: '{name}大哥/姐姐\n'
      + '收到了，謝謝您 🙏\n'
      + '記下來的是：\n'
      + '{lines}\n'
      + '我會照這個安排 {month} 月的課程，排好再跟您確認時間。',
  },
  {
    id: 'confirm',
    label: '問壓好的時間可不可以',
    where: '待辦中心「跟客人確認時間」、客戶詳情',
    vars: ['name', 'month', 'slots'],
    hint: '{slots} 是「9/3 14:00、9/17 10:00」，一次來訪只講第一段的時間',
    text: '{name}您好，{month} 月為您安排了 {slots}，請問可以嗎？',
  },
  {
    id: 'reminder',
    label: '來訪前提醒',
    where: '客戶詳情',
    vars: ['name', 'when', 'time', 'courses'],
    hint: '{when} 在前一天會變成「明天 9/3」；{courses} 自己帶一個「的」，沒有課程時整個消失',
    text: '{name}您好，提醒您{when} {time} 有{courses}課程，再麻煩您準時到院，謝謝。',
  },
  {
    id: 'offer',
    label: '臨時空出一格，問誰要補',
    where: '時段反查 #/todo/backfill',
    vars: ['name', 'date', 'range', 'course'],
    hint: '{course} 自己帶一個「的」，沒有課程時整個消失',
    text: '{name}您好，{date} {range} 臨時空出一個{course}時段，請問您方便過來嗎？',
  },
];

const BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

/** 每一個佔位符是什麼意思。設定頁上那一排丸子的 `title`。 */
export const VAR_LABELS = {
  name: '客戶名字',
  month: '月份（數字）',
  link: '表單連結',
  lines: '讀到的限制',
  slots: '壓好的時間',
  when: '哪一天',
  time: '幾點',
  courses: '課程名',
  date: '日期',
  range: '時間範圍',
  course: '課程名',
};

/** 這一則的預設字。認不得的 id 回空字串，不要丟例外 —— 呼叫端只會少一則。 */
export const defaultText = (id) => BY_ID[id]?.text ?? '';

/**
 * 這一則**現在**要用的字。她改過的優先。
 *
 * **存進去的空字串當作沒存過。** 她把一整則刪光再存檔，意思幾乎一定是
 * 「回到預設」而不是「以後這一則產生空白訊息」—— 而空白訊息是她按了複製
 * 才會發現的那一種錯。真的要清空的話，設定頁上有一顆「回復預設」。
 *
 * @param {string} id
 * @param {Record<string, string>} [stored] `config/app` 的 `messageTemplates`
 */
export function textFor(id, stored = {}) {
  const custom = String(stored?.[id] ?? '').trim();
  return custom || defaultText(id);
}

/** 這一則她改過嗎。設定頁上那顆「已改過」的小徽章。 */
export function isCustom(id, stored = {}) {
  const custom = String(stored?.[id] ?? '').trim();
  return Boolean(custom) && custom !== defaultText(id);
}

/**
 * 把 `{name}` 這種佔位符換掉。
 *
 * **認不得的原樣留著。** 她把 `{name}` 打成 `{Name}` 的時候，畫面上要看得到
 * `{Name}` 五個字 —— 換成空字串的話那句話只是少了稱呼，而她不會知道為什麼。
 * 看得到那五個字，她就知道自己打錯了。
 *
 * @param {string} text
 * @param {Record<string, string>} vars
 */
export function fill(text, vars = {}) {
  return String(text ?? '').replace(
    /\{(\w+)\}/g,
    (whole, key) => (key in (vars ?? {}) ? String(vars[key] ?? '') : whole),
  );
}

/**
 * 存檔前的檢查。回訊息陣列，空陣列代表可以存。
 *
 * **只有兩條規則：不可以是空的、不可以太長。**
 *
 * 刻意**不擋「少了某個變數」** —— 她可能真的不想在提醒裡寫日期（自己補），
 * 或者不想在確認訊息裡寫月份。多擋一條她就存不下去，而那是這個 repo
 * 踩過三次的同一個坑：畫面上的限制比 domain 嚴，她看不懂錯在哪。
 *
 * @param {string} id
 * @param {string} text
 * @returns {string[]}
 */
export function validateTemplate(id, text) {
  const errors = [];
  const value = String(text ?? '').trim();
  const label = BY_ID[id]?.label ?? id;

  if (!value) errors.push(`「${label}」是空的 —— 按下複製會得到一則空訊息`);
  else if (value.length > MAX_TEMPLATE) {
    errors.push(`「${label}」太長了（${value.length} 字，最多 ${MAX_TEMPLATE} 字）`);
  }

  return errors;
}

/**
 * 整份存檔前的檢查。
 *
 * @param {Record<string, string>} next 六則的字
 */
export function validateAll(next = {}) {
  return TEMPLATES.flatMap((t) => validateTemplate(t.id, next[t.id]));
}

/**
 * 要寫進 `config/app` 的那一份。**跟預設值一樣的那幾則不存**。
 *
 * 這樣做有兩個好處：之後改預設值時她沒動過的那幾則會跟著更新，
 * 而「已改過」那顆徽章不用另外記一個布林（存第二份一定會對不起來，ADR-0004）。
 */
export function toStored(next = {}) {
  const out = {};
  for (const t of TEMPLATES) {
    const value = String(next[t.id] ?? '').trim();
    if (value && value !== t.text) out[t.id] = value;
  }
  return out;
}
