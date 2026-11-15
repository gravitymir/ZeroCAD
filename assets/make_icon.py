"""Иконка ZeroCAD: оранжевый изометрический кубик со сквозными отверстиями —
круг в левой грани («0» в ZeroCAD), треугольник сверху, четырёхлистник справа —
на тёмной скруглённой плашке.

Рисуется без библиотек: заливка фигур с суперсэмплингом, PNG — через zlib,
ICO — набор PNG 16…256 px. Запуск из корня репозитория:

    python assets/make_icon.py

Пишет assets/zerocad.ico (вшивается в exe через build.rs), assets/zerocad.png
(256 px) и assets/favicon.png (64 px, вкладка браузера).
"""
import math, os, struct, zlib

BG = (0x1e, 0x21, 0x28)        # --panel интерфейса
RIM = (0x33, 0x38, 0x44)       # --line
TOP = (0xff, 0xb5, 0x80)
LEFT = (0xff, 0x8a, 0x3d)      # --accent
RIGHT = (0xc4, 0x5c, 0x1c)
WALL = (0x8e, 0x3f, 0x12)      # стенка отверстия
HOLE = (0x15, 0x17, 0x1c)      # --bg: сквозь отверстие видно фон
C30 = math.cos(math.pi / 6)


def scene(x, y):
    """Цвет точки (x, y) в долях стороны иконки, None — прозрачно."""
    # плашка: скруглённый квадрат с ободком
    m, rad = 0.03, 0.2
    qx = min(max(x, m + rad), 1 - m - rad); qy = min(max(y, m + rad), 1 - m - rad)
    d = math.hypot(x - qx, y - qy)
    if d > rad: return None
    col = RIM if d > rad - 0.025 and (x < m + rad or x > 1 - m - rad or y < m + rad or y > 1 - m - rad) or \
        min(x - m, 1 - m - x, y - m, 1 - m - y) < 0.025 else BG
    # кубик: верх — ромб, левая и правая грани
    s, cx, cy = 0.29, 0.5, 0.47
    T = (cx, cy - s); L = (cx - s * C30, cy - s / 2); R = (cx + s * C30, cy - s / 2); C = (cx, cy)
    down = lambda p: (p[0], p[1] + s)
    def inside(poly):
        n, c = len(poly), False
        for i in range(n):
            (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
        return c
    # Сквозные отверстия: фигура в координатах грани (a, b); дальний край —
    # та же фигура, сдвинутая вглубь кубика (на экране — по третьей оси).
    # Глубина мельче настоящей, чтобы сквозь отверстие просвечивал фон
    dep = 0.3 * s
    def hole(to_face, shape, inward, face, wall):
        if not shape(*to_face(x, y)): return face
        return HOLE if shape(*to_face(x - dep * inward[0], y - dep * inward[1])) else wall
    # верх (ромб): a — вдоль L→C, b — вдоль C→R; треугольник вершиной назад
    tx, ty = cx, cy - s / 2
    def top_uv(px, py):
        u, v = (px - tx) / C30, 2 * (py - ty)
        return (u + v) / 2, (u - v) / 2
    def triangle(a, b):
        # в плоскости грани: ось «назад» (к T) — (−1, 1)/√2
        p, q = (b - a) / math.sqrt(2), -(a + b) / math.sqrt(2)  # p — назад, q — вбок
        r = 0.42 * s
        # равносторонний треугольник: вершина на p = r, основание на p = −r/2
        return p > -r / 2 and p < r and abs(q) < (r - p) / math.sqrt(3)
    if inside([T, R, C, L]): return hole(top_uv, triangle, (0, 1), TOP, WALL)
    # правая грань: a — вдоль C→R, b — вниз; четырёхлистник крестом
    rx, ry = (C[0] + R[0]) / 2, (C[1] + R[1]) / 2 + s / 2
    def right_uv(px, py):
        a = (px - rx) / C30
        return a, (py - ry) + 0.5 * a
    def clover(a, b):
        d, rr = 0.2 * s, 0.17 * s
        if abs(a) < d and abs(b) < d: return True
        return any((a - ox) ** 2 + (b - oy) ** 2 < rr * rr for ox, oy in ((d, 0), (-d, 0), (0, d), (0, -d)))
    if inside([C, R, down(R), down(C)]): return hole(right_uv, clover, (-C30, -0.5), RIGHT, (0x6e, 0x30, 0x0c))
    # левая грань: a — вдоль L→C, b — вниз; круг — «0» в ZeroCAD
    fx, fy = (L[0] + C[0]) / 2, (L[1] + C[1]) / 2 + s / 2
    def left_uv(px, py):
        a = (px - fx) / C30
        return a, (py - fy) - 0.5 * a
    disc = lambda a, b: a * a + b * b < (0.36 * s) ** 2
    if inside([L, C, down(C), down(L)]): return hole(left_uv, disc, (C30, -0.5), LEFT, WALL)
    return col


def render(n):
    ss = 8 if n <= 32 else 4
    rows = []
    for py in range(n):
        row = bytearray([0])
        for px in range(n):
            acc = [0, 0, 0]; cov = 0
            for sy in range(ss):
                for sx in range(ss):
                    c = scene((px + (sx + 0.5) / ss) / n, (py + (sy + 0.5) / ss) / n)
                    if c is None: continue
                    cov += 1
                    for k in range(3): acc[k] += c[k]
            if cov: row += bytes([round(acc[0] / cov), round(acc[1] / cov), round(acc[2] / cov), round(255 * cov / ss / ss)])
            else: row += bytes(4)
        rows.append(bytes(row))
    raw = b''.join(rows)
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0)) + \
        chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    pngs = {n: render(n) for n in sizes}
    # ICO: заголовок, каталог, затем PNG как есть (Windows Vista+)
    head = struct.pack('<HHH', 0, 1, len(sizes))
    off = 6 + 16 * len(sizes); dirs = b''; data = b''
    for n in sizes:
        p = pngs[n]
        dirs += struct.pack('<BBBBHHII', n % 256, n % 256, 0, 0, 1, 32, len(p), off + len(data))
        data += p
    open(os.path.join(here, 'zerocad.ico'), 'wb').write(head + dirs + data)
    open(os.path.join(here, 'zerocad.png'), 'wb').write(pngs[256])
    open(os.path.join(here, 'favicon.png'), 'wb').write(pngs[64])
    print('ok', {n: len(pngs[n]) for n in sizes})


if __name__ == '__main__':
    main()
