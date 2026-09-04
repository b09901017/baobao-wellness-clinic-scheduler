# 勾掉一張任務要講得出「誰的、哪一天的、哪一項」

Status: done
來源：使用者，2026-09-04（spec.md 的第二，句子那半）
動工前先讀：`docs/adr/0062`、`domain/audit.js` 的「一則稽核 → 一句話」那一段

## 原話

> **勾掉了誰的什麼時候甚麼的 examine／耀聖（不要像現在只寫勾掉 examine）**

## 現在印的是什麼

`domain/audit.js` 的任務那一條：

```js
{
  when: (e, f) => coll(e) === 'tasks' && f.some((x) => x.key === 'done'),
  say: (e, f, d) => ({
    lead: f.find((x) => x.key === 'done').after ? '勾掉' : '取消勾選',
    text: d.kind ?? '任務',
  }),
}
```

畫面上是「勾掉 客戶A・Examine」。而她一天勾八張 Examine，八列一模一樣，
於是收成一則寫「×8」—— **看起來很乾淨，可是她一個都認不出來**。
這一頁的用途是「確認有沒有漏掉登記」，而「勾掉 Examine ×8」回答不了
「那第九個人呢」。

## 為什麼以前不講

同一支檔案的檔頭寫著：

> 任務身上**沒有**來訪日與課程名，也不該有（那會是第二份會對不起來的資料）。
> 不要拿 `dueDate + 1` 反推來訪日：取消類的任務不是那樣算的
> （`taskRules.js` 的 `cancelTask()`），反推出來的日期會有一部分是錯的。

**這兩句都還是對的，一個字都不改。** 缺的不是欄位，是**一次查詢**：
任務身上有 `visitId`，而稽核那一則的 `before` 是**整份舊文件**
（`data/repo.js` 的 `commit()`），所以 `before.visitId` 問得到。
去把那一筆來訪讀回來就有日期與課程名了。

這跟名字那件事是**同一個作法**：額度與本輪可用性身上沒有 `customerName`，
所以畫面解析完傳一支 `nameOf` 進來（ADR-0062 的最後一段）。這一支多一個
`visitOf`，形狀一模一樣。

## 要做什麼

### 1. `domain/audit.js`：多一個解析器

```js
describeParts(event, { nameOf = null, visitOf = null } = {})
```

任務那一條改成：

```js
say: (e, f, d) => {
  const v = visitOf?.(d.visitId) ?? null;
  return {
    lead: f.find((x) => x.key === 'done').after ? '勾掉' : '拿回來',
    text: bits(when(v?.date), courses(v ?? {}), d.kind ?? '任務'),
  };
}
```

四條規矩：

- **問不到就不講，不要編一個。** 讀不到那一筆來訪（被刪了、`visitId` 是空的、
  整批讀失敗）就退回現在的「勾掉 客戶A・Examine」。`bits()` 本來就會把
  null 丟掉，所以退路是免費的。
- **順序是「日期・課程・種類」**，跟上下那幾列（壓表、確認、簽單）對齊：
  `勾掉 客戶A・9/14(日)・復能・Examine`。掃的時候日期在同一欄。
- **不碰 `taskLine()`。** 那一支是「一列任務要顯示什麼」（CLAUDE.md 的連動表，
  三個地方讀它），它的順序是「種類・日期・課程」，那是**清單**的順序；
  這裡是**句子**，句子的主詞是那一場。兩支不共用，但兩支要講同一組事實。
- **「取消勾選」順便改成「拿回來」** —— CONTEXT.md 的「拿回來」那一條把
  「取消勾選」列為 _Avoid_，而這是它在全站最後一個沒改到的地方。

### 2. `domain/dayReview.js`：轉一手

`reviewOf(events, { limit, nameOf, visitOf })`，原樣傳給 `describeParts()`。
另外導出一支給畫面用的：

```js
/** 這一批稽核裡要讀哪幾筆來訪才講得完整。 */
export function visitIdsIn(events)   // 勾掉／拿回來的任務身上的 visitId
```

**放在 domain 而不是畫面**：知道「哪一種事件身上有 visitId」是這一層的事，
畫面去猜等於第二份會對不起來的規則。

### 3. `ui/views/home.js`：多讀一趟

`loadReview()` 撈完稽核之後：

```js
const ids = visitIdsIn(events);
const visits = ids.length ? await visitsData.getMany(ids).catch(() => new Map()) : new Map();
```

- **讀不到不擋這一塊** —— 跟客戶名單同一條規矩：少幾個日期不是少一塊畫面。
- **讀回來的存進模組層的一張 Map，翻日子不重讀同一筆。**
  她一天勾的任務通常十幾張，翻七天就是七次小查詢。
- 跟客戶名單同一趟 `Promise.all`，不要多等一輪。

## 這會讓「×8」變成八列

**這是她要的。** 「勾掉 Examine ×8」是現在那個收合規則的產物：句子一模一樣才
收得起來。八張 Examine 掛在八個不同的人、八個不同的日子，句子一變成
「勾掉 客戶A・9/14(日)・復能・Examine」就再也收不起來了。

代價是⑤登記掛號那一段從一列變成八列。三件事讓它還是掃得完：

- **照人**那個看法（預設）本來就一個人一組，八列本來就散在八個抬頭底下。
- issue 02 的閘門把額度那些副作用整批拿掉了，總行數是**減**的。
- 收合規則不動 —— 真的一模一樣的（同一場的同一種連按兩次）還是收得起來。

## 一起要檢查的

- `#/settings/audit` 與客戶詳情的「變更紀錄」**沒有傳 `visitOf`**，
  所以那兩頁照舊印「勾掉 客戶A・Examine」。**這是刻意的**：那兩頁是查證用的，
  多一次 N 筆來訪的查詢換一個日期不划算，而且那一列展開就看得到 `visitId`。
  在 `describeParts()` 的檔頭寫清楚。
- `tests/audit.test.js` 有沒有對「勾掉 Examine」那一句做斷言 —— 有就一起改，
  並且補一條「沒傳 `visitOf` 時退回原本那一句」。
- 「拿回來」改字之後 `grep` 一次全站還有沒有「取消勾選」。

## 驗證

- `npm test`
- 瀏覽器：勾掉一張 Examine → 「今天做了什麼」寫「勾掉 客戶A・9/14(日)・復能・Examine」
- 瀏覽器：勾掉一張任務之後把那筆來訪刪掉 → 那一列退回「勾掉 客戶A・Examine」，不是壞掉
- 瀏覽器：`#/settings/audit` 那一列照舊


## Comments

**2026-09-04 —— done。** `describeParts()` 多一個 `visitOf`，形狀跟 `nameOf`
一模一樣。`say()` 多收一個 `ctx` 參數，只有任務那一條在用。

**「取消勾選」兩處都改成「拿回來」**（任務那一條與隨手記那一條），
`grep` 過全站的畫面字串，沒有第三處。

**順手補了 `FIELD_LABELS` 的 `body` 與 `courseIds`**：截圖時看到備忘錄那一則
印著「改了 二返怎麼跑・body」—— 英文欄位名。備忘錄是 2026-09-03 才有的東西
（ADR-0069），那兩欄從來沒進過那張表。

實際畫出來是「勾掉 客戶A・8/30(日)・復能・Examine」，照人那一格不含名字。
