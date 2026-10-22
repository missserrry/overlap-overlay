# Рисует значок Overlap («Clean Air»: три потока, нижний золотой с точкой) в PNG и ICO.
# Запуск: python design/make-icon.py   → overlays/common/brand/{icon.png, icon.ico, tray.png}
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'overlays', 'common', 'brand')
os.makedirs(OUT, exist_ok=True)

BG, GOLD, WHITE = (21, 23, 26), (226, 185, 59), (233, 234, 236)
# линии в координатах 96×96: (начало, [(c1, c2, конец)...], цвет, прозрачность, толщина)
LINES = [
    ((14, 38), [((34, 38), (40, 28), (58, 28)), ((72, 28), (78, 34), (84, 34))], WHITE, 0.55, 3.2),
    ((14, 52), [((34, 52), (42, 42), (60, 42)), ((74, 42), (80, 48), (84, 48))], WHITE, 0.85, 3.2),
    ((14, 66), [((34, 66), (44, 56), (62, 56)), ((76, 56), (80, 62), (84, 62))], GOLD, 1.0, 3.6),
]


def bez(p0, c1, c2, p1, n=240):
    pts = []
    for i in range(n + 1):
        t = i / n
        a = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3
        pts.append((a[0] * p0[0] + a[1] * c1[0] + a[2] * c2[0] + a[3] * p1[0], a[0] * p0[1] + a[1] * c1[1] + a[2] * c2[1] + a[3] * p1[1]))
    return pts


def render(size, bold=1.0, rounded=True):
    k = 8                       # суперсэмплинг
    S = size * k
    f = S / 96
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, S - 1, S - 1), radius=22 * f, fill=BG + (255,))
    for start, segs, color, alpha, width in LINES:
        layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        r = width * bold * f / 2
        p0 = start
        for c1, c2, p1 in segs:
            for x, y in bez(p0, c1, c2, p1):
                ld.ellipse((x * f - r, y * f - r, x * f + r, y * f + r), fill=color + (int(255 * alpha),))
            p0 = p1
        img.alpha_composite(layer)
    r = 4.6 * bold * f
    d.ellipse((84 * f - r, 62 * f - r, 84 * f + r, 62 * f + r), fill=GOLD + (255,))
    return img.resize((size, size), Image.LANCZOS)


master = render(512, 1.15)
master.save(os.path.join(OUT, 'icon.png'))
# для маленьких размеров линии толще, иначе пропадают
sizes = [16, 24, 32, 48, 64, 128, 256]
frames = [render(s, 1.15 + (0.45 if s <= 32 else 0.2 if s <= 64 else 0)) for s in sizes]
frames[-1].save(os.path.join(OUT, 'icon.ico'), format='ICO', sizes=[(s, s) for s in sizes], append_images=frames[:-1])
render(32, 1.6).save(os.path.join(OUT, 'tray.png'))
print('ok', os.listdir(OUT))
