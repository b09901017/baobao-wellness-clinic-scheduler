# 候選字集。逐字讀取每一步的成本跟字集大小成正比，所以先用小的、讀不出來再換大的。
def big5(level=1):
    """Big5 常用字（level 1，約 5,400 字）與次常用字（level 2，約 7,600 字）。
    人名、地名常常落在次常用字 —— 常用字讀不出來時用 L1+L2 再讀一次。"""
    out = []
    lo_hi = (0xA4, 0xC6) if level == 1 else (0xC9, 0xF9)
    for hi in range(lo_hi[0], lo_hi[1] + 1):
        for lo in list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF)):
            try:
                ch = bytes([hi, lo]).decode('big5')
                if len(ch) == 1 and 0x4E00 <= ord(ch) <= 0x9FFF: out.append(ch)
            except Exception:
                pass
    return out


L1 = big5(1)
L2 = big5(2)
DIGITS = list('0123456789')
ASCII = [chr(c) for c in range(33, 127)]
PUNCT = list('，。、！？：；（）［］【】「」～—…．・／＋－＝％＆＠＃＊')
CJK = [chr(c) for c in range(0x4E00, 0xA000)]   # 整個 CJK 基本區，約 21,000 字


def _span(a, b):
    return [chr(c) for c in range(a, b + 1)]


# 人打字時會用到、長得又很像的符號。少了它們，讀取器會挑一個「最像的」頂替（全形減號頂替破折號），
# 整格的平均誤差照樣過關，只有區域誤差看得出來。
SYMBOLS = (list('·×°±÷•※→←↑↓⇒─━│■□▲△○●◎★☆〜ー￥ˊˇˋ˙') + _span(0x2010, 0x2015) + list('‘’“”‥‧')
           + _span(0x3001, 0x3003) + _span(0x3008, 0x3011) + list('〔〕') + _span(0x3105, 0x3129) + _span(0xFF01, 0xFF5E))
BLANKS = [' ', chr(0x3000)]                 # 半形與全形空白：不佔墨，讀取器另外處理
_p = set(L1 + ASCII + PUNCT)
TEXT = L1 + ASCII + PUNCT + [c for c in dict.fromkeys(SYMBOLS) if c not in _p] + BLANKS   # 自由文字的第一輪
TEXT_FULL = TEXT + L2                       # 讀不出來才用
# 第三輪：Big5 沒收的字。人名、店名、品牌名常用的字裡有一批不在 Big5（堃、喆、峯、异體字……），
# 用 Big5 讀的症狀是「第一個字就讀不下去、幾秒就放棄」—— 不是讀錯，是候選裡根本沒有那個字。
_seen = set(TEXT_FULL)
TEXT_ALL = TEXT_FULL + [c for c in CJK if c not in _seen]

if __name__ == '__main__':
    print(len(L1), len(L2), len(TEXT))
