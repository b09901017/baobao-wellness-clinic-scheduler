// 把 draw 函式畫出來的 File 塞進 app 的檔案輸入（相機層的相簿 input）。
window.$feed = async (sel, draw) => {
  const f = await draw();
  const input = document.querySelector(sel);
  const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'fed ' + f.name + ' ' + f.size;
};

// 幾乎全白、只有細線的圖會被 app 當成「空白」（photo.js 的 looksBlank），所以每張假單子都疊一層紙張漸層、轉成 JPEG
window.paper = async (f) => {
  const bm = await createImageBitmap(f); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
  const x = c.getContext('2d'); x.drawImage(bm, 0, 0); x.globalCompositeOperation = 'multiply';
  const g = x.createLinearGradient(0, 0, c.width, c.height); g.addColorStop(0, '#f8f5ee'); g.addColorStop(1, '#d9d4c6');
  x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
  const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  return new File([b], f.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
};
// 用法：await $feed('[data-cam-album-input]', async () => paper(await drawSheet()))
