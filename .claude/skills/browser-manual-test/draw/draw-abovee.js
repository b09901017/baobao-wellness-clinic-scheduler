// 在 app 頁面裡用 canvas 畫一張「Abovee 預約清單」（假名、假病歷號），回傳 File。
// 用法（瀏覽器工具的 javascript_tool）：先貼 window.$feed（見 draw-helpers.js），再 $feed('[data-cam-album-input]', drawAbovee)
window.drawAbovee = async () => {
  const W = 1700, H = 520, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#222'; x.font = '20px sans-serif';
  x.fillText('預約日期(起)  2026/11/09        預約日期(訖)  2026/11/13', 20, 36);
  const cols = ['預約狀態','預約日期','預約時段','姓名','病歷號','課程','合併扣課','預約來源','診間','服務資源','取消原因'];
  const xs = [20,170,320,520,640,790,900,1020,1180,1330,1520];
  const rows = [
    ['待確認','2026-11-10','09:00 - 10:00','甲測試','90000001','SIS 60','','正式課','.5','林某某',''],
    ['確認前往','2026-11-10','10:30 - 11:30','乙測試','90000002','ILIB 60','','正式課','.3','',''],
    ['已取消','2026-11-11','14:00 - 15:00','丙測試','90000003','SIS 60','','顧客會','.5','林某某','客戶臨時有事'],
  ];
  x.fillStyle = '#e8eef5'; x.fillRect(10, 56, W - 20, 40);
  x.fillStyle = '#111'; x.font = 'bold 20px sans-serif';
  cols.forEach((t, i) => x.fillText(t, xs[i], 84));
  x.font = '20px sans-serif';
  rows.forEach((r, ri) => { const y = 130 + ri * 56; x.strokeStyle = '#ccc'; x.beginPath(); x.moveTo(10, y + 20); x.lineTo(W - 10, y + 20); x.stroke(); r.forEach((t, i) => x.fillText(t, xs[i], y)); });
  x.fillStyle = '#555'; x.fillText('3 筆・第 1/1 頁', 20, 330);
  const b = await new Promise(r => c.toBlob(r, 'image/png'));
  return new File([b], 'fake-abovee.png', { type: 'image/png' });
};
