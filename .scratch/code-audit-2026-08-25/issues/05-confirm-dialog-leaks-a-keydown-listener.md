# 二次確認每開一次就在 document 上多留一顆監聽

Status: done
來源：全庫掃描，2026-08-25（`../spec.md`）

## 症狀

`ui/components/dialog.js` 的 `confirmAction()` 把 Esc 那顆監聽掛在
`document` 上，而**只有真的按了 Esc 那一條路會把它拆掉**：

```js
document.addEventListener('keydown', function onKey(e) {
  if (e.key === 'Escape') {
    document.removeEventListener('keydown', onKey);   // ← 只有這一條
    finish(false);
  }
});
```

用叉叉、按「取消」、按「確定」、點背景、按返回鍵關掉的那些，監聽全部留著。
她一個晚上壓二十幾位、每一筆都跳一次「已經在 Abovee 壓好表了嗎」，
就是二十幾顆。

這個 repo 已經修過三次同一種「監聽越掛越多」，而那三次都是只有把畫面
真的開開關關才看得到。

## 做了什麼

`onKey` 提到 `finish` 外面，`finish()` 不管從哪一條路進來都先
`removeEventListener`。

## 驗證

- `npm test`
- 瀏覽器：開關十次二次確認框，`getEventListeners(document)`（Chrome DevTools）
  的 keydown 不應該累積
