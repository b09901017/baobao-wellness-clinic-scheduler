# 圖示

`icon-192.png` 與 `icon-512.png` 由 `scripts/make-icons.py` 產生，
純 Python 寫 PNG，沒有相依套件。要改樣式就改那支再跑一次。

manifest 同時把 512 那張當作 `maskable` 用，所以圖案刻意收在中央約 50%
的範圍內 —— Android 會把 maskable 圖示裁成圓形或圓角，靠邊的東西會被切掉。

iOS 必須手動「加入主畫面」才會變成 PWA，Android Chrome 會自己跳安裝提示。
