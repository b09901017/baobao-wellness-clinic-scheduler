# 開機登入不先載 Google 的那一塊（after-golive issue 09 接過來做）

Status: done（PR 進 develop；她 iPad 上還沒試）
設計照 `.scratch/after-golive-2026-10-20/issues/09-auth-without-proactive-iframe.md`；門檻（「登入」那一格 > 0.5 秒）她 iPad 上量到 1.4～3.1 秒。

## 做法（照 09，多一件）

1. `firebase.js`：`initializeAuth(app, { persistence: [indexedDB, local, session] })`（跟 `getAuth()` 同一組，記著的登入照樣讀得到），**不帶** `popupRedirectResolver`
2. `auth.js` 的 `signIn()` 自己帶 `browserPopupRedirectResolver`
3. 轉頁登入回來：`watchAuth()` 先 `getRedirectResult(auth, resolver)` 再開始聽 —— 沒有轉頁登入時它只看 SDK 自己記在 sessionStorage 的那一筆、不載 iframe；先等它是為了回來那一下不閃一下登入頁
4. **多的一件**：彈窗登入要在按下去的那一刻同步開窗，Safari／iOS／手機瀏覽器擋非同步的彈窗 —— SDK 就是為這個在那幾種上先載 iframe。所以那幾種的瀏覽器分頁也改走轉頁登入（`prefersRedirect()`），只有桌機的 Chrome／Edge／Firefox 照舊彈窗（E2E 走這條）
5. 模擬器那條路照舊

## 判準

- E2E `81` 新的一支：用 iPad 的 UA 重新打開 → 開機沒有任何請求打到 `apis.google.com` 或 `/auth/iframe`
  （改之前會打：SDK 在 iPad／手機 UA 上先載。CI 跑得到，本機這一輪不跑 E2E）
- E2E 既有的登入（桌機 UA、彈窗）照舊
- **她的 iPad 上**（測試版）：設定 → 登出 → 從主畫面那一顆打開 → 登入（轉頁）→ 回到 app 是登入好的；「打開要多久」量 5 次比改之前
- 這一行會不會讓裝到主畫面的那一顆**登入之後回不來**？（staging 上點過才進 main）
