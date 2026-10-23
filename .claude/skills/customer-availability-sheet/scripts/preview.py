# 交付前自己看一眼：把幾頁轉成 HTML、用 Chromium 截圖，存在 <月份資料夾>/過程/預覽/。
#
#   python preview.py <月份資料夾> [頁碼 …]     頁碼從 0 起；沒給就挑三頁（第一頁、最多字的、最多紅的）
#
# 截圖有真名：只用 Read 自己看，不發佈、不貼出去。這台沒有 Excel／LibreOffice，所以用這個近似 Excel 的畫法。
import sys, os, html, json, subprocess
sys.stdout.reconfigure(encoding='utf-8')
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
folder = sys.argv[1]
plan = json.load(open(os.path.join(folder, '過程', '讀法.json'), encoding='utf-8'))
wb = load_workbook(os.path.join(folder, f"客戶時間-{plan['month']}.xlsx"))
out_dir = os.path.join(folder, '過程', '預覽')
os.makedirs(out_dir, exist_ok=True)


def to_html(ws):
    merged, skip = {}, set()
    for m in ws.merged_cells.ranges:
        merged[(m.min_row, m.min_col)] = (m.max_row - m.min_row + 1, m.max_col - m.min_col + 1)
        for r in range(m.min_row, m.max_row + 1):
            for c in range(m.min_col, m.max_col + 1):
                if (r, c) != (m.min_row, m.min_col):
                    skip.add((r, c))
    out = ['<html><body style="margin:12px;font-family:Microsoft JhengHei"><table style="border-collapse:collapse;table-layout:fixed">']
    out.append('<colgroup>' + ''.join(f'<col style="width:{(ws.column_dimensions[get_column_letter(c)].width or 8.43) * 7.5:.0f}px">' for c in range(1, ws.max_column + 1)) + '</colgroup>')
    for r in range(1, ws.max_row + 1):
        out.append(f'<tr style="height:{(ws.row_dimensions[r].height or 18) * 1.33:.0f}px">')
        for c in range(1, ws.max_column + 1):
            if (r, c) in skip:
                continue
            cell = ws.cell(row=r, column=c)
            st = []
            if cell.fill and cell.fill.fill_type == 'solid':
                st.append(f'background:#{cell.fill.start_color.rgb[-6:]}')
            if cell.font:
                if cell.font.color is not None and isinstance(cell.font.color.rgb, str):
                    st.append(f'color:#{cell.font.color.rgb[-6:]}')
                st.append(f'font-size:{(cell.font.sz or 11) * 1.33:.0f}px')
                if cell.font.b:
                    st.append('font-weight:bold')
            a = cell.alignment
            if a and a.horizontal:
                st.append(f'text-align:{a.horizontal}')
            st.append('vertical-align:' + ('top' if a and a.vertical == 'top' else 'bottom' if a and a.vertical == 'bottom' else 'middle'))
            for side in ('left', 'right', 'top', 'bottom'):
                s = getattr(cell.border, side)
                if s and s.style:
                    col = s.color.rgb[-6:] if s.color is not None and isinstance(s.color.rgb, str) else '999999'
                    st.append(f'border-{side}:{3 if s.style == "thick" else 1}px solid #{col}')
            st.append('white-space:pre-wrap;overflow:hidden;padding:1px 6px')
            rs, cs = merged.get((r, c), (1, 1))
            v = cell.value
            out.append(f'<td rowspan={rs} colspan={cs} style="{";".join(st)}">{html.escape(str(v)) if v is not None else ""}</td>')
        out.append('</tr>')
    out.append('</table></body></html>')
    return ''.join(out)


picks = [int(x) for x in sys.argv[2:]]
if not picks:
    def count(ws, rgb):
        return sum(1 for row in ws.iter_rows() for c in row if c.fill and c.fill.fill_type == 'solid' and c.fill.start_color.rgb[-6:] == rgb)
    sheets = wb.worksheets
    picks = sorted({0, max(range(len(sheets)), key=lambda i: count(sheets[i], 'DFE6FB')), max(range(len(sheets)), key=lambda i: count(sheets[i], 'F4B9B3'))})

files = []
for i in picks:
    path = os.path.join(out_dir, f'p{i:02d}.html')
    open(path, 'w', encoding='utf-8').write(to_html(wb.worksheets[i]))
    files.append(path)
subprocess.run(['node', os.path.join(HERE, 'shot.mjs'), *files], check=True, cwd=REPO)
print('截好了：' + '、'.join(os.path.relpath(f[:-5] + '.png', folder) for f in files))
