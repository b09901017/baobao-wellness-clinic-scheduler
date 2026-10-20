# 1 億像素的照片改成用小尺寸解開

Status: done
段：一（high）
動工前先讀：`public/js/ui/components/photo.js`（檔頭的兩個坑、`shrinkPhoto()`、`drawTo()`、`looksBlank()`）；`public/js/ui/components/camera.js` 的 `addFiles()`（那一句「有一張照片讀不出來，換一張試試」）與 `shoot()`（`ImageCapture` 拍不到退回截一格）；
`shrinkPhoto()` 的呼叫端（`grep -rn "shrinkPhoto" public/js`：`camera.js` 兩處、`sheetConfirm.js` 帶 `longEdge`／`quality` 再縮一次療程單要存的那一張）；
ADR-0101（重新編碼就丟掉 EXIF／GPS —— 新的路也要經過 canvas 輸出 JPEG）；`tests/photo.test.js`；E2E `37-camera.spec.js`（第 1 條：大照片 → 長邊 2000、轉正、沒有 EXIF）；
`docs/邊界測試清單.md` M1；`lessons.md` 一（四種單子同一支）、九（看起來成功不等於成功）

## 她要的

> 第三 : 我發現正式版的鴨表拍照功能不能用?會寫說有一張照片讀不出來，換一張試試，但我換了還是讀不出來?

> 4. 剛剛貼同一張照片好像又可以了 雖然有跳出無法辨識一次，但我再試一次就又成功了? 好奇怪

## 為什麼會這樣

- 她手機原檔 12000×9000（108MP、16～19MB）。`shrinkPhoto()` 兩條路都要先整張解開（約 430MB）：
  第一條 `createImageBitmap(file, { resizeWidth, ... })`（Chromium 照樣先全解再縮）、第二條 `<img>` → `drawImage`
- Android 的 Chrome 解碼一張圖的記憶體有上限、而且看當下還有多少空的 → 丟例外或畫出空白（`looksBlank()` → `'blank'`）→ `addFiles()` 的 catch → 那一句。**時好時壞**
- 10/20 唯讀查正式站 `aiUsage/2026-10`：AI 這個月 3 次、0 次失敗 → 失敗全在縮照片這一步
- **桌機測不出來**：headless Chromium 跑 `shrinkPhoto()` 兩張 108MP 都過（0.6～0.9 秒）—— 桌機沒有解碼上限。9/18 的 staging 測試是 canvas 畫的假 JPEG
- 量過的修法：WebCodecs `ImageDecoder({ data, type, desiredWidth, desiredHeight })`。帶目標的**兩倍**（4000×3000）時 Chromium 用 JPEG 的 DCT 縮放直接解成 3000×2250（約 27MB），0.2 秒；
  只帶目標（2000×1500）會解成 1500×1125 —— **比目標小**（Chromium 選「不超過那個位元數的最大一階」），所以要帶兩倍再畫進目標尺寸的 canvas。
  `ImageDecoder` 只在 secure context 有（https、`127.0.0.1` 也算）；Safari 沒有 → 退回現在那兩條

## 做法（方向）

1. `shrinkPhoto()` 最前面多一條：有 `ImageDecoder`、`jpegInfo()` 認得原始大小時，帶 `desiredWidth`／`desiredHeight`（目標兩倍、照**沒轉之前**的寬高算）解一格 → `drawTo()` 畫進目標尺寸。
   失敗就退回現在的兩條（一條都不拿掉：Safari、iPad 靠它們）。
   **原始大小只能靠 `jpegInfo()`**（過目查到：`ImageDecoder` 的 `tracks` 只有 `frameCount`／`animated`，沒有寬高，要解完才知道）；`jpegInfo()` 只讀前 256KB，讀不到就不走新的那一條
2. **EXIF 方向**：`ImageDecoder` 吐出來的 `VideoFrame` 畫進 canvas 時有沒有照 EXIF 轉，**查不到文件、要量**（桌機與她手機各一次）。沒轉就在畫之前自己轉（`jpegInfo()` 已經讀得到方向）
3. **新的那一條的 `drawTo()` 要在 `try` 裡 `await`**：現在第一條路（`photo.js:142`）的 `drawTo()` 沒有 `await`，裡面丟的 `'blank'` 不會退回 `<img>` 那一條 —— 新的那一條照抄就是同一個洞
4. 解不開時那一句換掉：不要「換一張試試」（她每一張都一樣大）。講原因＋怎麼辦，例如「這張照片太大，手機解不開。改用中間的快門在 app 裡拍，或把相機解析度調低」—— 字照 `no-dev-words`／`ui-copy` 兩支掃字測試
5. 呼叫端三處（過目查的）：`camera.js:154`（`shoot()` 的 `ImageCapture.takePhoto()` —— 1 億像素的手機拍到的可能是原尺寸，現在是**安靜地**退回 `shrinkFrame()` 截一格，新的那一條會順便讓它拿到整張）、
   `camera.js:181`（`addFiles()`）、`sheetConfirm.js:441`（帶 `longEdge` 再縮一次療程單要存的那一張，傳進來的已經縮過，通常不會走新的那一條，但不要另寫）

## 判準

- **紅燈怎麼寫**：桌機不會失敗，所以 E2E 用 `addInitScript` 模擬手機：`createImageBitmap` 與 `<img>` 遇到超過某個像素數的圖就失敗（例如包一層：寬×高 > 50MP 丟例外／`onerror`），
  相簿選一張 sharp 做的大 JPEG（不用真的 108MP —— 門檻設低一點，例如 60MP 的上限配 64MP 的照片；也可以把門檻設到 16MP、照片 20MP，跑得快）→ 改之前講「讀不出來」（紅）、改之後送出去的是長邊 2000 的 JPEG（綠）
- 這一條會不會讓送出去的照片**沒轉正**、或**帶著 EXIF**？E2E `37` 的 C2（`:70`）**只比寬高**（`:91`）—— 沒轉正、被拉成 1500×2000 照樣綠。
  要多一道像素檢查：`phonePhoto()` 的漸層是 x → 紅、y → 綠，送出去那一張的四個角拿顏色比就知道有沒有轉對（先在舊的那一條上寫好、確認綠，再換新的那一條）
- 沒有 `ImageDecoder` 的瀏覽器（把它在 init script 裡刪掉）照舊走原本那兩條、照舊綠
- 輸出長邊照舊是 `longEdge`（不是 1500、不是 3000）
- 單元測試：選「要解成多大」的那一段若寫成純函式（例如 `decodeHint(info, longEdge)`）就在 `tests/photo.test.js` 釘：方向 6 時寬高對調再算、不放大、小照片不帶 hint
- 拿 `.local/references/abovee拍照測試/` 的一張跑一次（scratchpad 腳本，只印尺寸與毫秒，不看圖、不存）
- **她的手機上**：staging 拍 Abovee → 相簿選一張原檔、系統相機拍一張、中間的快門拍一張，各三次都不出現那一句、確認層讀得出來、照片是正的（驗收清單）

## 連動

- `docs/邊界測試清單.md` M1（寫的是「一億像素」—— 這一次的預期結果照舊；補一句要在 Android 手機上點）
- `docs/常見問題.md`：有沒有一題講「照片讀不出來」？有就改，沒有就補一題（看到什麼、為什麼、怎麼辦）
- `sw.js` 的 `VERSION`（這一段第一個動 `public/` 的升 v201）

## 做完時留下的

- `photo.js` 現在三條路：**`ImageDecoder` 帶尺寸提示**（新的，`viaDecoder()`）→ `createImageBitmap` 的 resize → `<img>`。前兩條失敗、畫出空白、或畫出來不是正的都退回下一條
- **量到的**（scratchpad，只印數字）：她的原檔 12000×9000、14～19MB，新的路 0.19～0.22 秒、送出長邊 2000；舊的路桌機 0.53 秒（桌機本來就過）。
  模擬「解出來超過 5000 萬像素就失敗、`createImageBitmap` 一律失敗」時新的路照樣 0.2 秒過
- **EXIF 方向**：Chrome 151 的 `ImageDecoder` 吐出來的那一格帶 `rotation`（方向 6 → 90），`drawImage()` 照著轉 —— 量了合成照片的四個角。
  **舊一點的 Chrome 沒有 `rotation`**：`frameUpright()` 只放行本來就不用轉的（方向 1），要轉的退回舊的兩條（她手機那幾張都是方向 1）。鏡像的四種方向不走新的路
- 提示是**目標的兩倍、照沒轉之前的寬高**（`decodeHint()`）：Chromium 挑「不超過那個像素數的最大一階（1/8）」，兩倍一定解得比目標大（推過：目標比例 r、解出來 floor(16r)/8 —— r ≥ 1/8 時 floor(16r) > 16r−1 ≥ 8r；更小的時候最小一階 1/8 本來就比 r 大）；
  兩倍已經比原圖大就不帶。方向 6 時照「沒轉之前」或「轉完」算，Chromium 解出來一樣（它看的是像素數）
- 順手修了 issue 寫的洞：`createImageBitmap` 那一條的 `drawTo()` 沒有 `await`，畫出空白丟的 'blank' 不會退回 `<img>` —— 現在在 `try` 裡 `await`、`close()` 在 `finally`
- 解不開時丟 `PhotoDecodeError`（`tooBig`：轉正後超過 `BIG_PIXELS`＝2000 萬像素），`camera.js` 照它講「太大＋按中間的快門或把照片大小調小」或「讀不出來（可能不是照片，或檔案壞了）」。
  2000 萬是挑的：手機預設多半 1200 萬，那種解不開多半是檔案壞了
- E2E `37`：C2 多四個角的顏色檢查（先在舊的路上綠過）；**P1**（模擬手機上限 1600 萬、照片 2000 萬 → 改之前紅「讀不出來」、改之後轉正的 1500×2000）、
  **P2**（刪掉 `ImageDecoder` → 舊的兩條照樣轉正）、**P3**（三條都不通 → 講「太大」「快門」、不講「換一張」）。上限是 `addInitScript` 包 `createImageBitmap`／`Image`／`ImageDecoder.prototype.decode`
- 呼叫端三處都沒改：`shoot()` 的 `ImageCapture.takePhoto()` 現在也走新的路（拍到原尺寸的話不會再安靜地退回截一格）；`sheetConfirm.js` 傳進來的已經縮過，兩倍比原圖大 → 不帶提示
- 文件：`常見問題.md` 拍照帶入多一題；`邊界測試清單.md` M1 改成「在 Android 手機上、同一張三次」
- **還沒驗的**：她手機上的 Chrome 版本有沒有 `rotation`（沒有的話方向 6 的照片走舊的路 —— 系統相機拍的直式照片可能是方向 6）；驗收清單請她三種方式各拍三次
- **`/code-review` 之後補的**：檔頭在前 256KB 找不到大小、而且是 JPEG 的，再多讀到 4MB（手機塞了大的附加資料在前面時，不然又走回整張解開）；
  要轉的照片碰上沒有 `VideoFrame.rotation` 的瀏覽器，**不先白解一次**就直接走舊的兩條。
  審查建議「沒有 `rotation` 就自己在 canvas 上轉」**沒做**：沒有那一格、可是 `drawImage()` 照樣轉的瀏覽器會被轉兩次，而桌機模擬不出那一種（刪掉那一格 Chrome 畫的時候照樣轉）
