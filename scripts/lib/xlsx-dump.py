#!/usr/bin/env python3
"""她從 Google 試算表匯出的 .xlsx → 一份 JSON（給 `scripts/sheet-xlsx-verify.mjs` 跟替身比）。

node 這邊沒有讀 xlsx 的套件，這台有 python ＋ openpyxl（`python -I`）—— 這支只負責把檔案攤開，
**一個字都不判斷**：哪一格算不算一樣、Google 的預設值是什麼，全部在 `scripts/lib/sheetXlsxCompare.mjs`。

每一張分頁：名字、藏起來了沒、凍結（`freeze_panes`，例如 `F6` ＝五列五欄）、格線、合併、欄寬（字元寬）、列高（點）、
以及「有東西」的格子（有值、有底色、字型不是預設、有對齊、有換行、數字格式不是 General、有備註、有框線）：
值、底色、字型（名字、字級、粗體、顏色）、左右／上下對齊、換行、數字格式、備註（Google 的 note 匯出成 comment）、四邊框線。

**輸出有真名**（分頁名就是客戶的名字）：只寫進 stdout 給 node 讀，不要直接印到畫面上。

用法：
    python -I scripts/lib/xlsx-dump.py <匯出的.xlsx>
"""

import datetime
import json
import sys

try:
    import openpyxl
except ImportError:  # pragma: no cover - 沒裝就講清楚
    sys.stderr.write('需要 openpyxl：pip install openpyxl\n')
    sys.exit(2)


def rgb_of(color):
    """openpyxl 的顏色 → 'FFRRGGBB' 字串；主題色、索引色、沒有 → None（讀的那一側當預設）。"""
    if color is None:
        return None
    if getattr(color, 'type', None) != 'rgb':
        return None
    value = color.rgb
    return value if isinstance(value, str) else None


def value_of(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        # Google 把字認成日期的那一種：另外標起來，讀的那一側算成「被認成日期」
        return {'$date': value.isoformat()}
    if isinstance(value, (int, float)):
        return value
    return str(value)


def side_of(side):
    if side is None or not side.style:
        return None
    return [side.style, rgb_of(side.color)]


def cell_of(cell):
    out = {}
    v = value_of(cell.value)
    if v is not None:
        out['v'] = v
    fill = cell.fill
    if fill is not None and fill.patternType == 'solid':
        rgb = rgb_of(fill.fgColor)
        if rgb:
            out['fill'] = rgb
    font = cell.font
    if font is not None:
        f = {}
        if font.name:
            f['name'] = font.name
        if font.sz is not None:
            f['sz'] = float(font.sz)
        if font.b:
            f['b'] = True
        color = rgb_of(font.color)
        if color:
            f['color'] = color
        if f:
            out['font'] = f
    al = cell.alignment
    if al is not None:
        if al.horizontal:
            out['h'] = al.horizontal
        if al.vertical:
            out['vt'] = al.vertical
        if al.wrap_text:
            out['wrap'] = True
    if cell.number_format and cell.number_format != 'General':
        out['fmt'] = cell.number_format
    if cell.comment is not None:
        out['note'] = cell.comment.text
    border = cell.border
    if border is not None:
        b = {}
        for key, name in (('l', 'left'), ('r', 'right'), ('t', 'top'), ('b', 'bottom')):
            s = side_of(getattr(border, name))
            if s:
                b[key] = s
        if b:
            out['border'] = b
    return out


def interesting(c, default_font):
    """預設長相的格子不收（Google 是 Arial 10、沒有底色、沒有對齊……）—— 不然一頁 1000 列 × 26 欄全倒出來。
    `default_font`：這一份檔案自己的預設字型（styles.xml 的第一個；Google 匯出的是 Arial，別的程式寫的可能是 Calibri 11）。"""
    font = c.get('font', {})
    key = (font.get('name'), font.get('sz'))
    plain_font = set(font.keys()) <= {'name', 'sz'} and (
        key == default_font or (key[0] in (None, 'Arial') and key[1] in (None, 10.0)))
    others = set(c.keys()) - {'font'}
    return bool(others) or not plain_font


def default_font_of(wb):
    fonts = getattr(wb, '_fonts', None)
    if fonts:
        f = fonts[0]
        return (f.name, float(f.sz) if f.sz is not None else None)
    return ('Arial', 10.0)


def sheet_of(ws, default_font):
    sv = ws.sheet_view
    widths = []
    for dim in ws.column_dimensions.values():
        if dim.width and dim.min and dim.max:
            widths.append([dim.min, dim.max, float(dim.width)])
    heights = []
    for row, dim in ws.row_dimensions.items():
        if dim.height is not None:
            heights.append([row, float(dim.height)])
    cells = []
    for row in ws.iter_rows():
        for cell in row:
            # 合併區裡左上角以外的格子（MergedCell）照樣收：要不要比是讀的那一側決定
            c = cell_of(cell)
            if c and interesting(c, default_font):
                cells.append([cell.coordinate, c])
    fmt = ws.sheet_format
    return {
        'name': ws.title,
        'state': ws.sheet_state,
        'freeze': ws.freeze_panes,
        'gridlines': sv.showGridLines is not False,
        'merges': sorted(str(r) for r in ws.merged_cells.ranges),
        'widths': sorted(widths),
        'defaultColWidth': float(fmt.defaultColWidth) if fmt.defaultColWidth else None,
        'baseColWidth': float(fmt.baseColWidth) if fmt.baseColWidth else None,
        'defaultRowHeight': float(fmt.defaultRowHeight) if fmt.defaultRowHeight else None,
        'heights': sorted(heights),
        'cells': cells,
    }


def main():
    if len(sys.argv) != 2:
        sys.stderr.write('用法：python -I scripts/lib/xlsx-dump.py <匯出的.xlsx>\n')
        sys.exit(2)
    wb = openpyxl.load_workbook(sys.argv[1])
    default_font = default_font_of(wb)
    out = {'sheets': [sheet_of(ws, default_font) for ws in wb.worksheets]}
    # ensure_ascii：Windows 的主控台編碼不是 UTF-8，跳脫成 \\uXXXX 最穩
    sys.stdout.write(json.dumps(out, ensure_ascii=True))


if __name__ == '__main__':
    main()
