// 「療程單」：假名「測試戊」、編號 90000005、EECP 共40堂、三列（有簽名＋扣課章）
window.drawSheet = async () => {
  const W = 1000, H = 1200, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#111'; x.font = 'bold 40px sans-serif'; x.fillText('EECP 體外反搏療程單', 260, 70);
  x.font = '28px sans-serif'; x.fillText('客戶姓名：', 40, 140); x.font = '34px cursive'; x.fillText('測試戊', 200, 142);
  x.font = '28px sans-serif'; x.fillText('客戶編號：', 520, 140); x.font = '34px cursive'; x.fillText('90000005', 690, 142);
  x.font = '30px cursive'; x.fillText('共40堂', 40, 200);
  x.strokeStyle = '#333'; x.lineWidth = 2; x.font = '24px sans-serif';
  const heads = ['序號','日期','客戶簽名','治療師','扣課','備註']; const xs = [40,130,300,520,700,830];
  heads.forEach((h, i) => x.fillText(h, xs[i] + 8, 250)); x.strokeRect(30, 215, 940, 50);
  const dates = ['11/2','11/4','11/6'];
  for (let r = 0; r < 8; r++) { const y = 265 + r * 60; x.strokeRect(30, y, 940, 60); x.font = '24px sans-serif'; x.fillText(String(r + 1), xs[0] + 20, y + 38);
    if (r < dates.length) { x.font = '30px cursive'; x.fillText(dates[r], xs[1] + 8, y + 40); x.fillText('Xie', xs[2] + 20, y + 40); x.fillStyle = '#c00'; x.fillText('蓋', xs[4] + 20, y + 40); x.fillStyle = '#111'; x.fillText('Lin', xs[3] + 20, y + 40); } }
  const b = await new Promise(r => c.toBlob(r, 'image/png'));
  return new File([b], 'fake-sheet.png', { type: 'image/png' });
};
