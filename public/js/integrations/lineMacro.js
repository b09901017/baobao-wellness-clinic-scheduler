// 打開一位客戶的 LINE 對話：交給她手機上的 MacroDroid（ADR-0157）。
//
// ## 為什麼要繞一個巨集
//
// LINE 沒有「用名字打開跟某位好友的對話」的網址；`line.me/R/ti/p/~ID` 要客人開放 ID 搜尋、
// 或她一位一位去要加好友的連結 —— 她不想要（2026-10-19：「我不想要還要每個客戶問邀請連結或lineid」）。
// 所以客戶身上的 LINE 那一格存的是**她 LINE 好友清單上看到的名字**，打開對話的那幾下
// （開 LINE → 搜尋 → 點那個人 → 聊天 → 貼上訊息）交給 MacroDroid 的「UI 互動」去點。
//
// ## 怎麼叫到它
//
// MacroDroid 的 **HTTP Server Request** 觸發條件在手機上開一個本機伺服器：
// `http://127.0.0.1:<port>/line?name=…&msg=…`，參數寫進巨集的兩個區域變數。
// **不走 Webhook**（`trigger.macrodroid.com`）：那一條經過別人的雲端，客戶的名字與訊息會送出手機。
//
// - **`msg` 一律帶**，沒有訊息就是空字串：巨集的區域變數兩次執行之間會留著，沒帶的話上一位的
//   確認訊息會被貼進這一位的對話。巨集照 `msg` 是不是空的決定停在「聊天」那一步還是接著貼上
// - **巨集永遠不按送出**：同名的好友會點錯人，她看一眼對話上方的名字才自己按
// - 開關記在**這一台裝置**（同主題，ADR-0055）：只有她的 Android 手機裝了 MacroDroid，
//   iPad 與電腦走「複製＋打開 LINE 的聊天清單」那條退路，也**一次都不敲本機的門**
//   （不然 Chrome 會在一台沒有 MacroDroid 的裝置上跳「區域網路」的權限）
//
// 手機上那個巨集怎麼設、path 與變數叫什麼：`docs/MacroDroid設定.md`。**這裡的 `MACRO_PATH`、
// `name`／`msg` 跟那份文件講的是同一件事，改一邊要改另一邊。**
//
// ## 這一支不 import 畫面
//
// 提醒由呼叫端傳 `notify` 進來（`ui/toast.js` 在 node 裡 import 不起來），剪貼簿、開視窗、
// `fetch`、`localStorage` 都可以從 `deps` 換掉 —— 單元測試叫得到整條路（`tests/line-macro.test.js`）。

/** 記在這一台裝置的 key。 */
export const LINE_MACRO_KEY = 'scheduler.lineMacro';

/** MacroDroid 的 HTTP Server 預設的連接埠。 */
export const DEFAULT_PORT = 8080;

/** 觸發條件上填的 path。 */
export const MACRO_PATH = 'line';

/** 退路：LINE 的聊天清單（她在那裡按搜尋貼上）。 */
export const LINE_CHATS_URL = 'https://line.me/R/nv/chat';

/**
 * 等 MacroDroid 回應多久。**要長**：Chrome 第一次叫本機位址時會跳「允許存取區域網路裝置」，
 * fetch 停在那個框上等她按；短了的話逾時一到她還沒按完。逾時也**不接著開 LINE** —— 開了就蓋在框上面。
 */
export const NO_REPLY_MS = 15000;

/**
 * 「試一次」送的訊息：**跟真的一樣長、有好幾段**。一次驗三件事 —— 叫得到、中文沒變亂碼、
 * 換行留著；也驗網址參數裝得下一則真的確認訊息那麼長的字。
 */
export const TEST_MESSAGE = [
  '這是暴富日常的測試訊息，用來確認 MacroDroid 收得到、中文沒有變成亂碼。',
  '第二段：這一行跟上一段之間空了一行的話，換行就有留著。真的確認訊息常常有好幾段、一兩百個字，所以這一則故意寫得長一點，看看整段是不是都貼得進去。',
  '第三段：看到這裡就代表整段都貼上了。這一則不會自己送出，看完刪掉就好。',
].join('\n\n');

const trimmed = (v) => String(v ?? '').trim();

/** 連接埠：1–65535 的整數，不是就 null。 */
export function portOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

/**
 * 叫巨集的網址。用 `encodeURIComponent` 不用 `URLSearchParams`：後者把空白編成 `+`，
 * 而巨集那一側解不解 `+` 沒有把握 —— `%20` 兩種解法都對。
 */
export function macroUrl({ port, name, msg = '' }) {
  const q = `name=${encodeURIComponent(trimmed(name))}&msg=${encodeURIComponent(String(msg ?? ''))}`;
  return `http://127.0.0.1:${port}/${MACRO_PATH}?${q}`;
}

const DEFAULTS = Object.freeze({ on: false, port: DEFAULT_PORT });

/** `localStorage` 本身在擋掉網站資料時一碰就丟例外。 */
function localStore() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 這一台的設定。讀不到（無痕、擋掉、壞掉）就是沒開。 */
export function readLineMacro(storage = localStore()) {
  try {
    const raw = JSON.parse(storage?.getItem(LINE_MACRO_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
    return { on: raw.on === true, port: portOf(raw.port) ?? DEFAULT_PORT };
  } catch {
    return { ...DEFAULTS };
  }
}

/** 存這一台的設定。存不進去回 false（呼叫端講一句）。 */
export function saveLineMacro(prefs, storage = localStore()) {
  try {
    storage.setItem(LINE_MACRO_KEY, JSON.stringify({
      on: prefs?.on === true,
      port: portOf(prefs?.port) ?? DEFAULT_PORT,
    }));
    return true;
  } catch {
    return false;
  }
}

/** 瀏覽器裡的那幾樣。測試整份換掉。 */
function browserDeps() {
  return {
    storage: localStore(),
    fetch: (...args) => globalThis.fetch(...args),
    copy: (text) => globalThis.navigator.clipboard.writeText(text),
    // 不帶 `noopener`：帶了 `window.open` 一律回 null，分不出是不是被擋。開了再把 opener 拿掉
    open: (url) => {
      const w = globalThis.open?.(url, '_blank');
      if (w) w.opener = null;
      return Boolean(w);
    },
    timeoutMs: NO_REPLY_MS,
  };
}

/** 一律回 Promise<boolean>：剪貼簿 API 沒有、被擋、丟例外都是 false。 */
function copyText(d, text) {
  try {
    return Promise.resolve(d.copy(text)).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * 敲一次本機的門。`'macro'`（有回應）、`'unreached'`（被拒：沒開、被系統砍掉、Chrome 擋下來）、
 * `'no-reply'`（等太久）。
 *
 * **有回應不代表巨集跑了**：`no-cors` 拿不到狀態碼，手機上任何一個伺服器回應都算（path 打錯也算）。
 * 那一半交給設定頁的「試一次」。
 */
async function knock(d, url) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  // 先 resolve 再 abort：abort 讓 fetch reject，那一圈不可以搶在「沒回應」前面
  const late = new Promise((resolve) => {
    timer = setTimeout(() => { resolve('no-reply'); ctrl?.abort(); }, d.timeoutMs);
  });
  let sent;
  try {
    sent = Promise.resolve(d.fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl?.signal }))
      .then(() => 'macro', () => 'unreached');
  } catch {
    sent = Promise.resolve('unreached');
  }
  try {
    return await Promise.race([sent, late]);
  } finally {
    clearTimeout(timer);
  }
}

const NO_NAME = '還沒填 LINE 名字：客戶詳情 → 名字旁邊的「編輯」→「LINE 名字」那一格';
const UNREACHED = '叫不到 MacroDroid（它要開著，Chrome 要允許「區域網路」）。';
const NO_REPLY = 'MacroDroid 沒回應：觸發條件的「傳送回應（Send Response）」有勾嗎？';

/** 退路：開 LINE 的聊天清單＋複製。剪貼簿先叫（按下去的那一刻還在），開視窗緊接著，不等剪貼簿。 */
async function fallback(d, name, msg, msgCopied, lead = '') {
  const copied = msg ? msgCopied : copyText(d, name);
  const opened = d.open(LINE_CHATS_URL);
  const ok = await copied;

  const what = msg
    ? `${ok ? '訊息已複製' : '訊息沒複製到（到訊息框長按複製）'}；在 LINE 搜尋「${name}」，打開對話貼上`
    : (ok ? `已複製「${name}」：到 LINE 的搜尋貼上` : `到 LINE 搜尋「${name}」`);
  return `${lead}${opened ? '' : '沒辦法幫你打開 LINE，請自己打開。'}${what}`;
}

/**
 * 打開這位客戶的 LINE 對話。
 *
 * - `msg` 空的：巨集打開對話就停（客戶詳情點 LINE）
 * - `msg` 有字：巨集接著把它貼進輸入框、**不送出**（確認時間、問這輪的時間那兩張卡）；
 *   另外先複製一份到剪貼簿當備份 —— 巨集貼不上時她自己貼
 *
 * @returns {Promise<'no-name'|'fallback'|'macro'|'no-reply'>}
 */
export async function openLineChat({ name, msg = '', notify = () => {}, deps } = {}) {
  const d = { ...browserDeps(), ...deps };
  const who = trimmed(name);
  const text = String(msg ?? '');
  if (!who) {
    notify(NO_NAME);
    return 'no-name';
  }

  // 有訊息就先複製：這一行要在按下去的那一刻跑（剪貼簿要「使用者剛按了」，等完 fetch 可能就過了）
  const msgCopied = text ? copyText(d, text) : null;
  const prefs = readLineMacro(d.storage);
  if (!prefs.on) {
    notify(await fallback(d, who, text, msgCopied));
    return 'fallback';
  }

  const got = await knock(d, macroUrl({ port: prefs.port, name: who, msg: text }));
  if (got === 'macro') {
    notify(`已經叫 MacroDroid 打開「${who}」的對話${text ? '、貼上訊息（不會送出）' : ''}`);
    return 'macro';
  }
  if (got === 'no-reply') {
    notify(NO_REPLY);
    return 'no-reply';
  }
  notify(await fallback(d, who, text, msgCopied, UNREACHED));
  return 'fallback';
}

/**
 * 設定頁的「試一次」：拿一位好友的名字送 `TEST_MESSAGE`。**不走退路** —— 退路什麼都驗不到。
 *
 * @returns {Promise<'off'|'no-name'|'macro'|'unreached'|'no-reply'>}
 */
export async function testLineMacro({ name, notify = () => {}, deps } = {}) {
  const d = { ...browserDeps(), ...deps };
  const prefs = readLineMacro(d.storage);
  if (!prefs.on) {
    notify('先勾上面那一格「這台手機裝了 MacroDroid」再試');
    return 'off';
  }
  const who = trimmed(name);
  if (!who) {
    notify('先打一位好友的 LINE 名字（照你 LINE 好友清單上的寫法）');
    return 'no-name';
  }
  const got = await knock(d, macroUrl({ port: prefs.port, name: who, msg: TEST_MESSAGE }));
  if (got === 'macro') {
    notify(`送出去了：手機應該打開 LINE、找到「${who}」、貼上一則三段的測試訊息（不會送出）`);
  } else if (got === 'no-reply') {
    notify(NO_REPLY);
  } else {
    notify(`${UNREACHED}連接埠是 ${prefs.port}，跟 MacroDroid 的設定一樣嗎？`);
  }
  return got;
}
