# 登入不先載 Google 的 iframe（看 05 的數字決定做不做）

Status: todo
段：五（medium／high —— 看要不要做）
Blocked by: 05（她手機上的數字）、07
動工前先讀：`public/js/data/firebase.js` 的 `initFirebase()`（`getAuth(app)`）；`public/js/data/auth.js` 的 `signIn()`（裝到主畫面的那一顆走 `signInWithRedirect`、瀏覽器分頁走 `signInWithPopup`）與 `prefersRedirect()`／`INSTALLED`；
Firebase JS SDK 的 `getAuth()` 預設帶 `browserPopupRedirectResolver`，而它在**手機瀏覽器**上 `_shouldInitProactively` 為真 → 初始化時先載 `apis.google.com` 的腳本與 `authDomain` 的 iframe，載完才開始還原登入；
`docs/STAGING.md`（Authorized domains、`authDomain`）；E2E 登入那幾支（模擬器的 Auth）

## 她要的

> 有辦法讓app先呈現畫面嗎…

（D 那一招我說「動到登入流程，要在你手機上試登入一次」；她沒有另外回答，照「量完再決定」。）

## 為什麼會這樣

`getAuth()` 在手機上會先把彈窗／轉頁登入要用的 iframe 準備好，**才**去還原這一台記著的登入 —— 這一台一年登入一次，卻每次打開都等它。

## 做法（方向）

只在 05 量出來「登入」那一格（在 07、08 之後）還明顯（例如 > 0.5 秒）時做：

1. `initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })`，**不帶** `popupRedirectResolver`
2. `signIn()` 自己帶 `browserPopupRedirectResolver`（`signInWithPopup(auth, provider, resolver)`／`signInWithRedirect(...)`）
3. 轉頁登入回來那一次：開機叫 `getRedirectResult(auth, browserPopupRedirectResolver)` —— **不用自己記 `sessionStorage`**（過目查到：它本來就先看 SDK 自己記的那一筆，沒有轉頁登入時不會載 iframe）
4. 模擬器那條路（`connectAuthEmulator`）照舊
5. **拿掉 iframe 之後登入那一格不會變成 0**：開機照樣要等一趟 `accounts:lookup`（還原登入時 SDK 會去確認帳號還在）—— 量出來的期望值寫進 ADR

## 判準

- E2E：登入頁 → 登入（模擬器）→ 進得去；重新整理 → 不用再登入
- 開機時沒有任何請求打到 `apis.google.com` 或 iframe（模擬器下的路徑是 `/emulator/auth/iframe`，不是 `/__/auth/iframe`）；按「登入」之後才有。
  **這一條要用手機的 UA 跑**：E2E 用的是桌機 Chrome 的 UA（`playwright.config.js:94`），桌機本來就不先載 iframe —— 不換 UA 的話改之前就是綠的
- **她的手機上**（staging，驗收清單）：設定 → 登出 → 從主畫面那一顆打開 → 登入（轉頁那一條）→ 回到 app 是登入好的；05 那一張卡「登入」那一格改之前／改之後
- 這一行會不會讓裝到主畫面的那一顆**登入之後回不來**？（這是唯一會讓她整天用不了 app 的失敗，staging 上手機點過才進 main）

## 連動

- `docs/STAGING.md`：登入相關的設定有沒有要改（Authorized domains 不用動的話寫一句「不用動」）
- 新的 ADR，或併進 07 那一支
