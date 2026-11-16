"""SVG-силуэт (VTracer и подобные: M/C/L/Z, transform translate) → контур
знака: точки вокруг (0, 0), размах 1, ось Y вверх. Берётся самый тёмный и самый
большой path. Печатает JS-массив для SYMBOLS."""
import re, sys, json, math

src = open(sys.argv[1], encoding='utf-8').read()
best = None
for m in re.finditer(r'<path d="([^"]*)"([^>]*)>', src):
    d, rest = m.group(1), m.group(2)
    fill = re.search(r'fill="#([0-9A-Fa-f]{6})"', rest)
    lum = sum(int(fill.group(1)[i:i+2], 16) for i in (0, 2, 4)) if fill else 0
    tr = re.search(r'translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)', rest)
    tx, ty = (float(tr.group(1)), float(tr.group(2))) if tr else (0.0, 0.0)
    if lum > 200: continue  # фон и светлые обрезки
    if best is None or len(d) > len(best[0]): best = (d, tx, ty)
d, tx, ty = best
tok = re.findall(r'[MCLZ]|-?[\d.]+(?:e-?\d+)?', d)
rings, cur, i, cmd, pos = [], [], 0, None, (0.0, 0.0)
while i < len(tok):
    t = tok[i]
    if t in 'MCLZ':
        cmd = t; i += 1
        if t == 'Z':
            if cur: rings.append(cur); cur = []
        continue
    if cmd == 'M':
        pos = (float(tok[i]), float(tok[i+1])); i += 2; cur = [pos]; cmd = 'L'
    elif cmd == 'L':
        pos = (float(tok[i]), float(tok[i+1])); i += 2; cur.append(pos)
    elif cmd == 'C':
        p1 = (float(tok[i]), float(tok[i+1])); p2 = (float(tok[i+2]), float(tok[i+3])); p3 = (float(tok[i+4]), float(tok[i+5])); i += 6
        p0 = pos
        for k in range(1, 7):
            u = k / 6; a = (1-u)**3; b = 3*(1-u)**2*u; c = 3*(1-u)*u*u; e = u**3
            cur.append((a*p0[0]+b*p1[0]+c*p2[0]+e*p3[0], a*p0[1]+b*p1[1]+c*p2[1]+e*p3[1]))
        pos = p3
if cur: rings.append(cur)
pts = [(x + tx, -(y + ty)) for r in rings for (x, y) in r]  # Y вверх
x0 = min(p[0] for p in pts); x1 = max(p[0] for p in pts); y0 = min(p[1] for p in pts); y1 = max(p[1] for p in pts)
cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
R = max(math.hypot(p[0]-cx, p[1]-cy) for p in pts)

def dp(P, tol):  # Дуглас — Пекер (кольцо как ломаная)
    if len(P) < 3: return P
    a, b = P[0], P[-1]; dx, dy = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dy) or 1e-12
    idx, dm = 0, -1
    for j in range(1, len(P)-1):
        dd = abs((P[j][0]-a[0])*dy - (P[j][1]-a[1])*dx) / L
        if dd > dm: idx, dm = j, dd
    if dm <= tol: return [a, b]
    return dp(P[:idx+1], tol)[:-1] + dp(P[idx:], tol)

out = []
for r in rings:
    q = [((x + tx - cx) / R, (-(y + ty) - cy) / R) for (x, y) in r]
    # кольцо: режем в самой дальней от первой точке и упрощаем две половины
    far = max(range(len(q)), key=lambda j: (q[j][0]-q[0][0])**2 + (q[j][1]-q[0][1])**2)
    q = dp(q[:far+1], 0.002)[:-1] + dp(q[far:] + [q[0]], 0.002)[:-1]
    if len(q) >= 3: out.append([[round(x, 4), round(y, 4)] for x, y in q])
print(json.dumps(out, separators=(',', ':')))
print('rings', len(out), 'points', sum(len(r) for r in out), 'bbox', round((x1-x0)/R, 3), round((y1-y0)/R, 3), file=sys.stderr)
