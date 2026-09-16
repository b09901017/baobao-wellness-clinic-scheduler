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
//                  [--aliases <aliases.json>] [--decisions <決定檔>] [--out <資料夾>]

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..');

// **一定要轉成 file:// URL 才 import 得動。** Windows 上絕對路徑長
// `C:\repo\public\…`，動態 import 會把 `C:` 當成協定，然後喊
// ERR_UNSUPPORTED_ESM_URL_SCHEME —— 而在 macOS 上 `/Users/…` 剛好能用，
// 所以這個坑只有她那台看得到。
const repoModule = (rel) => import(pathToFileURL(join(REPO, rel)).href);

const { parseSheet, planForSheet, IV_SHORTHAND } = await repoModule('public/js/domain/legacyImport.js');
const { SEED } = await repoModule('public/js/domain/seed.js');
const { toCustomerFields } = await repoModule('public/js/domain/customerMarks.js');
const { idsForPoolKind, POOL_SET_HOME, POOL_SET_ALL } = await repoModule('public/js/domain/entitlements.js');
// 日期算術借 app 那一份（全部走 Date.UTC）。在這裡再寫一次，
// 「整天事件的 DTEND 要減一天」就會有兩個實作，而其中一個遲早在時區上出事。
const { addDays } = await repoModule('public/js/domain/dates.js');
const { KIND_LABEL } = await repoModule('public/js/domain/mergeImport.js');

// ---------- 速記語法 ----------
//
// 全部集中在這裡，因為這是「她怎麼寫字」而不是「規則是什麼」——
// 看到新的寫法時改這裡就好。細節與例子見 references/shorthand.md。

/** 同一個字的不同寫法。左邊是正規形，右邊會被換成左邊。 */
export const VARIANTS = [['啟', '啓'], ['惠', '慧'], ['崴', '威'], ['喩', '喻'], ['珮', '佩']];

/** 簡寫 → [課程, 器材]。由上到下比，一句話可以命中好幾個。 */
//
// **課程與器材那兩格都要跟主檔上的全名一字不差。** `mergeImport.js` 的
// `byName()` 是精確比對、不做模糊 —— 對不上的時候課程那一格會讓**整筆額度與
// 它底下的每一段都匯不進去**（畫面上只寫「N 處對不到主檔」），器材那一格
// 則是那一格留空。兩次改名都踩過：課程 2026-09-06 從「靜脈」正名成 ILIB，
// 器材 2026-09-08 從「超磁場」改名成 SIS。
export const TOKENS = [
  [/ILIB|IL(?![A-Za-z])|靜脈/i, 'ILIB', null],
  [/INDIBA|IN(?![A-Za-z])/i, '復能', 'INDIBA'],
  [/SIS|超磁/i, '復能', 'SIS'],
  [/高\s*能|高\s*60|雷射/i, '復能', '高能量雷射'],
  [/復能|賦能/, '復能', null],
  // **體驗課排在正式課前面，而且正式課那一條要排除它。** 第 88 行收的是
  // **全部**命中的 token，`EECP體驗` 同時命中兩條的話那一天會長出兩段。
  // 2026-09-16 起體驗是一門自己的課程（30 分，正式課 60 分）。
  [/EECP\s*體驗/i, 'EECP體驗', null],
  [/EECP(?!\s*體驗)/i, 'EECP', null],
  [/二返|2返|功能醫學/, '二返', null],
  [/健檢/, '健檢', null],
  // `王小明13`、`8：50王小明13+Line`（假名）：13健檢是「付 1 萬換 3 萬的健檢」（她 2026-09-15），不是 13 萬。
  // 前面要是中文字、後面不能接數字或時間的點 —— `13：30` 是下午一點半
  [/(?<=[一-鿿])13(?![\d.．：:])/, '健檢', null],
  [/復健科|復健門診|復健/, '復健科醫師門診', null],
  [/心臟評估|心臟門診|心超|HRV|ABI/, '心臟科評估', null],
  [/點滴|雪顏|護肝|腸道|排毒|亮彩|猛健樂|速利清|護心|NAC/, '營養點滴', null],
  // `.5雪`、`.5肝`：點滴室後面接一個字的品項（她 2026-09-15）。「腸胃鏡」的腸不算
  [/[.．]\d{1,2}\s*[雪肝腸](?!胃)/, '營養點滴', null],
  [/營養諮詢|營養師/, '營養師諮詢', null],
  [/物理諮詢|物理治療師/, '物理治療師諮詢', null],
  [/Inbody|體脂|體組成/i, '身體組成分析', null],
  [/體適能/, '體適能檢查分析', null],
];

/** 舊表的療程列名稱 ↔ 行事曆簡寫算不算同一件事 */
const SAME = (course, want) => course === want
  || (course === 'ILIB' && /ILIB|靜脈/i.test(want))
  || (course === '復能' && /復能|賦能/.test(want))
  || (course === '健檢' && want.includes('健檢'))
  || (course === '二返' && /二返|功能醫學/.test(want));

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
 * 那真的只是她懶得寫名字；`12：30蘇ILIB`、`2：30小美IL治2`（假名）剩下「蘇」「小美」，
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
  // 一個字的（`.5雪`、`.5肝`）：只認緊跟在點滴室後面的那一個字，免得「腸胃鏡」變成腸道修復
  for (const [ch, full] of Object.entries(IV_SHORTHAND)) {
    if (new RegExp(`[.．]\\d{1,2}\\s*${ch}(?!胃)`).test(s)) return products.find((p) => p.name === full)?.name ?? null;
  }
  return null;
}

/**
 * `治3` = 治療室3；`IL.9`、`IL 9` = 點滴9（使用者確認過：IL 後面的數字是點滴室）。
 *
 * 她也會直接把房間寫出來：`腸道點滴.9`、`IL（點3`。
 *
 * **`.N` 就是點滴 N**（她 2026-09-15，推翻了 8/27 那一條「裸數字意思不明，留空」）——
 * app 主檔上點滴室的簡寫本來就是 `.5`、`.8`。兩道護欄：點的前面是數字的是時間（`3.30`），
 * 大於 10 的是日期（`.20這週約`）。
 *
 * 數字最多讀兩位：`IL.10100元*3萬` 是點滴 10，後面那串是錢（2026-09-14 那一批讀成過「點滴 10100」）。
 */
export function roomOf(summary) {
  const s = String(summary).replace(/\s+/g, '');
  const t = /治(\d{1,2})/.exec(s);
  if (t) return `治${t[1]}`;
  const il = /(?:ILIB|IL)[（(]?[.．]?(\d{1,2})/i.exec(s);
  if (il) return `點滴${il[1]}`;
  const drip = /點滴?[.．]?(\d{1,2})/.exec(s);
  if (drip) return `點滴${drip[1]}`;
  const bare = /(?<!\d)[.．](\d{1,2})(?!\d)/.exec(s);
  const n = Number(bare?.[1]);
  return bare && n >= 1 && n <= 10 ? `點滴${n}` : null;
}

// ---------- 這一筆是哪一類 ----------
//
// 日曆上有四類（ADR-0045），行事曆匯出的檔案裡分不出來：TimeTree 只給標題、
// 時間與顏色，而**顏色分不出來**（references/shorthand.md：實測 9 種顏色每一種
// 底下都混著來訪與雜事）。配得到客戶的那些走來訪，剩下的這裡再分三類。
//
// 分完還是要她確認 —— app 那一頁每一列都可以改（`ui/views/mergeImport.js`）。
// 這裡的工作是讓她不用把兩百列一列一列重挑，不是替她決定。

/**
 * 休假詞。長的排前面，`休` 一定要在最後，否則 `休假` 只會被吃掉一個字。
 *
 * 兩份是同一個來源，一份拿來問「有沒有」、一份拿來扣掉。**不要合成一個帶 `g` 的**：
 * 帶 `g` 的正則在 `test()` 之間會記住 `lastIndex`，同一個字串問兩次會得到不同答案。
 */
const LEAVE_SOURCE = '休假|請假|特休|補休|年假|調休|排休|公假|事假|病假|生理假|補假|休';
const LEAVE_WORDS = new RegExp(LEAVE_SOURCE);
const LEAVE_WORDS_ALL = new RegExp(LEAVE_SOURCE, 'g');

/**
 * 是中文字，但一定不是人名。
 *
 * 只為了一件事存在：`6／17開會補休` 扣掉 `補休` 之後剩下 `開會`，
 * 而「還剩中文字」的判準會把它當成別人的名字，於是她自己的補休變成行事備註。
 * 名單保持短 —— 每一個都要真的在她的行事曆上出現過。
 */
const NOT_A_NAME = [
  '開會', '上班', '下班', '加班', '補班', '值班', '公司', '門診', '早上', '下午', '晚上', '整天', '全天',
  // 假別前後黏著的動詞。`請生理假` 扣掉 `生理假` 之後剩一個 `請`，
  // 而一個中文字看起來就跟只寫一個字的名字一模一樣 —— 她自己的假會變成別人的。
  '請', '放', '補', '休', '假',
];

/**
 * 待辦動詞。這幾個字出現在標題裡，那一筆就是一件「做完可以勾掉的事」。
 *
 * 名單是從她真的寫過的字來的（`H2U電話`、`記復能行事曆`、`蒐集客人復能時間`、
 * `王小明聯絡`、`林小美通知`、`取消陳小華`、`處理王小明＆林小美`、`交收據`、`寄資料夏醫師`），
 * 不是想像出來的。看到新的寫法就加進來。
 *
 * `生日`、`退伍` 這種**不在名單上**是刻意的：那是「那天會發生的事」，不是待辦。
 * 給它一個勾掉的框，等於問她要不要把別人的生日勾掉。
 *
 * `壓` 收的是整個「壓進某個系統」的家族（`壓表`、`休假壓outlook`），不是只有 `壓表` ——
 * 她拿同一個字講 Abovee、Examine、Outlook 三件事。
 */
const TODO_WORDS = /電話|通知|聯絡|寄|交|訂|處理|確認|預約|約|記錄|紀錄|記|提醒|蒐集|收集|繳|買|取消|查|準備|報名|填|送|還|催|領|退費|盤點|壓|看|Examine|耀聖|回電|告知|給|退款|影本|更新|排|包|澆水/i;
// ↑ 最後那一串是她 2026-09-15 指名的（`2.王小明回電`、`包王小明營養素`、`單子給某某`、`澆水`，假名）

/**
 * 這句話裡除了認得出來的東西以外，還剩下的中文字 —— 拿來判斷「寫的是別人」。
 *
 * 跟 `residualNames()` 有一個關鍵差別：**這裡不扣治療師的名字**。
 * 那一支是在配對來訪，治療師名字是預期中的雜訊；這裡在問「這是誰的假」，
 * 而治療師正是那個「誰」。`王小婷休假` 扣掉治療師名單就變成她自己的休假，
 * 那幾天會整片變成排不進去的灰青斜線 —— 而她其實在上班。
 */
function residualPeople(summary) {
  // 假別後面黏著的長度：`請假3天`、`休假半天`、`補休一天`、`特休兩天`。
  // 數字本身會被下面的非中文那一關洗掉，但 `天`／`兩天`／`半天` 是中文，
  // 留著就會被讀成人名 —— `請假3天` 曾經報出「寫的是「天」的假」。
  let s = normVariant(summary)
    .replace(LEAVE_WORDS_ALL, ' ')
    .replace(/[一二三四五六七八九十兩半整全]*[天日]/g, ' ');
  for (const [re] of TOKENS) s = s.replace(new RegExp(re.source, `g${re.flags.replace('g', '')}`), ' ');
  s = s.replace(/治\s*\d+|點滴\s*\d+|床\s*[A-Za-z]/g, ' ').replace(/[^\u4e00-\u9fff]/g, '');
  for (const w of NOT_A_NAME) s = s.split(w).join('');
  return s.trim();
}

/**
 * 這句標題**開頭**是不是一個時間。
 *
 * `timeInSummary()` 會把前面的非數字全部丟掉再找數字，所以 `H2U電話` 裡的 `2`
 * 會被讀成 2 點，而那是一件她要打的電話，不是下午兩點的事。分類要問的是
 * 「她有沒有在最前面寫時間」—— 那才是她的寫法（`references/shorthand.md`）。
 *
 * 開頭的表情符號與標點先拿掉：`😀2.30學HRV` 的時間照樣算數，
 * `😀ExamineX光` 則停在 `E`，不會因為後面有個 `X` 就被當成有時間。
 */
function leadsWithTime(summary) {
  const head = String(summary ?? '').replace(/^[^\d一-鿿A-Za-z]+/u, '');
  if (!/^\d/.test(head)) return false;
  // 開頭是 13 以上、**後面沒有接分鐘**的裸數字，多半是日期不是時間：
  // `20這週約王小明`（假名）講的是 20 號那一週要約人，不是晚上八點的行程。
  // 院內作業時間到 20:00，所以這種數字真的當時間用的時候她會寫成
  // `13.30`、`8：50` —— 有分鐘的那一種這裡照樣放行。
  const bare = /^(\d{1,2})(?![.：:]?\d{2})/.exec(head);
  if (bare && Number(bare[1]) >= 13) return false;
  return Boolean(timeInSummary(summary));
}

// 那三類的名字借 app 那一份（`domain/mergeImport.js` 的 `KIND_LABEL`）。
// 在這裡再寫一次的話，改詞彙表要改兩個地方，而其中一個一定會被忘記 ——
// 這支腳本本來就在跑 app 的 domain 了（檔頭的 import）。

/**
 * 對不到客戶的那一筆事件，在日曆上該是哪一類。
 *
 * 三條規則，由上到下：
 *
 * 1. **寫了休假詞，而且沒有寫到別人** → 休假。她那幾天不在，任何來訪都排不進去
 *    （`CONTEXT.md`）。`陳小美休假`、`林小華請假` 寫的是同事，那對她只是一則行事備註 ——
 *    判錯這一條的代價是整片日子被擋掉，所以寧可退回行事備註。
 * 2. **標題最前面沒有寫時間，而且有待辦動詞** → 待辦（有日期的隨手記，ADR-0044）。
 *    **有寫時間就不是待辦**：隨手記存得下日期、存不下時間（`domain/notes.js`），
 *    而她特地把 `3.` 打進標題就表示那個時間有意義，改成待辦會把它弄丟。
 *    這個判準比顏色可靠，見 `references/shorthand.md`。
 * 3. 其餘 → 行事備註。`公出`、`顧客會`、`高齡博覽會`、`<家人>生日` 都落在這裡。
 *    `公出` 刻意不算休假：`CONTEXT.md` 把它列在行事備註的例子裡，而且那是
 *    「人在別的地方辦公事」不是「今天休息」。她不同意的話在 app 上點一下就改得掉。
 *
 * @returns {{kind: 'leave'|'note'|'personal', why: string}}
 *   `why` 是給報告與 app 上那一列看的一句話。**分類要講得出理由** ——
 *   兩百列裡她只會停在覺得怪的那幾列，而沒有理由就看不出哪幾列該停。
 */
export function classifyEvent(summary) {
  const s = normVariant(summary ?? '');
  if (LEAVE_WORDS.test(s)) {
    const others = residualPeople(s);
    if (!others) return { kind: 'leave', why: '標題寫了休假，而且沒有寫到別人' };
    // 寫了別人就不是她的假 —— 但這句話也可能根本不是在講「誰放假」，
    // 而是一件跟假有關的雜事（`休假壓outlook` 是每個月提醒自己去壓一次）。
    // 落到行事備註的話，理由那一句會變成「寫的是「壓」的假」，那是句廢話。
    if (!leadsWithTime(s) && TODO_WORDS.test(s)) {
      return { kind: 'note', why: '講的是一件跟休假有關、做完可以勾掉的事，不是她自己不在' };
    }
    return { kind: 'personal', why: `寫的是「${others}」的假，不是她自己不在` };
  }
  if (!leadsWithTime(s) && TODO_WORDS.test(s)) {
    return { kind: 'note', why: '沒寫時間，而且是一件做完可以勾掉的事' };
  }
  return { kind: 'personal', why: leadsWithTime(s) ? '標題最前面寫了時間' : '不是休假，也不是做完可以勾掉的事' };
}

// ---------- 名字 ----------

/**
 * 這位客戶在行事曆上可能被叫成什麼。
 *
 * 她寫的是給自己看的字：只寫姓、只寫名、寫暱稱（跟本名一個字都不像的稱呼）、打錯字（惠↔慧）、
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
    if (main.length >= 3) forms.add(main.slice(1)); // 去姓：王陳小明 → 陳小明（假名）
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

/**
 * 匯進 app 要用的客戶名稱。
 *
 * 舊表的 A2 把三樣東西擠在一格（`名字`、`名字3157`、`名字\n(器材偏好)3157`），
 * 而那一格原文照抄之後，app 裡的客戶就叫「王小明3157」（假名）—— 她每天要看的是名字，
 * 不是病歷號。多出來的東西不會掉：`planForSheet()` 已經把它們收進備註了。
 *
 * 拆名字是有風險的（拆錯比留著多餘的字嚴重），所以這裡只做「拿掉數字與括號」
 * 這一種確定安全的清理，其餘一律走 `renames` 由她指名 ——
 * 例如一張夫妻共用的分頁，名字要寫成兩個人。
 */
export function displayName(raw, { renames = {}, sheetName = '' } = {}) {
  if (renames[sheetName]) return renames[sheetName];
  if (renames[raw]) return renames[raw];
  const cleaned = String(raw)
    .replace(/\\n/g, ' ')
    .replace(/[(（][^)）]*[)）]/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || String(raw).trim();
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

/**
 * `P5D` / `P1W` → 幾天。認不出來（`PT2H` 這種只有時分的）回 0，當成同一天。
 * **整天事件的 DURATION 跟 DTEND 一樣不含端點**：8/10 起算 `P5D` 是 8/10–8/14。
 */
function durationDays(value) {
  const m = /^-?P(?:(\d+)W|(\d+)D)/.exec(String(value ?? '').trim());
  if (!m) return 0;
  return m[1] ? Number(m[1]) * 7 : Number(m[2]);
}

/** `20260810T143000` / `20260810` → `{ date, clock }`。讀不出來回 null。 */
function icsMoment(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(String(value ?? ''));
  if (!m) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, clock: m[4] ? `${m[4]}:${m[5]}` : null };
}

/**
 * 一份 .ics 裡的事件。
 *
 * **`DTEND` 要讀。** 沒讀它的時候跨天的事件會無聲塌成一天：一條「8/10–8/14 出國」
 * 進來只剩 8/10，而且不會出現在任何清單裡說它被砍了
 * （`.scratch/first-real-import/issues/06`）。app 那一側從 `domain/events.js` 到
 * `firestore.rules` 一路都支援跨天，缺的只有這裡。
 *
 * **整天事件的 `DTEND` 是不含端點的**（iCalendar 規格）：8/10–8/14 會寫成
 * `DTEND;VALUE=DATE:20260815`，所以要減一天。
 *
 * @returns {{events: object[], unreadable: object[]}}
 *   `unreadable` 是 `DTSTART` 讀不出來的那幾筆。**它們不能安靜地消失** ——
 *   原本那句 `if (!m) continue;` 讓整筆蒸發，而且不會出現在報告裡。
 */
export function parseIcs(text) {
  const raw = String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const events = [];
  const unreadable = [];
  for (const block of raw.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const d = {};
    const params = {};
    for (const line of body.split('\n')) {
      const i = line.indexOf(':');
      if (i <= 0) continue;
      const [name, ...rest] = line.slice(0, i).split(';');
      d[name] = line.slice(i + 1).trim();
      params[name] = rest.join(';');
    }

    const start = icsMoment(d.DTSTART);
    if (!start) {
      unreadable.push({
        uid: d.UID ?? '',
        summary: d.SUMMARY ?? '',
        raw: d.DTSTART ?? '',
        why: d.DTSTART ? 'DTSTART 讀不出日期' : '這筆事件沒有 DTSTART',
      });
      continue;
    }

    // 沒有 `T` 就是整天。`VALUE=DATE` 再確認一次（`VALUE=DATE-TIME` 不算）。
    const allDay = !start.clock || /VALUE=DATE(?!-)/i.test(params.DTSTART ?? '');
    const end = icsMoment(d.DTEND);
    let endDate = start.date;
    if (end) {
      endDate = allDay ? addDays(end.date, -1) : end.date;
      // 有的匯出器把整天事件的 DTEND 寫成跟 DTSTART 同一天。減完比開始還早就是這種，
      // 當成單天 —— firestore.rules 的 validEvent() 擋 endDate < startDate。
      if (endDate < start.date) endDate = start.date;
    } else if (d.DURATION) {
      // 沒有 DTEND 的匯出器會寫 DURATION（`P5D`、`P1W`、`PT2H`）。
      // 只認天與週那兩種 —— 小時與分鐘跨不跨天要看 DTSTART 的時間，
      // 而那個欄位會歪（見 `timeInSummary()` 的檔頭），寧可少算一天也不要多算一天。
      endDate = addDays(start.date, Math.max(0, durationDays(d.DURATION) - (allDay ? 1 : 0)));
    }

    events.push({
      uid: d.UID ?? `${d.DTSTART}-${d.SUMMARY}`,
      date: start.date,
      endDate,
      allDay,
      clock: start.clock, // 行事曆時間欄，只當佐證
      summary: d.SUMMARY ?? '',
      color: d.COLOR ?? '',
      repeats: Boolean(d.RRULE),
    });
  }
  return { events, unreadable };
}

/**
 * 這筆事件的開始時間。
 *
 * **整天事件不回頭猜標題。** `timeInSummary()` 是從標題文字認時間的（她寫「2.30」
 * 「9：15」），所以一筆整天事件只要標題裡有數字，就會被安上一個假的時間，
 * 匯進來變成一筆有時有分的行事備註。有 `allDay` 這個明確欄位之後就不必猜了。
 */
export const timeOf = (e) => (e.allDay ? null : timeInSummary(e.summary)?.start ?? e.clock ?? null);

// ---------- 配對 ----------

const DEFAULT_SLOT_MIN = 60;

/**
 * 「有名字沒療程」「有療程沒名字」那兩條補法**不拿來用**的句子。
 *
 * X光 是復健科門診的一部分（她 2026-09-15：看門診前先照，要不要照看醫師）—— 不是一段療程；
 * 取消、預約、紀錄講的是另一件事。拿它們的時間去補沒配到的時段，就是憑空編一個時間出來，
 * 而那在畫面上跟補對了長得一模一樣。
 */
const NOT_A_SLOT = /X光|取消|預約|紀錄|記錄/i;

/**
 * 不是來訪的句子（她 2026-09-15：「取消／預約／改／紀錄／約」一律不是來訪）。
 *
 * 這幾種句子人名與療程都對得上，於是會被列成「行事曆有、舊表沒勾」—— 那是最危險的一份清單，
 * 塞進假的會讓真的漏勾看起來不值得找。退回對不到客戶的清單，分類照舊由 `classifyEvent()` 判。
 */
const NOT_A_VISIT = /取消|預約|改|紀錄|記錄|約/;

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
    const best = Math.max(0, ...forms.map((f) => nameHit(norm, f)));
    // 兩個字以上才算寫了她。**只沾到一個字不算** —— 以前任何一個重疊的字都算 1，
    // 於是寫著「林小美」的句子，從「王大美」的角度看也「提到了她」（假名；只重疊一個「美」字）。
    let hit = best >= 2 ? best : 0;
    let surname = null;
    // 只寫一個姓（`3.15陳IL.7`）只有在她也寫了療程、而且句子裡沒有別位客戶的兩個字時才算數：
    // 「王陳IL」寫的是複姓王陳的那一位，不是另一位姓王的（假名；2026-09-14 那一批真的配錯過）。
    // 那天還有沒有另一位同姓的在等同一種療程，要等全部配完才看得出來 —— 在 reconcile()。
    if (!hit && courses.length) {
      surname = surnames.find((ch) => norm.includes(ch)) ?? null;
      if (surname && othersForms.some((f) => f.length >= 2 && nameHit(norm, f) >= 2)) surname = null;
      if (surname) hit = 1;
    }
    return { e, hit, courses, time: timeInSummary(e.summary), surname };
  });

  const mine = scored.filter((x) => x.hit > 0).sort((a, b) => b.hit - a.hit);
  // 「沒寫是誰」必須是**真的沒寫**：一筆寫著別位客戶名字的事件，從這位客戶的角度
  // 看起來也是「沒提到我」，拿來補她的時段就會把別人的療程掛到她頭上（真的發生過）。
  // 另外要求標題裡有寫時間 —— 沒有時間的多半是待辦（`記復能行事曆`），不是來訪。
  const nameless = scored.filter((x) => x.hit === 0 && x.courses.length && x.time
    && !othersForms.some((f) => f.length >= 2 && normVariant(x.e.summary).includes(f))
    && !residualNames(x.e.summary, therapists)
    && !NOT_A_SLOT.test(x.e.summary));

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
        // 只沾到一個姓配上的，記著是哪個字 —— reconcile() 要拿它去問「那天還有沒有別位同姓的」
        surname: hit.surname,
      },
    };
  });

  // 沒配到的時段，還有兩種救法，兩種都標成要她確認：
  const openSlots = filled.filter((x) => !x.match);
  const spare = pool.filter((c) => !used.has(c));

  // (1) 她只寫了名字沒寫療程（`8.15王小明13`，假名），而那天就剩這一筆對得上她
  const blank = spare.filter((c) => !c.courses.length && c.hit >= 2 && !NOT_A_SLOT.test(c.e.summary));
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

// ---------- 她回答過的決定 ----------
//
// 規則寫得進 references/answers.md，但「這一天是誰、補不補、幾點、這筆額度其實是什麼」
// 是一位一位的決定 —— 下一批檔案進來時她不該再答一次（她 2026-09-15：「要記錄我回報你的內容，
// 讓下次就不用再回報同樣的事」）。那些決定有真名，只能放 `.local/references/merge-decisions.json`，
// 格式見 SKILL.md 的「決定檔」一節。
//
// **對不到對象的決定一定要講出來**（`decisionLog.misses`，報告的 ⓪d）。下一批舊表她自己改過之後
// 最容易發生，而一條安靜失效的決定跟沒有決定長得一模一樣。

const MASTER = { equipment: SEED.equipment, courses: SEED.courses };
const decisionsOf = (decisions, plan) => decisions?.customers?.[plan.sheetName] ?? null;
const seedCourse = (name) => SEED.courses.find((c) => c.name === name) ?? null;
const courseNameOfDoc = (doc) => SEED.courses.find((c) => c.id === doc.courseId)?.name ?? null;

/** 決定檔裡的池寫法 → 器材 id。`only` 是一台、`set` 是三選一／四選一；都沒寫回 null（不動）。 */
function poolIdsOf(spec) {
  if (spec.only) return SEED.equipment.filter((e) => e.name === spec.only).map((e) => e.id);
  if (spec.set === '四選一') return idsForPoolKind(POOL_SET_ALL, MASTER);
  if (spec.set === '三選一') return idsForPoolKind(POOL_SET_HOME, MASTER);
  return null;
}

/** 這一筆不算方案（尾款沒繳、或是加購的那一部分）。 */
function stripPlan(doc) {
  Object.assign(doc, { sourcePlanName: null, sourcePlanSets: null, sourcePlanQty: null, purchaseKey: 'extras' });
}

function applyDocSpec(doc, spec) {
  if (spec.label != null) doc.label = spec.label;
  if (spec.qty != null) doc.totalQty = spec.qty;
  if (spec.durationMin != null) doc.durationMin = spec.durationMin;
  if (spec.purchasedAt !== undefined) doc.purchasedAt = spec.purchasedAt;
  const ids = poolIdsOf(spec);
  if (ids) Object.assign(doc, { type: 'pool', courseId: null, optionEquipmentIds: ids });
  if (spec.plan === false) stripPlan(doc);
}

/**
 * 額度、備註、警示、合作機構的決定。**在配對之前做**：併掉的那一列，它底下的時段要先指到新的那一筆。
 */
function applyPlanDecisions(plans, decisions, log) {
  for (const p of plans) {
    const d = decisionsOf(decisions, p);
    if (!d || p.skip) continue;
    const done = (what) => log.applied.push(`${p.sheetName}：${what}`);
    const miss = (what) => log.misses.push(`${p.sheetName}：${what}`);
    // 她已經回答過那一列是什麼了，那一列的「購買名稱對不上」就不用再問
    const forgetRow = (row, labels) => {
      p.purchaseProblems = (p.purchaseProblems ?? [])
        .filter((x) => !x.startsWith(`第 ${row} 列`) && !labels.some((l) => x.includes(`「${l}」`)));
    };
    const labelsOf = (row) => p.entitlements.filter((e) => e.key === `r${row}`).map((e) => e.doc.label);

    if (d.noPlan) {
      for (const e of p.entitlements) if (e.doc.sourcePlanName || e.doc.purchaseKey === 'plan') stripPlan(e.doc);
      p.purchaseProblems = (p.purchaseProblems ?? []).filter((x) => !x.includes('方案'));
      done(`方案不算（${d.noPlan}）`);
    }

    for (const op of d.entitlements ?? []) {
      if (op.add) {
        const course = seedCourse(op.add.course);
        if (!course) { miss(`主檔裡沒有「${op.add.course}」，要加的那一筆額度沒有加`); continue; }
        if (p.entitlements.some((e) => e.key === op.add.key)) continue;
        p.entitlements.push({
          key: op.add.key, productName: null, productId: null,
          doc: {
            type: 'single', label: op.add.label ?? course.name, courseId: course.id, optionEquipmentIds: null,
            totalQty: op.add.qty ?? 1, durationMin: op.add.durationMin ?? course.durationMin ?? null,
            frequencyRule: course.frequencyRule ?? null,
            sourcePlanName: null, sourcePlanSets: null, sourcePlanQty: null,
            purchasedAt: op.add.purchasedAt ?? p.customer?.purchasedAt ?? null, purchaseKey: 'extras',
            expiresAt: null, doneCount: 0, bookedCount: 0, lastReconciledAt: null,
          },
        });
        done(`加一筆「${op.add.label ?? course.name}」× ${op.add.qty ?? 1}`);
        continue;
      }

      if (op.merge) {
        const [first, ...rest] = op.rows ?? [];
        const base = p.entitlements.find((e) => e.key === `r${first}`);
        if (!base) { miss(`第 ${first} 列沒有額度，「第 ${(op.rows ?? []).join('、')} 列併成一池」沒有做`); continue; }
        forgetRow(first, labelsOf(first));
        for (const row of rest) {
          const gone = p.entitlements.filter((e) => e.key === `r${row}`);
          forgetRow(row, gone.map((e) => e.doc.label));
          // 併進池裡的那一列（ILIB）是池裡的哪一台 —— 那幾段要記成選了那一台（ADR-0075）
          const equip = gone.map((e) => SEED.equipment.find((x) => x.courseId === e.doc.courseId)?.name).find(Boolean) ?? null;
          p.entitlements = p.entitlements.filter((e) => !gone.includes(e));
          for (const s of p.visits.flatMap((v) => v.slots)) {
            if (!gone.some((e) => e.key === s.entitlementKey)) continue;
            s.entitlementKey = base.key;
            s.forceEquipment = equip;
          }
        }
        Object.assign(base.doc, {
          type: 'pool', courseId: null,
          optionEquipmentIds: poolIdsOf(op.merge) ?? base.doc.optionEquipmentIds ?? [],
          totalQty: op.merge.qty ?? base.doc.totalQty,
          durationMin: op.merge.durationMin ?? base.doc.durationMin,
          label: op.merge.label ?? base.doc.label,
        });
        done(`第 ${op.rows.join('、')} 列併成一池 × ${base.doc.totalQty}`);
        continue;
      }

      const base = p.entitlements.find((e) => e.key === `r${op.row}`);
      if (!base) { miss(`第 ${op.row} 列沒有額度，這一條決定沒有用上`); continue; }
      forgetRow(op.row, labelsOf(op.row));
      if (op.split) {
        const [head, ...tail] = op.split;
        tail.forEach((part, i) => {
          const doc = { ...base.doc };
          applyDocSpec(doc, part);
          p.entitlements.push({ key: `r${op.row}:${i + 2}`, productName: null, productId: null, doc });
        });
        applyDocSpec(base.doc, head);
        done(`第 ${op.row} 列拆成 ${op.split.length} 筆`);
        continue;
      }
      applyDocSpec(base.doc, op);
      done(`第 ${op.row} 列改了 ${Object.keys(op).filter((k) => k !== 'row' && !k.startsWith('_')).join('、')}`);
    }

    if (d.notes || d.flags || d.partners) {
      let marks = [...(p.customer?.marks ?? [])];
      for (const text of d.notes?.drop ?? []) {
        const before = marks.length;
        marks = marks.filter((m) => m.text !== text);
        if (marks.length === before) miss(`備註裡找不到「${text}」，沒有刪`);
      }
      for (const m of d.notes?.add ?? []) {
        if (!marks.some((x) => x.text === m.text)) marks.push({ text: m.text, color: m.color ?? 'grey' });
      }
      const { marks: list, notes } = toCustomerFields(marks);
      Object.assign(p.customer, { marks: list, notes: notes ?? '' });
      if (Array.isArray(d.flags)) p.customer.flags = [...new Set([...(p.customer.flags ?? []), ...d.flags])];
      if (Array.isArray(d.partners)) p.customer.partners = [...new Set([...(p.customer.partners ?? []), ...d.partners])];
      done(`備註 +${d.notes?.add?.length ?? 0}／−${d.notes?.drop?.length ?? 0}`
        + `${d.flags ? `、警示 ${d.flags.join('、')}` : ''}${d.partners ? `、合作機構 ${d.partners.join('、')}` : ''}`);
    }
    if (Array.isArray(d.dropProblems)) {
      p.purchaseProblems = (p.purchaseProblems ?? []).filter((x) => !d.dropProblems.some((s) => x.includes(s)));
    }
  }
}

/** 要加的那一段扣哪一份：二返找配出來的那一筆、復能找池、其餘找同課程的。不只一份就不猜。 */
function entitlementFor(plan, course) {
  const hits = plan.entitlements.filter((e) => (course === '二返'
    ? Boolean(e.doc.followupForEntitlementKey)
    : (e.doc.type === 'pool' ? course === '復能' : courseNameOfDoc(e.doc) === course)));
  return hits.length === 1 ? hits[0].key : null;
}

/** 一段照她的決定填好的配對。事件上讀得到的先填，她明寫的蓋過去；她確認過了，所以是 high。 */
function decidedMatch(e, courseName, spec, staff, base = null) {
  const fromEvent = e ? {
    startsAt: timeOf(e),
    room: roomOf(e.summary),
    equipmentName: coursesOf(e.summary).find((x) => SAME(x.course, courseName))?.equip ?? null,
    therapistName: therapistOf(e.summary, staff),
    ivProductName: /點滴/.test(courseName) ? ivProductOf(e.summary, SEED.ivProducts) : null,
    evidence: e.summary,
    clock: e.clock,
  } : {};
  const explicit = Object.fromEntries(Object.entries({
    startsAt: spec.startsAt, room: spec.room, equipmentName: spec.equipment, therapistName: spec.therapist,
    ivProductName: spec.iv, evidence: spec.evidence, durationMin: spec.durationMin,
  }).filter(([, v]) => v !== undefined));
  return { ...(base ?? {}), ...fromEvent, ...explicit, confidence: 'high', decided: true, surname: null };
}

/** 時段的決定：改、清成不詳、加一段。**在配對之後做**，蓋過配對推出來的結果。 */
function applySlotDecisions(customers, decisions, { byDate, usedSummaries, staff }, log) {
  for (const c of customers) {
    const d = decisionsOf(decisions, c);
    if (!d || c.skip) continue;
    for (const op of d.slots ?? []) {
      const where = `${c.sheetName} ${op.date}${op.course ? ` ${op.course}` : ''}${op.nth ? ` 第 ${op.nth} 段` : ''}`;
      const eventOf = (title) => (byDate.get(op.date) ?? []).find((e) => e.summary === title) ?? null;

      if (op.add) {
        const a = op.add;
        const e = a.fromEvent ? eventOf(a.fromEvent) : null;
        if (a.fromEvent && !e) { log.misses.push(`${where}：行事曆那天找不到「${a.fromEvent}」，要加的那一段沒有加`); continue; }
        const key = a.entitlement ?? entitlementFor(c, a.course);
        if (!key) { log.misses.push(`${where}：找不到要扣哪一份額度（沒有或不只一份），要加的那一段沒有加`); continue; }
        let day = c.days.find((x) => x.date === op.date);
        if (!day) {
          day = { date: op.date, filled: [], conflicts: [], named: 0, usedUids: new Set() };
          c.days.push(day);
          c.days.sort((x, y) => x.date.localeCompare(y.date));
        }
        day.filled.push({ slot: { entitlementKey: key, courseName: a.course }, match: decidedMatch(e, a.course, a, staff) });
        if (e) usedSummaries.add(`${op.date}|${e.summary}`);
        // 那一筆事件原本被列成「兩邊講的不是同一件事」—— 她決定過了，就不是衝突了
        day.conflicts = (day.conflicts ?? []).filter((x) => x.e !== e);
        log.applied.push(`${where}：加一段 ${a.course}${e ? `（「${e.summary}」）` : ''}`);
        continue;
      }

      const day = c.days.find((x) => x.date === op.date);
      const f = (day?.filled ?? []).filter((x) => x.slot.courseName === op.course)[(op.nth ?? 1) - 1];
      if (!f) { log.misses.push(`${where}：舊表那天找不到這一段，這一條決定沒有用上`); continue; }
      const set = op.set ?? {};
      const e = set.fromEvent ? eventOf(set.fromEvent) : null;
      if (set.fromEvent && !e) { log.misses.push(`${where}：行事曆那天找不到「${set.fromEvent}」，這一條決定沒有用上`); continue; }
      if (f.match?.evidence && (op.clear || e)) usedSummaries.delete(`${op.date}|${f.match.evidence}`);
      if (op.clear) {
        f.match = null;
        log.applied.push(`${where}：時間維持不詳`);
        continue;
      }
      f.match = decidedMatch(e, op.course, set, staff, e ? null : f.match);
      if (set.entitlement) f.slot.entitlementKey = set.entitlement;
      if (e) usedSummaries.add(`${op.date}|${e.summary}`);
      if (e) day.conflicts = (day.conflicts ?? []).filter((x) => x.e !== e);
      log.applied.push(`${where}：照決定改了 ${Object.keys(set).filter((k) => !k.startsWith('_')).join('、')}`);
    }
  }
}

// ---------- 整批 ----------

export function reconcile({ sheetsDir, icsPath, year, aliases = {}, therapists = [], therapistAliases = {}, doctors = [], noise = [], renames = {}, today = null, decisions = null }) {
  const ctx = {
    courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts,
    plans: SEED.plans, clinicalFlags: SEED.clinicalFlags, partners: SEED.partners,
    existingCustomers: [], year, importedAt: null,
  };
  const plans = readdirSync(sheetsDir)
    .filter((f) => f.endsWith('.tsv') && !f.includes('模板'))
    .sort((a, b) => a.localeCompare(b, 'zh-TW'))
    .map((f) => planForSheet(
      parseSheet(readFileSync(join(sheetsDir, f), 'utf8'), { sheetName: f.replace(/\.tsv$/, '') }), ctx,
    ));
  const decisionLog = { applied: [], misses: [] };
  applyPlanDecisions(plans, decisions, decisionLog);

  const { events, unreadable } = parseIcs(readFileSync(icsPath, 'utf8'));
  const byDate = new Map();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  // 涵蓋範圍的右邊看 endDate —— 一條跨到月底的休假，涵蓋範圍就到月底
  const span = events.length
    ? [events.reduce((a, e) => (e.date < a ? e.date : a), events[0].date),
      events.reduce((a, e) => (e.endDate > a ? e.endDate : a), events[0].endDate)]
    : [null, null];

  // 主檔的治療師名單 ＋ 對照表補的別名。認得這些字，`residualNames()` 才不會把
  // 「9.30 IN 姿璇」判成「寫了別人的名字」而放棄那一筆。
  // 主檔的正式名字 ＋ 她在行事曆上的寫法。**輸出的一定是正式名字** ——
  // app 那一側是拿名字去對主檔的，送「新穎」「LU」過去就對不到，欄位會留空。
  const staff = [
    ...SEED.staff.map((x) => ({ name: x.name, aka: therapistAliases[x.name] ?? [] })),
    ...therapists
      .filter((t) => !SEED.staff.some((x) => normVariant(x.name) === normVariant(t)
        || (therapistAliases[x.name] ?? []).some((a) => normVariant(a) === normVariant(t))))
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

  // 只沾到一個姓的配對，要等全部配完才知道安不安全：那天有另一位同姓的客戶也在等同一種療程時，
  // 那一句也可能是她的。她 2026-09-15：「如果我還有寫陳，你辨識不出來一樣要問」—— 兩邊都退回 ④b。
  const ambiguous = [];
  const contested = new Map();
  for (const c of customers) {
    for (const d of c.days ?? []) {
      for (const f of d.filled) {
        const ch = f.match?.surname;
        if (!ch) continue;
        const { evidence } = f.match;
        const want = coursesOf(evidence);
        const rivals = customers.filter((o) => o !== c
          && (o.forms ?? []).some((form) => form.length >= 2 && form[0] === ch)
          && (o.days ?? []).some((od) => od.date === d.date && od.filled.some((g) => want.some((x) => SAME(x.course, g.slot.courseName))
            && (!g.match || (g.match.surname && g.match.evidence === evidence)))));
        if (!rivals.length) continue;
        const key = `${d.date}|${evidence}`;
        const entry = contested.get(key) ?? { date: d.date, evidence, course: f.slot.courseName, who: new Set(), slots: [] };
        for (const o of [c, ...rivals]) entry.who.add(o.customerName);
        entry.slots.push(f);
        contested.set(key, entry);
      }
    }
  }
  for (const [key, x] of contested) {
    for (const f of x.slots) f.match = null;
    usedSummaries.delete(key);
    ambiguous.push({ date: x.date, evidence: x.evidence, course: x.course, who: [...x.who] });
  }

  // X光 是復健科門診的一部分（她 2026-09-15）。那天配到了復健科門診，同一位的 X光 就是那一次的一部分 ——
  // 不必再留在「對不到客戶」的清單裡讓她一筆一筆看。
  for (const c of customers) {
    for (const d of c.days ?? []) {
      if (!d.filled.some((f) => f.match && f.slot.courseName === '復健科醫師門診')) continue;
      for (const e of byDate.get(d.date) ?? []) {
        if (/X光/i.test(e.summary) && c.forms.some((form) => form.length >= 2 && nameHit(normVariant(e.summary), form) >= 2)) {
          usedSummaries.add(`${d.date}|${e.summary}`);
        }
      }
    }
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
  for (const [key, list] of claims) {
    if (list.length < 2) continue;
    ambiguous.push({
      date: list[0].d.date, evidence: list[0].f.match.evidence,
      who: list.map((x) => x.c.customerName), course: list[0].f.slot.courseName,
    });
    for (const x of list) x.f.match = null;
    usedSummaries.delete(key);
  }

  applySlotDecisions(customers, decisions, { byDate, usedSummaries, staff }, decisionLog);

  // 她說「這一筆不算來訪」的（行事曆沒刪的改期、取消了的、只是提醒的）
  const skip = new Map();
  for (const c of customers) {
    for (const s of decisionsOf(decisions, c)?.skipEvents ?? []) {
      skip.set(`${s.date}|${s.title}`, { ...s, who: c.sheetName, found: false });
    }
  }

  // 行事曆上沒有被任何一個時段用掉的事件，分三堆
  const leftover = { calendarOnly: [], future: [], personal: [] };
  const known = plans.filter((p) => !p.skip)
    .map((p) => ({ name: p.customerName, forms: nameForms(p.customerName, aliases), dates: new Set(p.visits.map((v) => v.date)) }));
  for (const e of events) {
    const key = `${e.date}|${e.summary}`;
    if (skip.has(key)) skip.get(key).found = true;
    if (usedSummaries.has(key)) continue;
    if (skip.has(key)) { leftover.personal.push(e); continue; }
    const norm = normVariant(e.summary);
    const who = known.map((c) => ({ c, hit: Math.max(0, ...c.forms.map((f) => nameHit(norm, f))) }))
      .filter((x) => x.hit >= 2).sort((a, b) => b.hit - a.hit)[0];
    const courses = coursesOf(e.summary);
    if (!who || !courses.length || NOT_A_VISIT.test(e.summary)) { leftover.personal.push(e); continue; }
    const row = { event: e, customer: who.c.name, course: courses[0].course, sheetHasThatDay: who.c.dates.has(e.date) };
    if (today && e.date > today) leftover.future.push(row);
    else leftover.calendarOnly.push(row);
  }
  for (const s of skip.values()) {
    if (s.found) decisionLog.applied.push(`${s.who}：${s.date}「${s.title}」不算來訪`);
    else decisionLog.misses.push(`${s.who}：行事曆 ${s.date} 找不到「${s.title}」，「不算來訪」這一條沒有用上`);
  }

  // 雜事的決定（改分類、改起訖、整筆不匯）。真正套用在 importJson()，這裡先確定每一條都找得到對象
  const eventDecisions = new Map((decisions?.events ?? []).map((x) => [`${x.date}|${x.title}`, x]));
  for (const [key, x] of eventDecisions) {
    if (!leftover.personal.some((e) => `${e.date}|${e.summary}` === key)) {
      decisionLog.misses.push(`行事曆 ${x.date} 找不到「${x.title}」（或它已經配成來訪了），那一條決定沒有用上`);
    } else {
      decisionLog.applied.push(`行事曆 ${x.date}「${x.title}」：${x.skip ? `不匯（${x.skip}）`
        : [x.kind && `分類改成${KIND_LABEL[x.kind]}`, x.startDate && `日期改成 ${x.startDate}～${x.endDate ?? x.startDate}`]
          .filter(Boolean).join('、')}`);
    }
  }

  return { plans: customers, events, unreadable, span, leftover, ambiguous, renames, year, decisionLog, eventDecisions };
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
 * 三份候選清單（未來的預約、行事曆有試算表沒勾、對不到客戶的）一律 `include: false`。
 * **這個欄位 app 那一側從來沒有讀過**（勾選狀態是那一頁自己的），留著只是描述性的。
 * 真正的預設值在 `domain/mergeImport.js` 的 `defaultPicks()`：**還沒發生的預設勾起來、
 * 已經發生的預設不勾**（2026-08-21 使用者拍板，見
 * `docs/adr/0030-future-candidates-are-ticked-by-default.md`）。
 * 界線不寫進這份檔案 —— 「未來」是在她按下匯入的那一刻才算得準的。
 */
export function importJson(r, { generatedAt = new Date().toISOString(), calendar = '' } = {}) {
  const courseByName = new Map(SEED.courses.map((c) => [c.name, c]));
  // 結束時間：她決定過這一段幾分鐘就照那個，其次是額度的時長（`復能(30分）` 那一種是 30），最後才是課程
  const endOf = (start, courseName, minutes = null) => (start
    ? addMin(start, minutes ?? courseByName.get(courseName)?.durationMin ?? 60)
    : null);
  const ivNameOf = (id) => SEED.ivProducts.find((x) => x.id === id)?.name ?? null;
  // 候選清單靠名字認人（`addExtraVisits()` 拿它去找那位客戶的計畫），
  // 所以這裡要跟 customers[].name 用同一套清理 —— 一邊清了一邊沒清，
  // 27 筆補的來訪會一筆都對不上，而症狀只是「都沒進去」，看不出是名字的問題。
  const sheetOf = new Map(r.plans.map((p) => [p.customerName, p.sheetName]));
  const nameOf = (raw) => displayName(raw, { renames: r.renames, sheetName: sheetOf.get(raw) ?? '' });

  return {
    // v2（2026-09-13）：多了購買日、方案與套數、帶顏色的備註、購買名稱對不上的那幾條。
    // v3（2026-09-15）：多了額度的時長、客戶的警示與合作機構。
    // **只加欄位不升版的話，舊版 app 會安靜地吃掉那幾格**，而畫面看起來跟匯好了一樣。
    format: 'baobao-merge/v3',
    generatedAt,
    year: r.year,
    calendar: { file: calendar, span: r.span, events: r.events.length },
    customers: r.plans.filter((p) => !p.skip).map((p) => {
      // 舊表那一列寫著每一次用的營養點滴品項簡寫，`planForSheet()` 已經把它
      // 拆成一份品項一筆額度了（`r11:護肝排毒`）。行事曆上沒寫品項的那幾筆
      // 退回用它 —— 那不是猜，是她自己在試算表上寫的那一格。
      const productOf = new Map(p.entitlements.map((e) => [e.key, e.productName ?? null]));
      const minutesOf = new Map(p.entitlements.map((e) => [e.key, e.doc.durationMin ?? null]));
      // **配出來的二返不寫進檔案。** `planForSheet()` 會替每一筆健檢配一筆二返額度
      // （`domain/followups.js` 的 `followupPlanEntries()`），而 app 那一側匯入時
      // 會再配一次 —— 那一支靠 `followupForEntitlementKey` 認「已經配過了」，
      // 而這份檔案的額度沒有那個欄位，於是護欄看不到、每位健檢客戶長出兩筆二返額度。
      // 兩筆的下場是「對到不只一份額度，不知道要扣哪一份」：她在 ② 勾起來的
      // 每一筆二返都補不進去，而那正是這整份報告最在意的一種。
      // 規則只能有一份，而它在 app 那一側（ADR-0022）。
      const derived = new Set(p.entitlements
        .filter((e) => e.doc?.followupForEntitlementKey)
        .map((e) => e.key));
      return {
        sheetName: p.sheetName,
        name: displayName(p.customer?.name ?? p.customerName, { renames: r.renames, sheetName: p.sheetName }),
        rawName: p.customer?.name ?? p.customerName,
        // 通路（`顧客會`），不是 B2 整格原文 —— 那一格已經被 `parsePurchaseCell()` 拆開了
        source: p.customer?.source ?? null,
        purchasedAt: p.customer?.purchasedAt ?? null,
        notes: p.customer?.notes ?? '',
        // 帶顏色的備註。有「尾款」的那一則是紅色（她 2026-09-13）。`notes` 是它的鏡像
        marks: p.customer?.marks ?? [],
        // v3：警示與合作機構（她 2026-09-07：自動帶、否定句不算；決定檔可以再補）
        flags: p.customer?.flags ?? [],
        partners: p.customer?.partners ?? [],
        // B2 拿應有次數驗過一次、對不上的那幾條。**合併時要逐條問她**（她：「合併的時候也可以再問我一次」）
        purchaseProblems: p.purchaseProblems ?? [],
        entitlements: p.entitlements.filter((e) => !derived.has(e.key)).map((e) => ({
          key: e.key,
          type: e.doc.type,
          label: e.doc.label,
          totalQty: e.doc.totalQty,
          // v3：30 分與 60 分是兩種東西（`復能(30分）`、`ILIB 30`）
          durationMin: e.doc.durationMin ?? null,
          courseName: SEED.courses.find((c) => c.id === e.doc.courseId)?.name ?? null,
          optionEquipmentNames: (e.doc.optionEquipmentIds ?? [])
            .map((id) => SEED.equipment.find((x) => x.id === id)?.name ?? id),
          productName: e.productName,
          purchasedAt: e.doc.purchasedAt ?? null,
          sourcePlanName: e.doc.sourcePlanName ?? null,
          sourcePlanSets: e.doc.sourcePlanSets ?? null,
          sourcePlanQty: e.doc.sourcePlanQty ?? null,
          // 同一次購買共用一個 key，app 寫入時換成真的 purchaseId
          purchaseKey: e.doc.purchaseKey ?? null,
        })),
        visits: p.days.filter((d) => d.filled.length).map((d) => ({
          date: d.date,
          status: 'done',
          slots: d.filled.map((f) => ({
            entitlementKey: f.slot.entitlementKey,
            courseName: f.slot.courseName,
            startsAt: f.match?.startsAt ?? null,
            endsAt: endOf(f.match?.startsAt ?? null, f.slot.courseName,
              f.match?.durationMin ?? minutesOf.get(f.slot.entitlementKey)),
            roomName: f.match?.room ?? null,
            therapistName: f.match?.therapistName ?? null,
            // 併進四選一的那一列（ILIB）記成選了那一台，蓋過行事曆上讀到的
            equipmentName: f.slot.forceEquipment ?? f.match?.equipmentName ?? null,
            ivProductName: f.match?.ivProductName ?? ivNameOf(f.slot.ivProductId)
              ?? productOf.get(f.slot.entitlementKey) ?? null,
            confidence: f.match?.confidence ?? null,
            evidence: f.match?.evidence ?? null,
          })),
        })),
      };
    }),
    // 已確認、還沒來 —— 所以是 confirmed 不是 done，會算進「已排未上」
    futureVisits: r.leftover.future.map((x) => ({
      customerName: nameOf(x.customer), date: x.event.date, status: 'confirmed',
      courseName: x.course, startsAt: timeOf(x.event),
      evidence: x.event.summary, include: false,
    })),
    missingFromSheet: r.leftover.calendarOnly.map((x) => ({
      customerName: nameOf(x.customer), date: x.event.date, courseName: x.course,
      startsAt: timeOf(x.event), evidence: x.event.summary,
      sheetHasThatDay: x.sheetHasThatDay, include: false,
    })),
    eventCandidates: r.leftover.personal.flatMap((e) => {
      // 她決定過的蓋過照標題判的（改分類、改起訖、整筆不匯）
      const dec = r.eventDecisions?.get(`${e.date}|${e.summary}`) ?? null;
      if (dec?.skip) return [];
      const auto = classifyEvent(e.summary);
      const kind = dec?.kind ?? auto.kind;
      const why = dec?.kind || dec?.startDate ? `照你之前的決定${dec.why ? `：${dec.why}` : ''}` : auto.why;
      const startDate = dec?.startDate ?? e.date;
      const endDate = dec?.startDate ? (dec.endDate ?? dec.startDate) : e.endDate;
      // **休假一律是整天。** 休假講的是「那幾天她根本不在」（`CONTEXT.md`），
      // 一筆 23:00 開始的休假沒有意義 —— 而 23:00 正是行事曆時間欄歪掉的樣子
      // （317 筆裡 27 筆落在凌晨，見 references/findings.md）。
      //
      // 判準刻意不是「標題有沒有寫時間」：`6／17開會補休` 的 `6／17` 是日期，
      // 但認時間的那一支會把它讀成 18:00。與其修那支正則（它同時餵著來訪配對），
      // 不如認清休假本來就不需要時間 —— 少一條會過期的規則。
      const wholeDay = e.allDay || kind === 'leave';
      return [{
        title: e.summary,
        // endDate 是真的結束日，不是 startDate 抄一份 —— 跨天的事件靠它才進得去
        startDate, endDate,
        // 整天事件不給時間（`timeOf()` 不猜標題）。endTime 一律 null：
        // 行事曆的時間欄會歪（量到過 3:45 存成 18:00），startTime 是從標題認的，
        // 兩邊拿不同來源湊一組起訖，會湊出結束比開始早的時段。
        allDay: wholeDay,
        startTime: wholeDay ? null : timeOf(e), endTime: null,
        // 日曆上的哪一類（ADR-0045）。`note` 走 notes 集合，另外兩個走 events。
        // `category` 是給舊版 app 讀的：它只認得 'leave' 與 'personal'，
        // 沒有待辦這一類，所以待辦在那裡退回行事備註 —— 少一個分類，
        // 不是多一筆讀不懂的資料。
        kind,
        category: kind === 'leave' ? 'leave' : 'personal',
        why,
        repeats: e.repeats, include: false,
      }];
    }),
    ambiguous: r.ambiguous.map((a) => ({ ...a, who: a.who.map(nameOf) })),
    // 讀不出來的那幾筆。**列出來**才不會又是一次「東西不見了，而畫面上什麼都沒說」。
    unreadable: (r.unreadable ?? []).map((x) => ({
      title: x.summary, raw: x.raw, why: x.why,
    })),
  };
}

// ---------- 報告 ----------

const width = (t) => [...String(t)].reduce((n, ch) => n + (/[⺀-꓏가-힣豈-﫿︰-﹏＀-｠]/.test(ch) ? 2 : 1), 0);
const padStart = (t, to) => `${' '.repeat(Math.max(to - width(t), 0))}${t}`;
const pad = (t, to) => `${t}${' '.repeat(Math.max(to - width(t), 0))}`;

/**
 * 讀舊表時發現的問題，攤平成一列一筆。
 *
 * `planForSheet()` 一直都算得出這些，只是以前只有 app 那一頁在讀。
 * 那一頁拿掉之後（ADR-0047）唯一看得到的地方就是這份報告。
 */
function sheetProblems(r) {
  return (r.plans ?? []).flatMap((p) => (p.problems ?? []).map((x) => ({
    name: p.customerName || p.sheetName, where: x.where, raw: x.raw, why: x.why,
  })));
}

/** B2 驗證對不上的那幾條，攤平成一列一筆。 */
function purchaseProblems(r) {
  return (r.plans ?? []).flatMap((p) => (p.purchaseProblems ?? []).map((why) => ({
    name: p.customerName || p.sheetName, raw: p.source ?? '', why,
  })));
}

export function reportText(r) {
  const L = [];
  const slots = r.plans.flatMap((p) => p.days.flatMap((d) => d.filled));
  const high = slots.filter((s) => s.match?.confidence === 'high').length;
  const low = slots.filter((s) => s.match?.confidence === 'low').length;
  const miss = slots.filter((s) => !s.match).length;
  const conflicts = r.plans.flatMap((p) => p.days.flatMap((d) => d.conflicts.map((c) => ({ p, d, c }))));

  // ③ 那一段的內容。**算在這裡**是為了讓最上面那句「要你判斷的有幾件」數得到它 ——
  // 一份兩百多行的報告，沒有人會為了找 ③ 而往回捲。
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

  L.push('試算表 × 行事曆 — 對帳報告（還沒有寫入任何東西）', '');
  L.push(`行事曆涵蓋 ${r.span[0]} ～ ${r.span[1]}，共 ${r.events.length} 筆事件`
    + (r.events.filter((e) => e.endDate > e.date).length
      ? `（其中 ${r.events.filter((e) => e.endDate > e.date).length} 筆跨天）` : ''));
  if (r.unreadable?.length) {
    L.push(`  ⚠ 另外有 ${r.unreadable.length} 筆讀不出來，底下 ⑦ 列出來`);
  }
  L.push(`試算表 ${r.plans.length} 張分頁，${slots.length} 個時段`);
  L.push(`  三方對得上（人＋日期＋療程）  ${high}`);
  L.push(`  要你確認（只寫了一半）        ${low}`);
  L.push(`  配不到，時間維持不詳          ${miss}`);
  L.push('');

  // 要她判斷的有幾件，一句話講完並且指到段號。
  // ⑥ 那兩百筆**不算在裡面** —— 那是一份清單，不是一份問題；把它算進來，
  // 「有 213 件要判斷」會讓真正要判斷的 30 件看起來不值得找。
  L.push('━━━ 這份報告要你判斷的有 ━━━');
  L.push(`   ① 兩邊講的不是同一件事　${conflicts.length}`);
  L.push(`   ② 行事曆有、試算表沒勾　${r.leftover.calendarOnly.length}　← 做了卻沒打勾，次數會少算`);
  L.push(`   ③ 試算表有、行事曆沒有　${orphans.length}`);
  L.push(`   ④b 兩個人都可能　${r.ambiguous.length}`);
  L.push(`   ⑤ 未來的預約　${r.leftover.future.length}`);
  L.push(`   ⑥ 對不到客戶的　${r.leftover.personal.length}　（這一段是清單不是問題，慢慢挑）`);
  if (sheetProblems(r).length) L.push(`   ⓪b 舊表本身讀到的問題　${sheetProblems(r).length}`);
  if (purchaseProblems(r).length) L.push(`   ⓪c 購買名稱對不上的　${purchaseProblems(r).length}　← 合併時逐條問她`);
  if (r.decisionLog?.misses.length) L.push(`   ⓪d 找不到對象的決定　${r.decisionLog.misses.length}　← 舊表多半改過了，要重新問她`);
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

  const renamed = r.plans.filter((p) => !p.skip)
    .map((p) => [p.customerName, displayName(p.customerName, { renames: r.renames, sheetName: p.sheetName })])
    .filter(([raw, name]) => raw !== name);
  if (renamed.length) {
    L.push('━━━ 匯進 app 的客戶名稱 ━━━');
    L.push('   舊表的 A2 把名字、病歷號、器材偏好擠在同一格。拿掉的東西沒有掉 ——');
    L.push('   它們已經收進那位客戶的備註了。', '');
    for (const [raw, name] of renamed) L.push(`   ${short(raw)}　→　${name}`);
    L.push('');
  }

  // 讀舊表的時候發現的東西。**跟行事曆無關**，所以不編進 ①～⑥ 那幾段 ——
  // 那幾段講的都是「兩邊對不對得起來」。
  //
  // 這一段 2026-08-23 補回來：app 那側原本有一頁在讀 `planForSheet()` 的
  // `problems`，那一頁拿掉之後（ADR-0047）這些就沒有任何地方看得到了。
  // 拿真檔跑會有 28 筆，其中「勾了 3 次但總次數只有 1」那種是真的會在
  // 資料健檢上變成額度超用的。
  const sheet = sheetProblems(r);
  if (sheet.length) {
    L.push(`━━━ ⓪b 舊表本身讀到的問題 ${sheet.length} 筆 ━━━`);
    L.push('   讀她的舊表時發現的，跟行事曆無關。有幾種是「這一格沒有匯進去」，');
    L.push('   有幾種是「匯進去之後資料健檢會報」。', '');
    let who = '';
    for (const x of sheet) {
      if (x.name !== who) {
        who = x.name;
        L.push(`   ── ${short(who)}`);
      }
      L.push(`      ${x.where ? `${x.where}｜` : ''}${x.raw ? `「${short(x.raw)}」｜` : ''}${x.why}`);
    }
    L.push('');
  }

  // B2「購買名稱」拿應有次數驗過一次（`planForSheet()` 的 `purchaseProblems`）。
  // 她 2026-09-13：「所有的方案課程加購都可以再用各種課程的應有次數去驗證一次，
  // 然後合併的時候也可以再問我一次」—— 所以這一段每一條都要問，不要替她決定。
  const bought = purchaseProblems(r);
  if (bought.length) {
    L.push(`━━━ ⓪c 購買名稱對不上的 ${bought.length} 筆 ━━━`);
    L.push('   B2 寫的方案、套數、健檢、加購，拿 D 欄的應有次數對一次。對不上的列在這裡，');
    L.push('   匯進去的是 D 欄那一份 —— 每一條都要問她哪一邊對。', '');
    let who = '';
    for (const x of bought) {
      if (x.name !== who) {
        who = x.name;
        L.push(`   ── ${short(who)}${x.raw ? `（B2：「${short(x.raw)}」）` : ''}`);
      }
      L.push(`      ${x.why}`);
    }
    L.push('');
  }

  // 她回答過的決定套用了什麼。**找不到對象的排最前面** —— 一條安靜失效的決定跟沒有決定長得一模一樣
  const log = r.decisionLog;
  if (log && (log.applied.length || log.misses.length)) {
    L.push(`━━━ ⓪d 照她之前的決定改的 ${log.applied.length} 條`
      + `${log.misses.length ? `，找不到對象的 ${log.misses.length} 條` : ''} ━━━`);
    if (log.misses.length) {
      L.push('   這幾條這一次沒有用上，多半是舊表或行事曆改過了。要重新問她，不要安靜地略過：', '');
      for (const m of log.misses) L.push(`   ⚠ ${m}`);
      L.push('');
    }
    for (const a of log.applied) L.push(`   ✓ ${a}`);
    L.push('');
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
    L.push(`   ${x.event.date} ${timeOf(x.event) ?? ''}`
      + ` ${short(x.customer)}｜${x.course}｜「${x.event.summary}」`);
  }
  L.push('');

  const sorted = [...r.leftover.personal]
    .map((e) => ({ e, ...classifyEvent(e.summary) }))
    .sort((a, b) => (a.e.date + a.e.summary).localeCompare(b.e.date + b.e.summary));
  const tally = (k) => sorted.filter((x) => x.kind === k).length;

  L.push(`━━━ ⑥ 對不到客戶的 ${r.leftover.personal.length} 筆，全部列在這裡 ━━━`);
  L.push(`   休假 ${tally('leave')}　待辦 ${tally('note')}　行事備註 ${tally('personal')}`);
  L.push('   顏色分不出來（實測 9 種顏色底下都混著來訪與雜事），所以是照標題判的，');
  L.push('   判準寫在 `classifyEvent()`。**分類是建議，不是結論** —— app 那一頁每一列');
  L.push('   都改得掉，而且已經發生的一律預設不勾。', '');
  let month = '';
  for (const { e, kind, why } of sorted) {
    if (e.date.slice(0, 7) !== month) {
      month = e.date.slice(0, 7);
      L.push(`   ── ${month}`);
    }
    L.push(`   ${e.date} ${padStart(e.allDay ? '整天' : timeOf(e) ?? '', 5)}  ${pad(KIND_LABEL[kind], 10)}${e.summary}`
      + (e.endDate > e.date ? `　（到 ${e.endDate}，共 ${daysOf(e)} 天）` : '')
      + (e.repeats ? '　（重複事件）' : ''));
    // 判成休假的那幾筆一定要看得到理由：那幾天會整片排不進去，
    // 而「陳小美休假」跟「休」在清單上只差三個字。
    if (kind === 'leave') L.push(`${' '.repeat(24)}└ ${why}`);
  }

  if (r.unreadable?.length) {
    L.push('');
    L.push(`━━━ ⑦ 這 ${r.unreadable.length} 筆讀不出來 ━━━`);
    L.push('   `DTSTART` 解不出日期，所以整筆沒有進到上面任何一段。');
    L.push('   不是「沒有這幾筆」，是「讀不到」—— 兩件事的處理方式不一樣。', '');
    for (const x of r.unreadable) {
      L.push(`   ${x.why}｜「${short(x.summary)}」｜原文：${x.raw || '（空的）'}`);
    }
  }
  return L.join('\n');
}

/** 一筆事件橫跨幾天。同一天是 1。 */
const daysOf = (e) => Math.round(
  (Date.parse(`${e.endDate}T00:00:00Z`) - Date.parse(`${e.date}T00:00:00Z`)) / 86400000,
) + 1;

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
    therapistAliases: aliases.therapistAliases ?? {},
    renames: aliases.renames ?? {},
    doctors: aliases.doctors ?? [],
    noise: aliases.noise ?? [],
    today: arg('today', new Date().toISOString().slice(0, 10)),
    decisions: arg('decisions') ? JSON.parse(readFileSync(arg('decisions'), 'utf8')) : null,
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
