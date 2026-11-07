// 「顧客會訂購單」：假名「測試丁」，8萬筋骨強身×1、功醫健檢 5萬 勾、手寫「任選(30)」×10、尚欠尾款 3萬、OB 備註
window.drawOrderForm = async () => {
  const W = 1100, H = 1300, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#111'; x.font = 'bold 40px sans-serif'; x.fillText('顧客會訂購單　2026年11月', 40, 70);
  x.font = '30px sans-serif'; x.fillText('貴賓姓名：', 40, 140);
  x.font = '36px cursive'; x.fillText('測試丁', 210, 142);
  x.font = '26px sans-serif'; x.fillText('顧客會日期：', 600, 140); x.font = '32px cursive'; x.fillText('11/7', 790, 142);
  x.strokeStyle = '#333'; x.lineWidth = 2;
  const rows = ['5萬元氣馥活 (A)','5萬元氣馥活 (B)','8萬筋骨強身','19萬健體養護','30萬安心守護','20萬鑽心無價 (B)','32.8萬鑽心無價 (A)','100萬全方位幸福'];
  x.font = '26px sans-serif'; x.fillText('套組', 60, 215); x.fillText('數量', 560, 215); x.fillText('備註', 760, 215);
  rows.forEach((r, i) => { const y = 250 + i * 60; x.strokeRect(40, y - 36, 1020, 60); x.font = '26px sans-serif'; x.fillStyle = '#111'; x.fillText(r, 60, y); if (r === '8萬筋骨強身') { x.font = '34px cursive'; x.fillText('1', 590, y + 2); } });
  let y = 250 + rows.length * 60; x.strokeRect(40, y - 36, 1020, 60); x.font = '26px sans-serif'; x.fillText('功醫健檢　☐ 5萬　☐ 12萬', 60, y);
  x.font = '34px cursive'; x.fillText('✓', 205, y + 2);
  y += 60; x.strokeRect(40, y - 36, 1020, 60); x.font = '34px cursive'; x.fillText('任選(30)', 60, y + 2); x.fillText('10', 590, y + 2);
  y += 60; x.strokeRect(40, y - 36, 1020, 60);
  y += 110; x.font = '28px sans-serif'; x.fillText('尚欠尾款：', 60, y); x.font = '34px cursive'; x.fillText('3萬', 230, y + 2);
  y += 80; x.font = '28px sans-serif'; x.fillText('OB專員備註：', 60, y); x.font = '32px cursive'; x.fillText('測試備註 週三下午', 270, y + 2);
  const b = await new Promise(r => c.toBlob(r, 'image/png'));
  return new File([b], 'fake-orderform.png', { type: 'image/png' });
};
