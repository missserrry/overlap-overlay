# Картинки для установщика (NSIS): боковая полоса 164×314 и шапка 150×57. Запуск: python design/make-installer-art.py
from PIL import Image, ImageDraw, ImageFont

BG, ACC, TXT, DIM = (14, 15, 17), (226, 185, 59), (233, 234, 236), (138, 144, 153)
icon = Image.open('overlays/common/brand/icon.png').convert('RGBA')
F = 'C:/Windows/Fonts/'
font = lambda n, s: ImageFont.truetype(F + n, s)

def logo(size):
    return icon.resize((size, size), Image.LANCZOS)

# боковая полоса
W, H = 164, 314
im = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(im)
for y in range(H):  # мягкое свечение сверху
    k = max(0, 1 - y / 190) * 0.10
    d.line([(0, y), (W, y)], fill=tuple(int(c + (a - c) * k) for c, a in zip(BG, ACC)))
l = logo(96)
im.paste(l, ((W - 96) // 2, 46), l)
f1 = font('segoeuib.ttf', 26)
w = d.textlength('Overlap', font=f1)
d.text(((W - w) / 2, 158), 'Overlap', font=f1, fill=TXT)
f2 = font('segoeui.ttf', 11)
for i, t in enumerate(['Оверлеи для iRacing']):
    w = d.textlength(t, font=f2)
    d.text(((W - w) / 2, 194 + i * 16), t, font=f2, fill=DIM)
d.rectangle([(W - 3) // 2 - 16, 228, (W - 3) // 2 + 19, 229], fill=ACC)
im.save('build/installerSidebar.bmp')
im.save('build/uninstallerSidebar.bmp')

# шапка страниц мастера
W, H = 150, 57
im = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(im)
l = logo(36)
im.paste(l, (W - 36 - 14, 10), l)
d.text((14, 16), 'Overlap', font=font('segoeuib.ttf', 15), fill=TXT)
d.rectangle([14, 38, 30, 39], fill=ACC)
im.save('build/installerHeader.bmp')
print('ok')
