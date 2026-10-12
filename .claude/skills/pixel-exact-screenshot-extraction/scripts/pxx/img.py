# 讀圖。回傳 H×W×3 的 uint8，通道順序是 BGR（整套工具都用這個順序；合成那一側也是）。
# 有 Pillow 就用；沒有（裝不起來是常態：公司網路、防毒擋 pip）就在 Windows 上叫 PowerShell
# 把 PNG 轉成不壓縮的 .bgr，之後用 numpy 直接讀。
import glob, os, re, subprocess
import numpy as np
from .conf import wpath

HERE = os.path.dirname(os.path.abspath(__file__))
_paths = {}


def register(paths):
    """記住每一張圖的路徑。stem（不含副檔名的檔名）是之後所有東西的 key。"""
    for p in paths:
        _paths[os.path.splitext(os.path.basename(p))[0]] = os.path.abspath(p)
    return list(_paths)


def _raw(stem):
    f = glob.glob(wpath('raw', glob.escape(stem) + '__*.bgr'))
    return f[0] if f else None


def load(stem_or_path):
    stem = os.path.splitext(os.path.basename(stem_or_path))[0]
    if os.path.exists(stem_or_path):
        _paths.setdefault(stem, os.path.abspath(stem_or_path))
    f = _raw(stem)
    if f is None:
        src = _paths.get(stem)
        if src is None:
            raise FileNotFoundError('不知道 %s 的原圖在哪裡：先 img.register([...]) 或跑 grid.py' % stem)
        try:
            from PIL import Image
            return np.asarray(Image.open(src).convert('RGB'))[:, :, ::-1].copy()
        except ImportError:
            pass
        if os.name != 'nt':
            raise RuntimeError('沒有 Pillow，也不是 Windows：pip install pillow')
        os.makedirs(wpath('raw'), exist_ok=True)
        subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                        os.path.join(HERE, 'to_raw.ps1'), '-Src', src, '-OutDir', wpath('raw')], check=True)
        f = _raw(stem)
    w, h = map(int, re.search(r'__(\d+)x(\d+)\.bgr$', f).groups())
    return np.fromfile(f, dtype=np.uint8).reshape(h, w, 3)


def art(a, x0, x1, y0, y1):
    """把一小塊畫成字元畫。字只有幾個像素高的時候，這比放大圖更看得出每個像素的值。"""
    chars = ' .:-=+*#%@'
    g = a[y0:y1, x0:x1].astype(np.float32).mean(axis=2)
    return '\n'.join(''.join(chars[min(9, int((255 - v) / 25.6))] for v in row) for row in g)
