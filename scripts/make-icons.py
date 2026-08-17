# 產生 PWA 圖示。純 Python，無相依套件：python3 scripts/make-icons.py

import zlib, struct

def chunk(t, d):
    c = t + d
    return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

def rounded(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x < x1 and y0 <= y < y1):
        return False
    for cx, cy in ((x0+r, y0+r), (x1-r, y0+r), (x0+r, y1-r), (x1-r, y1-r)):
        inx = (x < x0+r) if cx == x0+r else (x > x1-r)
        iny = (y < y0+r) if cy == y0+r else (y > y1-r)
        if inx and iny and (x-cx)**2 + (y-cy)**2 > r*r:
            return False
    return True

def render(S):
    BG   = (0x3d, 0x6c, 0xe0)
    CARD = (0xff, 0xff, 0xff)
    HEAD = (0x2a, 0x4f, 0xab)
    BAR  = (0x9c, 0xb2, 0xe8)
    u = S / 512.0
    cx0, cy0, cx1, cy1 = 136*u, 116*u, 376*u, 396*u
    rad = 30*u
    hy1 = 176*u
    rows = bytearray()
    for y in range(S):
        rows.append(0)
        for x in range(S):
            px = BG
            if rounded(x, y, cx0, cy0, cx1, cy1, rad):
                px = HEAD if y < hy1 else CARD
                if y >= hy1:
                    for by in (222*u, 282*u, 342*u):
                        if by <= y < by + 26*u and 172*u <= x < 340*u:
                            px = BAR
            rows.extend(px)
    raw = zlib.compress(bytes(rows), 9)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', S, S, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', raw) + chunk(b'IEND', b''))

for size in (192, 512):
    open(f'public/icons/icon-{size}.png', 'wb').write(render(size))
    print(f'icon-{size}.png')
