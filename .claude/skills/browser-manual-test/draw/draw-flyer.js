// 「方案文宣」：假方案「測試方案」、四個項目
window.drawFlyer = async () => {
  const W = 1000, H = 1100, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.fillStyle = '#111';
  x.font = 'bold 56px sans-serif'; x.fillText('測試方案', 60, 100);
  x.font = '34px sans-serif'; x.fillText('總價格 $150,000', 60, 160); x.fillText('會籍 1 年(限本人)', 560, 160);
  x.font = '24px sans-serif'; x.fillText('分類', 70, 230); x.fillText('項目', 230, 230); x.fillText('次數', 860, 230);
  x.strokeStyle = '#333'; x.lineWidth = 2; x.strokeRect(40, 195, 920, 50);
  const items = [['醫師門診','復健科醫師門診','30min','6'],['物理賦能課程','高能量雷射 或 超磁場 或 INDIBA','共計60min','12'],['靜脈雷射','經皮靜脈雷射','60min (不可更換項目)','20'],['諮詢','營養師諮詢','20min','4']];
  items.forEach((it, i) => { const y = 245 + i * 120; x.strokeRect(40, y, 920, 120); x.font = '24px sans-serif'; x.fillText(it[0], 60, y + 68); x.font = '28px sans-serif'; x.fillText(it[1], 230, y + 50); x.font = '22px sans-serif'; x.fillStyle = '#555'; x.fillText(it[2], 230, y + 90); x.fillStyle = '#111'; x.font = '34px sans-serif'; x.fillText(it[3], 870, y + 70); });
  const b = await new Promise(r => c.toBlob(r, 'image/png')); return new File([b], 'fake-flyer.png', { type: 'image/png' });
};
