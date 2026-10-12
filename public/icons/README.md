# 圖示

這裡的四張 PNG 都由 `scripts/make-icons.mjs` 從 `scripts/icon-source.jpg` 產生。
要換圖就換那一張來源圖再跑一次（`node scripts/make-icons.mjs`），不要直接改這裡的檔案。

| 檔案 | 誰用 |
|---|---|
| `icon-192.png`、`icon-512.png` | 瀏覽器分頁、Android 的一般圖示（滿版） |
| `icon-maskable-512.png` | Android 會裁成圓形或圓角的那一種 —— 圖縮在中央八成，外面一圈留邊 |
| `apple-touch-icon.png` | iOS「加入主畫面」（180，iOS 自己裁圓角） |

iOS 必須手動「加入主畫面」才會變成 PWA，Android Chrome 會自己跳安裝提示。
**已經加到主畫面的那一顆不會自己換圖與名字** —— iOS 要刪掉再加一次，見 `docs/常見問題.md`。
