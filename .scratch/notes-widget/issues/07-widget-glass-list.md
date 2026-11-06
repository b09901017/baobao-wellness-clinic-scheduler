# 07：桌面小工具本體（D 半透明便利貼）

Status: done
Blocked by: 06；**樣子定稿她點頭了**（HANDOFF「要她決定的」—— 主控做 D＋2 合起來的定稿圖）

## 動工前先讀

- `spec.md`「一」的「小工具樣子」「清單順序」那幾條
- `mockups/` 第一組 D、定稿圖（主控放在 `mockups/` 的 `final-*`）
- 06 的「做完時留下的」（資料層怎麼叫、排序與分組的那一支在哪）
- ADR-0178（連在一起的怎麼列：清單類一組一列、日期寫最近要到的那一天、「共 N 天」）
- `public/js/domain/notes.js` 的分組那一支（04 寫的）、`ui/components/note.js` 的 `row()`（日期過了的顏色、客戶那一顆的樣子）

## 她要的

> 我很喜歡D 像毛玻璃一樣透出桌布，跟桌面融在一起。＋和麥克風收在右上角，下面全部給清單。

> 小工具列哪些 我希望是優先列今天的。其他都照建議做

## 要做的

- Glance 小工具，4×2 預設、可以拉大拉小（拉小少列幾筆）。標題「隨手記」＋數字（**一組算 1**，跟網頁首頁那個數字同一個算法）、右上角＋與麥克風（麥克風這一輪照定稿：不畫或灰的）
- **毛玻璃**：root `@android:id/background`、背景半透明（alpha 1–254，先固定一個值）、provider 宣告 `widgetStyle`／`widgetSize`（三星 One UI 7+ 的條件，見 spec「查過的事實」）。**在她的三星上真的試**；HTC 上是半透明
- **清單**：還沒勾的；順序 今天 → 日期過了 → 沒日期 → 以後的（越近越上）、每段新的在上；段跟段之間一條很淡的線、不寫標題；連在一起的一組一列（最近要到的那一天＋「共 N 天」）；
  客戶那一顆、日期那一顆跟網頁 `row()` 同一套意思（日期過了是過期的字色、不是紅底）
- 點勾選框 → 勾掉（連在一起的整組），**劃線 3 秒後才離開**，3 秒內再點回來；營養品的提醒點勾 → 打開網頁 app 那一筆問「給了哪幾款」（深連結；**怎麼帶到那一筆**要看網頁 app 有沒有那一條網址 —— 沒有就開隨手記那一頁、記進中途發現）
- 點字 → 08 的選單；點標題 → 打開網頁 app 的 `#/todo/notes`（裝到主畫面的 PWA 會接走它的網址）
- **什麼時候更新**（她 11/6「好照建議做」）：
  - 在小工具上自己寫的（記下、勾掉、改）**存完馬上更新**（寫完把手上那一份換掉、`GlanceAppWidget.update()`，不等下一次同步）
  - **按 ＋ 打開輸入卡時抓一次最新的**（`NotesSync.pull()`）
  - 背景 **WorkManager 定時（`PeriodicWorkRequest` 最短 15 分鐘）**叫 `NotesSync.pull()`：只問 `updatedAt` 大於游標的（含刪掉、勾掉的 —— 拿掉它們）、沒變是 1 次讀取；**不加會叫醒手機的條件**（不用 `setExpedited`、不用鬧鐘），手機睡著讓系統延後；要網路（`NetworkType.CONNECTED`）
  - 游標與那一份清單存在手機上（`NotesSync.State`：清單＋游標），開機、重裝之後沒有就整份讀一次；換帳號或登出就清掉
  - 即時推播（雲端小程式＋FCM）**這一輪不做**（她的 backlog）
- 沒登入／沒網路／讀不到：講一句，不是一片空白
- 麥克風：**畫成灰的放著**（定稿圖 1）；這一輪點了不會開語音
- 深色／淺色：**她自己切換**（她 11/6：「我希望可以自己切換，也許可以長按那個app圖示，捷徑圖示，可以切換?之類的都可以」）→ 長按「隨手記」圖示的捷徑（app shortcuts）切換，預設淺色；切了小工具馬上換。深色的樣子照定稿圖 3

## 判準

- 小工具上的順序跟 spec 寫的四段一樣嗎？連在一起的有沒有被列成好幾列？（情境檔：06 的 `notes-parity.json` 加小工具排序的情境）
- 勾一組裡的一筆，網頁 app 上那一組每一天都勾掉了嗎？3 秒內拿回來，網頁上是不是一筆都沒被勾（或勾了又拿回來，稽核講得通）？
- 營養品的提醒能不能在小工具上不經過「給了哪幾款」就被勾掉？（不行）
- 三星上是毛玻璃、HTC 上字看得清楚嗎？（截圖只留在她電腦）

## 做完時留下的

段六（2026-11-06）。HTC U23 Pro（Android 13）接本機模擬器那一支（`-Pemulator`）走過；三星的毛玻璃段九實機試。

**程式在哪**

| | 檔案 | 是什麼 |
|---|---|---|
| core | `WidgetList.kt`＋`WidgetListTest`（6 題） | 小工具的清單順序：今天（一組有一天是今天就算）→ 過了 → 沒日期 → 以後的（越近越上）；每段新的在上、**還沒回到伺服器的（`createdAt` null）最上面**。分組照 `groupLinked()`。網頁沒有這一支，不在情境檔 |
| app | `widget/NotesWidget.kt` | Glance 1.2.0 的小工具＋receiver＋`TickAction`。最外層 `appWidgetBackground()`（root id `@android:id/background`）＋半透明底 |
| | `widget/WidgetStore.kt` | 手上那一份（`files/widget-state.json`：清單、游標、劃線中的、上次讀到沒、是誰的）＋深色淺色（`SharedPreferences` 的 `widget/dark`，預設淺色）。改一律 `update()`（同一把鎖） |
| | `widget/WidgetSync.kt` | 什麼時候更新：`pull()`（`NotesSync.pull`）、`afterLocalWrite()`（**讀快取**換清單：自己剛寫的已經在裡面，不等網路）、`localWrite()`（08 用）、`tick()`／`settle()`、`PullWorker`（WorkManager 15 分、要網路、不叫醒手機） |
| | `widget/Palette.kt` | 照 `tokens.css` 抄的顏色（淺色深色），底 alpha `0xD9`（≈85%） |
| | `widget/ThemeShortcut.kt` | 長按圖示的捷徑（動態，`ShortcutManagerCompat`）：一顆「小工具改成深色」／「改成淺色」，點了 `ThemeActivity`（沒有畫面）換、小工具馬上換、捷徑的字換成反過來 |
| | `res/xml/notes_widget_info.xml`、`values/attrs.xml` | 4×2、可以拉大拉小、`updatePeriodMillis=0`；三星的 `widgetStyle="colorful"`／`widgetSize`（名字照 github.com/thatjoshguy67/blur-widget-demo 的 attrs） |

**什麼時候更新（她 11/6 決定的，照做）**：小工具上自己勾的馬上（劃線）；`MainActivity` 打開時對一次、登入時整份讀一次、登出清掉；
小工具放上桌面／開機（`onUpdate`）手上沒有就讀一次；背景 `PeriodicWorkRequest` 15 分（`KEEP`，最後一個小工具拿掉就取消）。**按 ＋ 時抓一次在 08**（輸入卡打開那一下）。

**勾掉**：畫面先劃線，寫入與 3 秒在 `AppScope` 跑 —— **Glance 一個小工具的點擊是一個一個處理的**，在 callback 裡等 3 秒的話，3 秒內那一下「拿回來」要等劃線結束才輪到它（HTC 上第一版就是這樣：拿不回來）。
寫入排同一個隊（`writes` Mutex，先來先寫）。劃線那幾列照原本的樣子放回清單排回原位（`shown()`）；劃線過了 60 秒還在（程式被收掉）當成離開了。
驗過：連在一起的一組（3 天）勾 → 1.5 秒內再點 → 模擬器裡 3 筆都是 `done: false`、稽核 6 則（3 則勾掉、3 則拿回來，同一個 actor）；單筆勾掉 3 秒後離開、數字 6 → 5。

**跟定稿圖不一樣、我自己定的**（不問她，寫在這裡）：
- 一列右邊的丸子照網頁 `row()` 的順序（客戶、日期、共 N 天），但**今天的日期不畫**、日期只寫 `11/4` 不寫星期（定稿圖 1 那樣；窄）
- 麥克風畫成灰的、**點了沒反應**（不講話 —— 小工具上跳 toast 要另開一個 receiver，不值得）
- 沒登入：「還沒登入：點這裡打開「隨手記」登入」；第一次讀：「讀取中…」；空的：「沒有還沒做的事」；讀不到：清單照舊、底下一行「讀不到最新的（網路？）· 顯示的是 H:mm 的」
- 「把小工具放到桌面」一顆放在 app 裡（`requestPinAppWidget`，系統跳框問）
- **裝了新版之後小工具會停在轉圈**（Glance 的那一段跟著程式被換掉）→ receiver 收 `MY_PACKAGE_REPLACED` 自己畫一次（HTC 上重裝驗過）。App Distribution 更新（09）也走這條

07 的時候 ＋ 先開 `MainActivity`、點字先開網頁那一筆（`WebLinks.note`）—— 08 換成輸入卡與選單。

**沒驗到的**：三星的模糊（段九）；營養品的提醒點勾會開 staging 的網頁（手機上的瀏覽器登入著真的 staging，沒點）；長按 app 圖示的捷徑那一下（HTC 的 app 抽屜找不到中文名字）——
捷徑有登記（`cmd shortcut get-shortcuts` 看得到「小工具改成深色」），`ThemeActivity` 用暫時 exported 的那一支 `am start` 換過深色淺色、截圖看過（深色跟定稿圖 3 一樣），裝回去的是沒 exported 的。
