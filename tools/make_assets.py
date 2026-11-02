# -*- coding: utf-8 -*-
"""生成 ZTABLE 品牌资源：透明图标、ICO、托盘图标、NSIS 安装界面位图。"""
import os
from collections import deque
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'logo_source.png')
BUILD = os.path.join(ROOT, 'build')
ASSETS = os.path.join(ROOT, 'assets')
BG = 252

BLUE = (37, 99, 235)
BLUE_DEEP = (11, 59, 214)
INK = (42, 49, 68)


def transparentize(im):
    """从四边泛洪去除浅色背景，内部白色格子保留；边缘做反混色以消除白边。"""
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    bg = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or bg[y][x]:
            continue
        r, g, b, a = px[x, y]
        if min(r, g, b) < 236:
            continue
        bg[y][x] = True
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if bg[y][x]:
                px[x, y] = (r, g, b, 0)
                continue
            near = False
            for dx in (-2, -1, 0, 1, 2):
                for dy in (-2, -1, 0, 1, 2):
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < w and 0 <= yy < h and bg[yy][xx]:
                        near = True
                        break
                if near:
                    break
            if near:
                m = min(r, g, b)
                al = max(0.0, min(1.0, (BG - m) / float(BG - 40)))
                if al <= 0.01:
                    px[x, y] = (r, g, b, 0)
                else:
                    def un(c):
                        return int(max(0, min(255, (c - (1 - al) * BG) / al)))
                    px[x, y] = (un(r), un(g), un(b), int(al * 255))
    return im


def font(size, bold=False):
    cands = (['segoeuib.ttf', 'msyhbd.ttc'] if bold else ['segoeui.ttf', 'msyh.ttc'])
    for c in cands:
        p = os.path.join('C:\\Windows\\Fonts', c)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def cjk(size, bold=False):
    for c in (['msyhbd.ttc'] if bold else ['msyh.ttc']):
        p = os.path.join('C:\\Windows\\Fonts', c)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return font(size, bold)


def main():
    src = Image.open(SRC).convert('RGB')
    # 标志主体（去掉下方文字），正方形裁切
    mark = src.crop((278, 188, 746, 656))
    mark_t = transparentize(mark)
    mark_t.save(os.path.join(ASSETS, 'mark.png'))
    # 完整 logo 透明版（用于关于页）
    full = transparentize(src.crop((180, 180, 846, 800)))
    full.save(os.path.join(ASSETS, 'logo_full.png'))

    # ICO：多尺寸
    sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
    icon256 = mark_t.resize((256, 256), Image.LANCZOS)
    icon256.save(os.path.join(BUILD, 'icon.ico'), sizes=[(s, s) for s in sizes])
    icon256.save(os.path.join(ASSETS, 'icon.ico'), sizes=[(s, s) for s in sizes])
    mark_t.resize((512, 512), Image.LANCZOS).save(os.path.join(BUILD, 'icon.png'))
    mark_t.resize((128, 128), Image.LANCZOS).save(os.path.join(ASSETS, 'mark128.png'))
    # 托盘图标 32px png（Electron 会自动按 DPI 选择 @2x）
    mark_t.resize((16, 16), Image.LANCZOS).save(os.path.join(ASSETS, 'tray.png'))
    mark_t.resize((32, 32), Image.LANCZOS).save(os.path.join(ASSETS, 'tray@2x.png'))
    mark_t.resize((48, 48), Image.LANCZOS).save(os.path.join(ASSETS, 'tray@3x.png'))

    # ===== NSIS 侧边栏 164x314（4 倍超采样绘制） =====
    S = 4
    W, H = 164 * S, 314 * S
    sb = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(sb)
    # 渐变背景：深蓝 -> 品牌蓝
    for y in range(H):
        t = y / float(H)
        c = tuple(int(BLUE_DEEP[i] * (1 - t) + (74, 140, 255)[i] * t) for i in range(3))
        d.line([(0, y), (W, y)], fill=c)
    # 底部桌面网格隐喻（半透明白色格子）
    grid = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    gx0, gy0, cw, ch, gap = 18 * S, 196 * S, 40 * S, 26 * S, 6 * S
    for row in range(3):
        for col in range(3):
            x = gx0 + col * (cw + gap)
            y = gy0 + row * (ch + gap)
            alpha = 70 if (row + col) % 2 == 0 else 38
            if row == 0 and col == 0:
                alpha = 150
            gd.rounded_rectangle([x, y, x + cw, y + ch], radius=5 * S, fill=(255, 255, 255, alpha))
    sb = Image.alpha_composite(sb.convert('RGBA'), grid)
    # 白色圆角卡片放标志
    card = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    cd = ImageDraw.Draw(card)
    cx0, cy0, cs = 36 * S, 34 * S, 92 * S
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([cx0, cy0 + 4 * S, cx0 + cs, cy0 + cs + 4 * S], radius=22 * S, fill=(0, 20, 80, 90))
    shadow = shadow.filter(ImageFilter.GaussianBlur(6 * S))
    sb = Image.alpha_composite(sb, shadow)
    cd.rounded_rectangle([cx0, cy0, cx0 + cs, cy0 + cs], radius=22 * S, fill=(255, 255, 255, 255))
    sb = Image.alpha_composite(sb, card)
    m = mark_t.resize((70 * S, 70 * S), Image.LANCZOS)
    sb.alpha_composite(m, (cx0 + 11 * S, cy0 + 11 * S))
    d = ImageDraw.Draw(sb)
    f1 = font(25 * S, True)
    tw = d.textlength('ZTABLE', font=f1)
    d.text(((W - tw) / 2, 140 * S), 'ZTABLE', font=f1, fill=(255, 255, 255))
    f2 = cjk(11 * S)
    t2 = '让桌面井井有条'
    tw2 = d.textlength(t2, font=f2)
    d.text(((W - tw2) / 2, 172 * S), t2, font=f2, fill=(222, 233, 255))
    f3 = font(8 * S)
    t3 = 'Version 1.0.0'
    tw3 = d.textlength(t3, font=f3)
    d.text(((W - tw3) / 2, 294 * S), t3, font=f3, fill=(210, 225, 255))
    side = sb.convert('RGB').resize((164, 314), Image.LANCZOS)
    side.save(os.path.join(BUILD, 'installerSidebar.bmp'))
    side.save(os.path.join(BUILD, 'uninstallerSidebar.bmp'))
    side.save(os.path.join(ROOT, 'tools', 'preview_sidebar.png'))

    # ===== NSIS 页眉 150x57 =====
    W, H = 150 * S, 57 * S
    hd = Image.new('RGBA', (W, H), (255, 255, 255, 255))
    mm = mark_t.resize((38 * S, 38 * S), Image.LANCZOS)
    hd.alpha_composite(mm, (W - 44 * S, 9 * S))
    d = ImageDraw.Draw(hd)
    f = font(17 * S, True)
    tw = d.textlength('ZTABLE', font=f)
    d.text((W - 50 * S - tw, 15 * S), 'ZTABLE', font=f, fill=INK)
    head = hd.convert('RGB').resize((150, 57), Image.LANCZOS)
    head.save(os.path.join(BUILD, 'installerHeader.bmp'))
    head.save(os.path.join(ROOT, 'tools', 'preview_header.png'))
    print('assets ok')


if __name__ == '__main__':
    main()
