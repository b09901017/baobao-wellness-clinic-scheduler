# 01 給營養品選到已經約好的那一包：改原本那一筆提醒，不長第二筆

Status: done

## 她看到什麼

11/7 在 HTC 上點小工具（隨手記段九驗收）：「給營養品，我給完之後會記成兩筆一樣的待辦」。
staging 讀回來對得上：同一包營養品兩筆字一樣、日期一樣的提醒，建立時間差 14 秒（只讀、只印時間與數字）。

## 為什麼

`domain/products.js` 的 `givableBags()` 檔頭寫好了：**已經有提醒的那幾包照樣列、標「已經約了」—— 選了它是改那一筆提醒的日期，不是長出第二筆**。
但三個「記一筆」的入口存檔一律 `notesData.create()`：右下角泡泡（`home.js` 的 `wireQuick()`，小工具的「給營養品」打開的就是它）、
首頁那張卡（`addNote()`）、日曆的待辦編輯器（新增那一筆）。客戶詳情的「約時間」本來就改那一筆（`existingReminder()`），沒有這個問題。
E2E `98` 的 C3 與 `99` 的 W1 是照著現在的行為寫的（選了 `ent-c-prod`、它本來就有 `note-c-give`，測試要求多一筆）。

## 做法

- `data/notes.js` 多一支 `createOrMove(data)`：沒有 `entitlementId` 跟 `create()` 一樣；有的話**寫之前照 `entitlementId` 重讀**（`existingReminder()`：還活著、還沒勾），
  有就改那一筆（字換成這一次的；**選了日期才改日期**，沒選就留著原本的），沒有才建 —— 畫面手上那一份是打開那一刻的（lessons 二）
- 三個入口改叫它；改到既有那一筆時 toast 講「這一包本來就有提醒，改好了」（不是「記下來了」）
- 營養品的提醒不能連在一起（`validateNote()`），所以改那一筆不用管 `linkId`
- Android 不建營養品的提醒（「給營養品」打開網頁），`NotesWriter` 不用抄這一支

判準：**這一行會不會讓一包營養品有兩筆還沒勾的提醒，或讓一筆不是營養品的隨手記被當成提醒改掉？**

## 做完時留下的

- `data/notes.js` 的 `createOrMove()`（＋存完那一句 `createOrMoveSay()`）；三個入口改叫它：`home.js` 的 `wireQuick()`（泡泡）與 `addNote()`（首頁那張卡）、`calendar.js` 新增那一筆
- 單元測試 `tests/notes-give-bag-once.test.js`（真的 `data/notes.js` ＋ 替身 Firestore，五題；改之前全紅）
- E2E `98` 的 C3、`99` 的 W1 原本要求多一筆，改成「改本來那一筆、不長第二筆」（W1 另外量選了今天就改成今天、toast 講「本來就有提醒」）；本機 98＋99 共 17 支綠
- 日曆待辦編輯器那一條沒有 E2E 量「選到已經約了的那一包」（同一支 `createOrMove()`，單元測試蓋到）
- staging 上 11/6 那兩筆重複的不動（她在網頁上刪掉其中一筆就好）；`CLAUDE.md`「營養品的形狀或交付」那一列補一句
