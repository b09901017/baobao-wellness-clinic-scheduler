# 營養點滴在日曆上寫品項，品項有自己的簡寫

Status: todo
來源：使用者，2026-09-08（需求 3）
她定下來的：**月曆與日／週那一列兩邊都印簡寫**
動工前先讀：`docs/adr/0078`（全站只有三種名字）、`domain/naming.js` 的檔頭

## 她要的

> 日曆那邊可以把營養點滴的品項寫出來，就不用寫營養點滴了，
> 而是像這樣，誰，品項，診間（嘉玲/雪顏亮彩/.10）
> 每個營養點滴的品項都可以有簡寫（雪顏亮彩可以簡稱雪），
> 這個簡寫可以在設定的營養點滴品項那邊編輯

## 三件事

### 一、品項主檔多一格「簡寫」

`domain/masterData.js` 的 `validators.ivProducts` 現在只擋名稱空白。
加上 `nameVariants(r)` 那一份（別稱最多 12 字）—— 跟診間、器材、課程同一支。

`ui/views/masterList.js` 的 `ivProducts` 那一格加欄位，**照抄 `rooms` 那一列**
（它已經有「簡寫」了）：`summary`、`fields`、`parse`、`blank` 四處。

種子**不填簡寫**：她自己決定哪幾款要縮寫（「護心抗老」四個字就還好，
「雪顏亮彩」才需要）。填了預設值等於替她做決定。

### 二、`slotName()` 認得品項

現在的 `master` 是 `{ courses, equipment }`，要變成
`{ courses, equipment, ivProducts }`。

規則接在器材那一條旁邊，**順序是：品項 → 器材 → 課程**：

```
這一段有 ivProductId → 印品項的別稱（沒設就退回全名）
否則有 equipmentId   → 印器材的別稱
否則                 → 印課程的別稱
```

**分鐘照樣接**（`withMinutes()` 一個字不用改）—— 營養點滴的
`durationChoices` 沒填就不接，那是對的。

`'line'` 那一條**完全不動**：貼給客人的那一句仍然只講課程。
她說「LINE 寫法我還沒想到」，所以這一輪不做變數 —— 見底下。

### 三、每一個組 `master` 的地方都要補 `ivProducts`

有一支測試盯著這件事（`會講「那天做了什麼」的畫面都帶著主檔`），
要把它擴充成也盯 `ivProducts`。要補的地方：

- `ui/views/calendar.js:141`（`master: { courses, equipment }`）
- `ui/views/customerDetail.js:1764`
- `ui/views/home.js` 兩處（`d.master`、`taskVisits.master`）
- `ui/views/progress.js:70`
- `ui/views/visitEditor.js`（傳的是 `all`，本來就有 `ivProducts`）
- `ui/views/naming.js`（預覽）
- `domain/messages.js` 的呼叫端

## LINE 那一句的「品項」變數：**這一輪不做**

她說「我還沒想到」。現在硬做一個 `{品項}` 佔位符進 `lineName`，
會多出一種只有一個欄位用得到的語法 —— 而 `domain/messageTemplates.js` 的檔頭
已經寫過同一件事（模板只有 `{}` 一種語法，條件判斷不搬進去）。

**留一個 issue 給她想清楚再做**（`.scratch/.../issues/14`，先不開）。
這一輪 LINE 草稿上營養點滴仍然是課程的字。

## 測試

- `slotName()`：有品項就印品項的簡寫；沒設簡寫退回品項全名；
  沒有品項退回器材／課程（既有行為一個字不變）
- `'line'` 那一條在有品項時**仍然印課程** —— 這一條要有測試釘住
- 品項簡寫超過 12 字擋下來
- 主檔那一頁存得進、讀得回
