# 日曆抽屜裡勾一件待辦：一張卡片、當場勾掉

Status: done
來源：使用者，2026-09-05（spec.md 的第一）
動工前先讀：`docs/adr/0020`、`0044`、`0045`、`SPEC.md` 第 8.6 節（1254 行那一段）

## 原話

> 我發現日曆的 todo 勾掉他會問確認，然後我按確認之後他又會立刻跳出要不要收回？
> 而且就算我關掉這個收回，在這天的抽屜上他還是顯示沒被勾掉，要我重新整理後才會
> 勾掉。我希望是我勾掉然後按確定後，他就直接勾掉，而且不要跳出要不要收回的確認。

## 她按到的那三下

日曆 → 點一天（抽屜滑上來）→ 點抽屜裡那一列待辦：

| 第幾下 | 畫面 | 程式 |
|---|---|---|
| 1 | 抽屜上滑出那一天 | `openDay()` → `sheet.update` 之外只畫這麼一次 |
| 2 | 浮出一張 `role="dialog"` 的卡片，上面一顆「做完了，勾掉」 | `openNoteCard()` → `paint(n)` |
| 3 | 按下去 → **卡片消失、同一個位置又浮出一張**，這次那顆按鈕寫著「拿回來，還沒做」 | `paint(next)` |

第 3 下之後她關掉那張卡片，回到抽屜 —— **那一列還是沒有勾掉的樣子**。

## 這是兩個 bug，不是一個

### (a)「又跳出要不要收回」＝ 卡片重畫其實是關掉再開一張

`openNoteCard()` 勾完之後呼叫 `paint(next)`，而 `paint()` 做的是
`openCard({...})`。`ui/components/card.js` 的 `openCard()` **第一行就是
`closeCard()`** —— 舊那一張的節點被 `remove()` 掉，然後一張全新的
`.popcard-backdrop` 塞回 `document.body`。

所以在她眼裡那不是「同一張卡片換了一顆按鈕」，是**一張關掉、另一張跳出來**。
而新那一張最顯眼的東西是主要按鈕上的五個字：

```
拿回來，還沒做
```

那句話讀起來就是「要不要收回？」。她沒有看錯，畫面真的又問了她一次。

### (b)「抽屜還是沒勾掉」＝ 那一塊從頭到尾只畫過一次

`openDay()` 把 `dayHtml(data, date, today)` 當成 `openSheet()` 的 `body` 傳進去，
之後**沒有任何一條路會再畫它**。勾掉那一下改到的是：

- Firestore 裡那一筆（真的寫進去了）
- `data.notes[i]`（`openNoteCard()` 有就地換掉，這一段是對的）
- 卡片自己（`paint(next)`）

三樣都對，就是沒有人告訴抽屜。而卡片關掉時跑的 `onClose: () => render(el)`
重畫的是**月曆那一片**（`paint()` 換的是 `el.innerHTML`）—— 抽屜掛在
`document.body` 底下，不在 `el` 裡面，所以它一個字都不會變。

她說的「重新整理後才會勾掉」正是這件事：重新整理會關掉抽屜，再開一次才重畫。

## 她說的「收回」是哪一個

畫面上這一刻有兩個東西可以叫做「收回」，**只有一個要動**：

| | 是什麼 | 這一支怎麼處理 |
|---|---|---|
| 新跳出來那張卡片上的「拿回來，還沒做」 | 一張 `aria-modal` 的對話框，在她剛按完之後**擋在畫面中間** | **拿掉** —— 勾完就把卡片收起來 |
| 底部 toast 上的「復原」 | `ui/toast.js` 的 `saved()`，8 秒後自己消失，不擋任何東西 | **不動**（SPEC 第 6.3 節要求每一次寫入都給得起） |

分界很清楚：她說的是「**跳出**要不要收回的**確認**」。toast 不跳、不確認、
不擋路，而且它是「按錯了救得回來」的那一半 —— 拿掉它等於把一個真的護欄
換成一次順手。如果她要的其實是連 toast 都不要，那是另一件事（要改的是
`withSaveState` 的 `undoable`），這一支不做。

## 要做什麼

### 1. 勾完就關卡片 —— **但只有資料真的變了才關**

```js
const next = await toast.withSaveState(plan.run, { success: plan.success });
// data 那一份先更新（抽屜等一下要用它重畫）
const i = (data.notes ?? []).findIndex((x) => x.id === current.id);
if (i >= 0) data.notes[i] = next;

if (Boolean(next.done) !== Boolean(current.done)) {
  closeCard();          // → onClose 會 render(el)，月曆那一片跟著更新
  return;
}
paint(next);            // 沒有真的變：留在原地，照實說
```

**那個 `if` 不是防禦性寫法，它是這一支唯一不能拿掉的判斷。**
營養品的提醒沒給完時，`data/notes.js` 的 `recordDelivery()` 刻意把它留成
`done: false` 只換掉文字（她的原話：「假設我當天忘記給了，然後可以記我給了
那些多少」）。那一次**她按了「勾掉」而它沒有被勾掉** —— 卡片這時候關掉，
畫面就在說一件資料庫沒有發生的事（SPEC 第 6.9 節）。

`tests-e2e/specs/01-products.spec.js` 的 **J-E9 正是在盯這一條**：它在部分交付
之後讀 `[data-tick]` 的字，期待卡片還開著而且還寫著「做完了，勾掉」。
無條件關卡片會讓它紅掉，而**它紅得對**。

### 2. 抽屜就地重畫

`sheet.update(html)` 早就存在，而且 `ui/components/sheet.js` 上它的註解寫的就是
這件事：「只換內容，不關掉也不重設捲動位置 —— **勾一筆隨手記不該把她捲回最
上面**」。它從來沒有被日曆用過。

擋路的是**那些 `[data-open]` 的監聽是逐顆掛上去的**：

```js
sheet.el.querySelectorAll('[data-open]').forEach((btn) => btn.addEventListener(...))
```

`sheet.update()` 換掉整塊 body，那些節點連同監聽一起沒了。所以要接的是
`openSheet()` 的 `onMount` —— **它在每一次 `update()` 之後都會被呼叫**，
而那正是它存在的理由：

```js
function openDay(el, data, date) {
  const today = todayISO();
  const wireRows = (drawer) => {
    drawer.querySelectorAll('[data-open]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const [what, id] = btn.dataset.open.split(':');
        openDetail(el, data, what, id, date, repaint);
      }),
    );
  };
  const sheet = openSheet({ ..., body: dayHtml(data, date, today), onMount: wireRows });
  const repaint = () => sheet.update(dayHtml(data, date, today));
  ...
}
```

**只有 `[data-open]` 那一圈搬進 `onMount`。** `wireLongPress()` 與
`wireAddMenu()` 都委派在 `sheet.el` 上，而 `sheet.el` 在 `update()` 之後還是
同一個節點 —— 搬進去就會每重畫一次多掛一組，那是這個 repo 修過三次的同一種
（`ui/components/actions.js` 的 `wireLongPress` 檔頭、`views/home.js` 的
`openQuick()`）。抬頭那顆「＋」在 `tools` 那一格，也不在 body 裡。

`repaint` 只往下傳給待辦那一種（`openDetail()` 多收一個選填參數）。來訪與
行事備註的卡片沒有勾這回事，改一筆走的是 `refreshAfterAction()`，那條路
本來就會把抽屜整個重開。

### 3. 「確認」那一張不拿掉

她說的是「我勾掉然後**按確定後**」—— 那張讀取卡片留著。而且它是 SPEC 第 8.6 節
寫死的：

> 待辦那一類點一筆時，「勾掉」那一顆就長在讀取卡片上 —— 這是唯一一個不必先按
> 鉛筆的動作（ADR-0045）。

**要考慮但不做的那一種**：把抽屜裡的待辦改成「點一下就勾掉」（其他四個入口
的 `note.row()` 就是這樣）。它會讓日曆跟另外四個入口一致，但代價是日曆上點
一列的意思從「看看這是什麼」變成「做掉它」—— 而同一張抽屜裡的來訪、行事備註
點下去都還是「看」。這一支不做，理由寫在這裡是為了下次有人想做時看得到。

## 順手會修掉、但要講出來的一件

現在 `paint()` 每重畫一次就會觸發舊卡片的 `onClose` → `render(el)`，也就是
**每按一次「勾掉」都會重讀一整個月的來訪、行事備註、隨手記、四份主檔與備忘錄**。
改成「變了就關、沒變才 `paint()`」之後，這條路一次寫入最多只會 `render()` 一次。

## 一起要檢查的

- **`refreshAfterAction()` 不動。** 長按那條路（`noteQuickActions()`）已經是
  「關掉抽屜 → `render()` → 用新資料重開同一天」，它一直是對的，只是比較閃。
- **`state.data` 與抽屜手上那一份會分岔。** `render()` 之後 `state.data` 是新的
  物件，而抽屜的閉包還握著舊那一份（我們就地補過的那一份）。今天就是這樣，
  這一支不改它 —— 但 `repaint()` 讀的一定要是**抽屜手上那一份**，不是
  `state.data`，不然會畫出一份跟她剛剛那一下無關的資料。
- **`mountNoteEditor()` / `mountEditor()` / `pickCustomer()` 也會呼叫
  `sheet.update()`**，所以 `onMount` 在那幾張表單上也會跑一次。它只做
  `querySelectorAll('[data-open]')`，在表單上抓到零顆，安全。
- **月檢視的色點**：`noteAsBar()` 與 `notesOn()` 讀的都是同一份 `data.notes`，
  `render(el)` 會重畫它們。
- `docs/常見問題.md` 沒有這一條，補一條（見 issue `04`）。

## 驗證

**手動**（日曆抽屜）：
1. `#/calendar` → 點一個有待辦的日子 → 抽屜滑上來
2. 點那一列 → 卡片浮出來，按鈕寫「做完了，勾掉」
3. 按下去 → **卡片自己收掉，不再跳第二張**；底部 toast 說「勾掉了」＋「復原」
4. **抽屜還開著，那一列當場變成勾掉的樣子**（`kind-todo--done`），不用重新整理
5. 再點那一列 → 卡片這次寫「拿回來，還沒做」→ 按下去 → 卡片收掉、那一列復原
6. 抽屜捲到一半再勾一筆 → **捲動位置不動**

**手動**（營養品的提醒，那一條不可以被順手改掉）：
7. 一筆掛了營養品的待辦 → 點開 → 勾掉 → 面板問「給了什麼？」→ **只點掉一款**
   → 確認 → **卡片留在原地**，按鈕還是「做完了，勾掉」，文字換成剩下的那幾款

**自動**：`tests-e2e/specs/19-untick-and-drawer-todos.spec.js` 加一節（見 `04`）。
