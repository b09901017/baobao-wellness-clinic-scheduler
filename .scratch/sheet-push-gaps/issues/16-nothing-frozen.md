# 16 試算表什麼都不凍結

Status: done
Blocked by: 15（同一份 `.gs`、版號接著升）

## 她要的

> 對了剛剛忘了說，我也不想要1~5欄被凍結，就都不要有凍結，太割裂了

（第四輪之後欄已經不凍結了，凍結的是第 1～5 列：提醒、名字、購買名稱＋合計、產生時間、矩陣表頭。）

## 做法

- `.gs` 拿掉 `renderCustomer()` 那一行 `setFrozenRows(MATRIX_HEADER_ROW)`；`resetSheet()` 本來就先把凍結歸 0，以前凍結的列與欄重畫時一起拿掉
- `LAYOUT_VERSION` 6 → 7（指紋一樣的頁也要重畫一次，凍結才會拿掉）

## 判準

- 畫完一頁，凍結的列與欄都是 0 嗎？畫的過程中有沒有任何一次凍結大於 0？
- 以前凍結了五列五欄的那一頁，重畫之後都拿掉了嗎？
- 除了凍結，其餘有沒有任何一格變了？

## 做完時留下的

- `.gs` 拿掉那一行、`LAYOUT_VERSION` 7；測試：`sheet-layout`「14」那一組兩條改成列與欄都不凍結、`sheet-script` 的渲染那一條、`sheet-xlsx-verify` 凍結那一條（匯出檔凍結了 F6 → 列、欄各一個不一樣）；
  `sheet-fingerprint`（version 7）、`sheet-gs-batch`（版號 7 的雜湊）
- `scripts/sheet-gs-compare.mjs` 跟 develop（版號 6）比正式站那一包：四步都只有 34 頁的凍結列不一樣
- 文件：ADR-0178（推翻 ADR-0176 的「列照舊凍結」）、索引、CLAUDE.md「試算表的 SYNC_FORMAT」那一列的版面、SPEC.md
