"""「下一站」App 圖示：目的地圖釘＋地球＋紙飛機與虛線航線。
用法：python3 icon2.py <輸出資料夾>
"""
import math
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops

OUT = sys.argv[1]
N = 2048  # 先畫大圖再縮小，邊緣比較平滑


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))


def linear_gradient(size, c1, c2, angle_deg):
    """沿著角度方向的線性漸層（RGB）。"""
    w, h = size
    small = 256
    g = Image.new('RGB', (small, small))
    px = g.load()
    a = math.radians(angle_deg)
    dx, dy = math.cos(a), math.sin(a)
    lo = min(0 * dx + 0 * dy, dx * small, dy * small, dx * small + dy * small)
    hi = max(0 * dx + 0 * dy, dx * small, dy * small, dx * small + dy * small)
    for y in range(small):
        for x in range(small):
            t = ((x * dx + y * dy) - lo) / (hi - lo)
            px[x, y] = lerp(c1, c2, t)
    return g.resize((w, h), Image.BICUBIC)


def radial_alpha(size, cx, cy, r, strength):
    """中心亮、往外淡出的遮罩（L）。"""
    small = 256
    s = size / small
    m = Image.new('L', (small, small), 0)
    px = m.load()
    for y in range(small):
        for x in range(small):
            d = math.hypot(x * s - cx, y * s - cy) / r
            px[x, y] = int(max(0.0, 1 - d) ** 1.6 * 255 * strength)
    return m.resize((size, size), Image.BICUBIC)


def soft_shadow(mask, offset, blur, opacity):
    sh = Image.new('L', mask.size, 0)
    sh.paste(mask, offset)
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    return sh.point(lambda v: int(v * opacity))


def paste_color(base, color, mask):
    layer = Image.new('RGBA', base.size, color + (255,))
    base.paste(layer, (0, 0), mask)


def paste_image(base, img, mask):
    base.paste(img.convert('RGBA'), (0, 0), mask)


def teardrop_mask(cx, cy, R, tip_ratio=1.85):
    """圖釘形狀：上方圓形＋下方尖端。"""
    m = Image.new('L', (N, N), 0)
    d = ImageDraw.Draw(m)
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=255)
    tip = (cx, cy + R * tip_ratio)
    dist = R * tip_ratio
    phi = math.acos(R / dist)
    down = math.pi / 2
    p1 = (cx + R * math.cos(down - phi), cy + R * math.sin(down - phi))
    p2 = (cx + R * math.cos(down + phi), cy + R * math.sin(down + phi))
    d.polygon([p1, tip, p2, (cx, cy)], fill=255)
    return m


def bezier(p0, p1, p2, p3, t):
    u = 1 - t
    return (u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
            u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1])


def draw(scale):
    """scale：內容占畫布的比例（maskable 圖示要留更多邊）。"""
    o = N * (1 - scale) / 2

    def P(x, y):  # 以 1000 為單位的座標轉成畫布座標
        return (o + x / 1000 * N * scale, o + y / 1000 * N * scale)

    def L(v):
        return v / 1000 * N * scale

    # ---- 背景：深湖水綠 → 天空藍，左上角柔光，四周微暗 ----
    img = linear_gradient((N, N), (14, 116, 144), (8, 66, 92), 60).convert('RGBA')
    sky = linear_gradient((N, N), (56, 189, 248), (13, 148, 136), 70)
    img = Image.blend(img, sky.convert('RGBA'), 0.55)
    glow = radial_alpha(N, N * 0.22, N * 0.12, N * 0.9, 0.55)
    paste_color(img, (255, 255, 255), glow.point(lambda v: int(v * 0.45)))
    vign = radial_alpha(N, N * 0.5, N * 0.5, N * 0.78, 1.0)
    vign = ImageChops.invert(vign).point(lambda v: int(v * 0.28))
    paste_color(img, (3, 30, 45), vign)

    # ---- 虛線航線（在圖釘後面的那一段先畫） ----
    p0, p1, p2, p3 = P(150, 760), P(80, 380), P(520, 120), P(800, 250)
    pts = [bezier(p0, p1, p2, p3, i / 400) for i in range(401)]
    trail = Image.new('L', (N, N), 0)
    td = ImageDraw.Draw(trail)
    seg, gap, w = L(62), L(40), L(22)
    acc, on, start = 0.0, True, pts[0]
    for a, b in zip(pts, pts[1:]):
        acc += math.dist(a, b)
        if on and acc >= seg:
            td.line([start, b], fill=255, width=int(w))
            for q in (start, b):
                td.ellipse([q[0] - w / 2, q[1] - w / 2, q[0] + w / 2, q[1] + w / 2], fill=255)
            on, acc = False, 0.0
        elif not on and acc >= gap:
            on, acc, start = True, 0.0, b
    # 航線從左下淡入
    fade = Image.new('L', (N, N), 0)
    fpx = fade.load()
    for y in range(0, N, 4):
        for x in range(0, N, 4):
            v = min(255, max(60, int(255 * (1 - (y - P(0, 300)[1]) / (P(0, 800)[1] - P(0, 300)[1]) * 0.7))))
            for yy in range(y, min(y + 4, N)):
                for xx in range(x, min(x + 4, N)):
                    fpx[xx, yy] = v
    trail = ImageChops.multiply(trail, fade).point(lambda v: int(v * 0.85))
    paste_color(img, (255, 255, 255), trail)

    # ---- 目的地圖釘 ----
    cx, cy = P(470, 470)
    R = L(235)
    pin = teardrop_mask(cx, cy, R)
    img.alpha_composite(Image.merge('RGBA', (*[Image.new('L', (N, N), 0)] * 3,
                                              soft_shadow(pin, (int(L(18)), int(L(30))), L(28), 0.45))))
    pin_fill = linear_gradient((N, N), (255, 196, 87), (244, 93, 72), 95)  # 金黃 → 珊瑚紅
    paste_image(img, pin_fill, pin)
    # 圖釘左上的光澤
    shine = Image.new('L', (N, N), 0)
    ImageDraw.Draw(shine).ellipse([cx - R * 0.95, cy - R * 1.05, cx + R * 0.35, cy + R * 0.1], fill=255)
    shine = ImageChops.multiply(shine.filter(ImageFilter.GaussianBlur(L(30))), pin).point(lambda v: int(v * 0.32))
    paste_color(img, (255, 255, 255), shine)
    # 圖釘右下的暗面
    shade = Image.new('L', (N, N), 0)
    ImageDraw.Draw(shade).ellipse([cx - R * 0.1, cy - R * 0.2, cx + R * 1.4, cy + R * 2.2], fill=255)
    shade = ImageChops.multiply(shade.filter(ImageFilter.GaussianBlur(L(40))), pin).point(lambda v: int(v * 0.22))
    paste_color(img, (120, 20, 30), shade)

    # 白色圓盤＋地球
    r = R * 0.6
    disc = Image.new('L', (N, N), 0)
    ImageDraw.Draw(disc).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    img.alpha_composite(Image.merge('RGBA', (*[Image.new('L', (N, N), 0)] * 3,
                                              soft_shadow(disc, (0, int(L(6))), L(10), 0.35))))
    paste_color(img, (255, 255, 255), disc)
    gr = r * 0.74
    globe = Image.new('L', (N, N), 0)
    gd = ImageDraw.Draw(globe)
    lw = int(L(13))
    gd.ellipse([cx - gr, cy - gr, cx + gr, cy + gr], outline=255, width=lw)
    gd.ellipse([cx - gr * 0.42, cy - gr, cx + gr * 0.42, cy + gr], outline=255, width=lw)
    gd.line([cx - gr, cy, cx + gr, cy], fill=255, width=lw)
    for f in (-0.52, 0.52):
        yy = cy + gr * f
        half = gr * math.sqrt(1 - f * f)
        gd.line([cx - half, yy, cx + half, yy], fill=255, width=lw)
    clip = Image.new('L', (N, N), 0)
    ImageDraw.Draw(clip).ellipse([cx - gr - lw, cy - gr - lw, cx + gr + lw, cy + gr + lw], fill=255)
    globe = ImageChops.multiply(globe, clip)
    globe_fill = linear_gradient((N, N), (14, 165, 183), (8, 92, 120), 90)
    paste_image(img, globe_fill, globe)

    # ---- 虛線航線（圖釘前面那一段，接到紙飛機） ----
    q0, q1, q2, q3 = P(640, 300), P(700, 260), P(760, 240), P(800, 250)
    # 這段已含在上面的曲線裡，這裡只補一小段實線光暈讓飛機像剛飛過
    halo = Image.new('L', (N, N), 0)
    ImageDraw.Draw(halo).line([bezier(q0, q1, q2, q3, t / 20) for t in range(21)], fill=255, width=int(L(10)))
    paste_color(img, (255, 255, 255), halo.filter(ImageFilter.GaussianBlur(L(6))).point(lambda v: int(v * 0.35)))

    # ---- 紙飛機 ----
    px_, py_, s = P(805, 235)[0], P(805, 235)[1], L(150)
    ang = math.radians(-28)

    def T(x, y):
        return (px_ + s * (x * math.cos(ang) - y * math.sin(ang)),
                py_ + s * (x * math.sin(ang) + y * math.cos(ang)))

    nose, back_top, fold, back_bot, keel = T(1.0, 0), T(-0.95, -0.62), T(-0.35, 0.06), T(-0.62, 0.62), T(-0.2, 0.32)
    plane_all = Image.new('L', (N, N), 0)
    ImageDraw.Draw(plane_all).polygon([nose, back_top, fold, back_bot], fill=255)
    img.alpha_composite(Image.merge('RGBA', (*[Image.new('L', (N, N), 0)] * 3,
                                              soft_shadow(plane_all, (int(L(10)), int(L(18))), L(14), 0.4))))
    d = ImageDraw.Draw(img)
    d.polygon([nose, back_top, fold], fill=(255, 255, 255, 255))           # 上翼
    d.polygon([nose, fold, back_bot], fill=(214, 232, 240, 255))           # 下翼（陰影面）
    d.polygon([nose, fold, keel], fill=(176, 206, 220, 255))               # 機腹摺痕

    # ---- 兩顆小星光 ----
    for (sx, sy, sr) in ((P(215, 215), None, L(26)), (P(850, 560), None, L(18))):
        x0, y0 = sx
        star = Image.new('L', (N, N), 0)
        sd = ImageDraw.Draw(star)
        sd.polygon([(x0, y0 - sr), (x0 + sr * 0.22, y0 - sr * 0.22), (x0 + sr, y0), (x0 + sr * 0.22, y0 + sr * 0.22),
                    (x0, y0 + sr), (x0 - sr * 0.22, y0 + sr * 0.22), (x0 - sr, y0), (x0 - sr * 0.22, y0 - sr * 0.22)], fill=255)
        paste_color(img, (255, 255, 255), star.point(lambda v: int(v * 0.9)))
    return img


def rounded(img, radius_ratio=0.225):
    m = Image.new('L', img.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius=int(img.size[0] * radius_ratio), fill=255)
    out = img.copy()
    out.putalpha(m)
    return out


full = draw(0.92)          # 一般圖示
mask = draw(0.74)          # maskable：內容縮到安全範圍內
anyicon = rounded(full)

for name, im, size in [('icon-512.png', anyicon, 512), ('icon-192.png', anyicon, 192), ('favicon-64.png', anyicon, 64),
                       ('icon-maskable-512.png', mask.convert('RGB'), 512), ('apple-touch-icon.png', full.convert('RGB'), 180)]:
    im.resize((size, size), Image.LANCZOS).save(f'{OUT}/{name}', optimize=True)

# 預覽：淺色、深色桌布上的各種尺寸與遮罩
sheet = Image.new('RGB', (1400, 620), (236, 239, 242))
dark = Image.new('RGB', (700, 300), (28, 30, 34))
sheet.paste(dark, (700, 320))
big = anyicon.resize((280, 280), Image.LANCZOS)
sheet.paste(big, (30, 20), big)
circle = Image.new('L', (280, 280), 0)
ImageDraw.Draw(circle).ellipse([0, 0, 279, 279], fill=255)
sheet.paste(mask.convert('RGB').resize((280, 280), Image.LANCZOS), (340, 20), circle)
sq = full.convert('RGB').resize((180, 180), Image.LANCZOS)
sheet.paste(sq, (650, 70))
for i, sz in enumerate((120, 64, 40)):
    ic = anyicon.resize((sz, sz), Image.LANCZOS)
    sheet.paste(ic, (880 + i * 150, 110 + (120 - sz) // 2), ic)
    sheet.paste(ic, (760 + i * 150, 360 + (120 - sz) // 2), ic)
old = Image.open(sys.argv[2]).convert('RGBA').resize((180, 180), Image.LANCZOS) if len(sys.argv) > 2 else None
if old:
    sheet.paste(old, (60, 380), old)
sheet.save(f'{OUT}/preview.png')
