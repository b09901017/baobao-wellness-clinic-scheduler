# 備忘錄的大輸入框捲不動，貼長文會被切掉

Status: todo
來源：她的第二項 a（`../spec.md`）
動工前先讀：ADR-0069（備忘錄只有三個欄位）、`ui/views/playbook.js` 的 `mountEditor()`

## 她看到什麼

> 目前備忘錄編輯的時候輸入框沒辦法上下滑動，有時候我會打很多字或是直接複製
> 貼上，就會沒辦法看到全部。

## 為什麼

三條規則各自都對，湊在一起就把內容鎖死了：

```css
.pbdeck        { max-height: 72dvh; align-items: stretch; }   /* 整疊最高 72dvh */
.pbcard        { display: flex; flex-direction: column; }     /* 卡片是直向 flex */
.pbedit__body  { min-height: 200px; overflow: hidden; resize: none; }
```

```js
// mountEditor()：打到哪長到哪
body.style.height = `${body.scrollHeight}px`;
```

`textarea` 是那張卡的 **flex item**，沒有寫 `flex`，所以是 `flex: 0 1 auto`
——**`flex-shrink: 1`**。JS 把高度撐到 1400px 之後，flex 為了塞進 72dvh
的卡片把它**壓回 `min-height` 的 200px**；而它是 `overflow: hidden`、
`resize: none`，於是那 1200px 的字既看不到也捲不到。

`.pbcard--edit { overflow-y: auto }` 救不了：flex 已經把每一項壓到剛好塞得下，
卡片自己沒有東西可以捲。

**閱讀那一面沒有這個問題**，因為 `.pbcard__body` 寫了 `flex: 1; min-height: 0;
overflow-y: auto` —— 少的那三行就是這一支的答案的一半。

## 改成什麼

```css
.pbedit__body {
  flex: none;                /* 不准被壓扁。這一行是修正本身 */
  max-height: 46dvh;         /* 打長了就在框裡面捲，不要把存檔鈕擠出畫面 */
  overflow-y: auto;
  overscroll-behavior-y: contain;   /* 捲到底不要把整疊帶著跑 */
}
```

```js
const grow = () => {
  body.style.height = 'auto';
  body.style.height = `${body.scrollHeight}px`;   // max-height 自己會封頂
};
body.addEventListener('input', grow);
```

`grow()` 不用改：`max-height` 會封頂，超過就由 `overflow-y: auto` 接手。
**但要多接一個 `paste` 事件**（issue 03 本來就要接），貼上之後也長一次
—— 只聽 `input` 的話 Safari 有機率漏掉那一次。

### 三個數字為什麼是這樣

| 值 | 為什麼不是別的 |
|---|---|
| `max-height: 46dvh` | 鍵盤上來之後可見高度大約剩 55dvh。46 讓「存起來／取消／刪掉」那一排一定還在畫面上 —— 打完看不到存檔鈕，等於這一格又壞了一次 |
| `flex: none` | 不能改成 `flex: 1 1 auto` + `min-height: 0`：那會讓框永遠撐滿卡片，一份三行的備忘錄底下留半個螢幕空白（那正是上一輪 `../asks-2026-09-04/spec.md` 已經改掉的東西） |
| `overscroll-behavior-y: contain` | 這一疊是橫向 snap 的，垂直捲到底再往下滑會把手勢丟給頁面 |

## 這一格還有一個沒被回報的坑：`maxlength` 攔不住貼上

`MAX_BODY` 是 5000，`<textarea maxlength="5000">`。**貼上超過的字，瀏覽器會
安靜截斷**（`maxlength` 對 paste 是硬截，不觸發任何事件）。她從 LINE 貼一大段
筆記進來，最後幾行不見了而畫面一個字都沒說。

issue 03 的 `paste` handler 順手處理：清洗完超過 `MAX_BODY` 就
`toast.info('太長了，後面 N 個字沒有貼進來（一份最多 5000 字）')`。

## 連動

| 會動到 | 為什麼 |
|---|---|
| `public/css/app.css` 的 `.pbedit__body` | 就是這一支 |
| `ui/views/playbook.js` 的 `mountEditor()` | 多接一個 `paste`（跟 issue 03 同一個 handler） |
| `tests-e2e/specs/15-playbook.spec.js` | 多一支「貼 60 行進去，最後一行捲得到」 |

`tokens.css` 不用動（沒有新顏色）。`.pbcard__body`（閱讀那一面）不用動。

## 驗收

- E2E：把 60 行塞進去 → `scrollHeight > clientHeight`（框裡真的有東西可以捲）
  且「存起來」那顆按鈕**在畫面內**
- E2E：捲到最底 → 看得到第 60 行
- 手動：iPad 上鍵盤叫出來，存檔鈕還在
