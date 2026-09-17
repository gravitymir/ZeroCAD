#!/usr/bin/env python3
"""Интеграционные тесты ZeroCAD через MCP: команды агента и инструменты мыши
(выдавливание, карман, фаска, текст) на настоящем редакторе в браузере.

Нужны запущенный сервер (cargo run) и открытая вкладка редактора: команды
выполняет она. ВНИМАНИЕ: тесты заменяют модель во вкладке — сохраните работу.

    python tests/mcp/run.py --yes                     # сервер на :9000
    python tests/mcp/run.py --yes --url http://127.0.0.1:9001/mcp
    python tests/mcp/run.py --yes -k bevel            # только тесты с «bevel»

Только стандартная библиотека. Код выхода 0 — всё прошло.
"""
import argparse, json, math, sys, time, urllib.request

URL = 'http://127.0.0.1:9000/mcp'


class McpError(Exception):
    pass


def call(tool, args=None):
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": args or {}}}
    req = urllib.request.Request(URL, json.dumps(body).encode(), {"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=200))
    if 'error' in r:
        raise McpError(r['error'].get('message'))
    res = r['result']
    c = res['content'][0]
    if res.get('isError'):
        raise McpError(c.get('text', ''))
    return json.loads(c['text']) if c['type'] == 'text' else c


def closed(d, what=''):
    assert d['open_edges'] == 0, f'{what}: open_edges {d["open_edges"]}'
    assert d['nonmanifold_edges'] == 0, f'{what}: nonmanifold_edges {d["nonmanifold_edges"]}'


def near(a, b, tol, what=''):
    assert abs(a - b) <= tol, f'{what}: {a} vs {b} (±{tol})'


def exact(d, what=''):
    assert d.get('boolean', 'exact') == 'exact', f'{what}: boolean path {d.get("boolean")}'


ngon = lambda r, n=48: n / 2 * r * r * math.sin(2 * math.pi / n)
A48 = ngon(8)
TESTS = []


def case(fn):
    TESTS.append(fn)
    return fn


# ---------- команды агента: тела и точные булевы ----------

@case
def add_frustum_cube_cases():
    for name, fr, to, du, dc in [('crossing', [20,20,30], [20,20,55], 15*A48, -10*A48),
                                 ('on_face', [20,20,40], [20,20,55], 15*A48, 0),
                                 ('pocket_from_face', [20,20,40], [20,20,30], 0, -10*A48),
                                 ('corner_axis', [0,0,10], [0,0,35], 25*A48*3/4, -25*A48/4),
                                 ('through', [20,20,-10], [20,20,50], 20*A48, -40*A48)]:
        for op, exp in [('join', du), ('cut', dc)]:
            call('new_shape', {'shape': 'cube', 'size': 40})
            d = call('add_frustum', {'from': fr, 'to': to, 'r1': 8, 'r2': 8, 'operation': op})
            closed(d, f'{name} {op}')
            near(d['volume_change_mm3'], exp, 0.5, f'{name} {op}')


@case
def teapot_revolve_and_sweeps():
    # Utah teapot: корпус с крышкой — add_revolve, носик и ручка — add_sweep
    S = 25.0

    def bez(p0, p1, p2, p3, n):
        return [tuple((1-t)**3*p0[k] + 3*t*(1-t)**2*p1[k] + 3*t*t*(1-t)*p2[k] + t**3*p3[k] for k in range(2))
                for t in (i / n for i in range(n + 1))]

    def chain(*cs):
        pts = []
        for cv in cs:
            for p in cv:
                if not pts or max(abs(p[k] - pts[-1][k]) for k in range(2)) > 1e-9:
                    pts.append(p)
        return pts
    prof = chain([(0, 0), (1.4, 0)], bez((1.4, 0), (1.5, 0), (1.5, .075), (1.5, .15), 4),
                 bez((1.5, .15), (1.5, .225), (2, .45), (2, .9), 10), bez((2, .9), (2, 1.35), (1.75, 1.875), (1.5, 2.4), 10),
                 bez((1.5, 2.4), (1.4375, 2.53125), (1.3375, 2.53125), (1.4, 2.4), 6), [(1.3, 2.4)],
                 bez((1.3, 2.4), (1.3, 2.55), (.4, 2.55), (.2, 2.7), 8), bez((.2, 2.7), (0, 2.85), (.8, 3.15), (0, 3.15), 8))
    d = call('add_revolve', {'profile': [[round(r*S, 4), round(z*S, 4)] for r, z in prof], 'segments': 48, 'operation': 'new'})
    closed(d, 'body')
    lo = bez((1.7, .45), (3.1, .675), (2.4, 1.875), (3.3, 2.25), 16)
    hi = bez((1.7, 1.275), (2.6, 1.275), (2.3, 1.95), (2.7, 2.25), 16)
    path = [((a[0]+b[0])/2, (a[1]+b[1])/2) for a, b in zip(lo, hi)]
    rad = [max(.09, math.dist(a, b) / 2) for a, b in zip(lo, hi)]
    path.insert(0, (1.2, path[0][1] - .05)); rad.insert(0, rad[0])
    body = d['volume_mm3']
    d = call('add_sweep', {'path': [[round(x*S, 3), 0, round(z*S, 3)] for x, z in path], 'radius': [round(v*S, 3) for v in rad],
                           'side': [0, 1, 0], 'segments': 20, 'operation': 'join'})
    closed(d, 'spout'); exact(d, 'spout')
    union = d['volume_mm3']
    # тождество: A∪B = B + (A−B)
    call('undo')
    d = call('add_sweep', {'path': [[round(x*S, 3), 0, round(z*S, 3)] for x, z in path], 'radius': [round(v*S, 3) for v in rad],
                           'side': [0, 1, 0], 'segments': 20, 'operation': 'cut'})
    closed(d, 'spout cut')
    near(union, d['solid_volume_mm3'] + d['volume_mm3'], 0.5, 'A∪B = B + (A−B)')
    assert d['volume_mm3'] < body


@case
def cut_through_plate_holes():
    call('new_shape', {'shape': 'cube', 'size': 40})
    call('cut_plane', {'point': [0, 0, 5], 'normal': [0, 0, 1]})
    v = 1600 * 5
    for x, y, r in [(10, 10, 4), (28, 12, 6), (20, 30, 5)]:
        call('draw_circle', {'center': [x, y, 5], 'normal': [0, 0, 1], 'radius': r, 'segments': 48})
        d = call('cut_through', {'point': [x, y, 5], 'normal': [0, 0, 1]})
        v -= ngon(r) * 5
        closed(d, f'hole r{r}'); near(d['volume_mm3'], v, 0.5, f'hole r{r}')


@case
def cut_through_slanted_bottom_and_ring():
    call('new_shape', {'shape': 'cube', 'size': 40})
    call('cut_plane', {'point': [0, 0, 10], 'normal': [0, .25, -1]})
    before = call('get_state')['volume_mm3']
    call('draw_circle', {'center': [20, 20, 40], 'normal': [0, 0, 1], 'radius': 6, 'segments': 48})
    d = call('cut_through', {'point': [20, 20, 40], 'normal': [0, 0, 1]})
    closed(d, 'slanted'); near(d['volume_mm3'], before - ngon(6) * (40 - 15), 1.0, 'slanted bottom')
    call('new_shape', {'shape': 'cube', 'size': 40})
    call('draw_circle', {'center': [20, 20, 40], 'normal': [0, 0, 1], 'radius': 10, 'segments': 48})
    call('draw_circle', {'center': [20, 20, 40], 'normal': [0, 0, 1], 'radius': 5, 'segments': 48})
    d = call('cut_through', {'point': [27.5, 20, 40], 'normal': [0, 0, 1]})
    closed(d, 'ring'); near(d['volume_mm3'], 64000 - (ngon(10) - ngon(5)) * 40, 0.5, 'ring region')


@case
def cut_plane_through_tube():
    call('new_shape', {'shape': 'cube', 'size': 40})
    call('draw_circle', {'center': [20, 20, 40], 'normal': [0, 0, 1], 'radius': 8, 'segments': 48})
    call('cut_through', {'point': [20, 20, 40], 'normal': [0, 0, 1]})
    d = call('cut_plane', {'point': [0, 0, 20], 'normal': [0, 0, 1]})
    closed(d, 'tube'); near(d['volume_mm3'], (1600 - A48) * 20, 0.5, 'tube half')


@case
def bevel_outline_hole_rims():
    k, c = 24 * math.sin(math.pi / 24), math.cos(math.pi / 48)
    rim = lambda R, s: k * (R * s * s / c + s ** 3 / (3 * c * c))
    for s, segs in [(1, 1), (1.5, 1), (1.5, 8)]:
        call('new_shape', {'shape': 'cube', 'size': 40})
        call('cut_plane', {'point': [0, 0, 10], 'normal': [0, 0, 1]})
        call('draw_circle', {'center': [20, 20, 10], 'normal': [0, 0, 1], 'radius': 6, 'segments': 48})
        base = call('cut_through', {'point': [20, 20, 10], 'normal': [0, 0, 1]})['volume_mm3']
        d = call('bevel_outline', {'point': [5, 5, 10], 'normal': [0, 0, 1], 'size': s, 'segments': segs, 'outlines': 'holes'})
        closed(d, f'rim s={s} segs={segs}')
        if segs == 1:
            near(base - d['volume_mm3'], rim(6, s), 0.3, f'rim chamfer {s}')
    d = call('bevel_outline', {'point': [5, 5, 0], 'normal': [0, 0, -1], 'size': 1.5, 'segments': 6, 'outlines': 'all'})
    closed(d, 'bottom all round')


@case
def bevel_outline_outer_arcs():
    call('new_shape', {'shape': 'cube', 'size': 40})
    d = call('bevel_outline', {'point': [20, 20, 40], 'normal': [0, 0, 1], 'size': 2})
    closed(d, 'cube chamfer'); near(d['volume_change_mm3'], -309.333, 0.01, 'truncated pyramid')


@case
def bevel_errors():
    call('new_shape', {'shape': 'cube', 'size': 40})
    call('draw_circle', {'center': [20, 20, 40], 'normal': [0, 0, 1], 'radius': 3, 'segments': 48})
    call('cut_through', {'point': [20, 20, 40], 'normal': [0, 0, 1]})
    try:
        call('bevel_outline', {'point': [5, 5, 40], 'normal': [0, 0, 1], 'size': 18, 'outlines': 'holes'})
    except McpError as e:
        assert 'reaches another outline' in str(e), str(e)
    else:
        raise AssertionError('size 18 must be refused')


# ---------- инструменты мыши (те же функции, что по клавишам) ----------

@case
def extrude_pocket_pad_through():
    for label, dist, exp, must_exact in [('pocket', -10, 64000 - 10*A48, False), ('pad', 10, 64000 + 10*A48, False),
                                         ('through', -40, 64000 - 40*A48, True)]:
        call('new_shape', {'shape': 'cube', 'size': 40})
        call('draw_circle', {'center': [20, 20, 40], 'normal': [0, 0, 1], 'radius': 8, 'segments': 48})
        d = call('extrude_face', {'point': [20, 20, 40], 'normal': [0, 0, 1], 'distance': dist})
        closed(d, label); near(d['volume_mm3'], exp, 0.5, label)
        if must_exact:
            exact(d, label)


@case
def extrude_end_size_draft():
    # End size окна Extrude (end_scale): усечённый конус h/3·(A + A·k² + A·k)
    for dist, k in [(10, 0.5), (-10, 0.5), (15, 1.4)]:
        call('new_shape', {'shape': 'cube', 'size': 40})
        call('draw_circle', {'center': [20, 20, 40], 'normal': [0, 0, 1], 'radius': 8, 'segments': 48})
        d = call('extrude_face', {'point': [20, 20, 40], 'normal': [0, 0, 1], 'distance': dist, 'end_scale': k})
        exp = abs(dist) / 3 * (A48 + A48 * k * k + A48 * k) * (1 if dist > 0 else -1)
        closed(d, f'draft {dist} x{k}'); exact(d, f'draft {dist} x{k}')
        near(d['volume_change_mm3'], exp, 0.05, f'draft {dist} x{k}')


@case
def revolve_and_sweep_profiles():
    # Revolve (G,O) и Sweep (G,W) пользователя — тем же ядром: revolve_profile
    # и sweep_profile. Прямоугольник на верхней грани куба вокруг линии на ней:
    # над гранью — половина шайбы; квадрат вдоль L-пути и вдоль петли
    k64 = 64 / (2 * math.pi) * math.sin(2 * math.pi / 64)
    rect = [[15, 25, 40], [25, 25, 40], [25, 30, 40], [15, 30, 40]]
    for angle in [360, 180]:
        call('new_shape', {'shape': 'cube', 'size': 40})
        d = call('revolve_profile', {'profile': rect, 'axis_point': [0, 20, 40], 'axis_direction': [1, 0, 0], 'angle': angle, 'segments': 64})
        closed(d, f'revolve {angle}'); exact(d, f'revolve {angle}')
        near(d['volume_change_mm3'], math.pi * 75 * 10 * k64 / 2, 0.05, f'revolve {angle}')
    try:  # −180 — в другую сторону, целиком внутрь тела: добавлять нечего
        call('revolve_profile', {'profile': rect, 'axis_point': [0, 20, 40], 'axis_direction': [1, 0, 0], 'angle': -180, 'segments': 64})
    except McpError as e:
        assert 'nothing to add' in str(e), str(e)
    else:
        raise AssertionError('revolve -180 must go into the body')
    call('new_shape', {'shape': 'cube', 'size': 40})
    d = call('sweep_profile', {'profile': rect, 'path': [[20, 27.5, 40], [20, 27.5, 60], [45, 27.5, 60]]})
    closed(d, 'sweep L'); exact(d, 'sweep L'); near(d['volume_change_mm3'], 50 * 45, 0.01, 'sweep L')
    d = call('sweep_profile', {'profile': [[20, 38, 18], [20, 38, 22], [20, 42, 22], [20, 42, 18]],
                               'path': [[0, 40, 20], [40, 40, 20], [40, 60, 20], [0, 60, 20]], 'closed': True, 'operation': 'cut'})
    closed(d, 'sweep ring cut'); exact(d, 'sweep ring cut'); near(d['volume_change_mm3'], -2 * 4 * 40, 0.01, 'sweep ring cut')


@case
def mirror_move_copy_scale_body():
    # Mirror (G,I) и Move / Copy / Scale (G,B) — mirror_body и transform_body:
    # половинка → целое по грани, массив копий, перенос и масштаб одного тела,
    # переворот на другую сторону, копия внахлёст сливается точной булевой;
    # линия на теле едет вместе с ним
    call('new_shape', {'shape': 'cube', 'size': 20})
    call('draw_line', {'from': [5, 0, 20], 'to': [15, 20, 20]})
    d = call('mirror_body', {'plane_point': [20, 0, 0], 'plane_normal': [1, 0, 0]})
    closed(d, 'mirror join'); exact(d, 'mirror join'); near(d['volume_mm3'], 16000, 1e-3, 'mirror join')
    assert d['bbox_max'][0] == 40 and d['lines'] == 2, d
    d = call('transform_body', {'move': [0, 50, 0], 'copies': 3})
    closed(d, 'array'); near(d['volume_mm3'], 64000, 1e-3, 'array')
    assert d['boolean'] == 'none' and d['lines'] == 8, d
    d = call('transform_body', {'body_point': [10, 50, 20], 'move': [0, 0, 5]})
    closed(d, 'move one'); near(d['volume_change_mm3'], 0, 1e-3, 'move one')
    assert d['bbox_max'][2] == 25, d
    d = call('transform_body', {'body_point': [10, 100, 20], 'scale': 0.5})
    closed(d, 'scale'); near(d['volume_change_mm3'], -14000, 1e-3, 'scale 50 %')
    d = call('mirror_body', {'body_point': [10, 150, 20], 'plane_point': [0, 0, 0], 'plane_normal': [0, 1, 0], 'mode': 'flip'})
    closed(d, 'flip'); assert d['bbox_min'][1] == -170, d
    d = call('transform_body', {'body_point': [10, 0, 20], 'move': [10, 0, 0], 'copies': 1})
    closed(d, 'overlap'); exact(d, 'overlap'); near(d['volume_change_mm3'], 4000, 1e-3, 'overlapping copy')
    try:
        call('transform_body', {'scale': 0})
    except McpError as e:
        assert '> 0' in str(e), str(e)
    else:
        raise AssertionError('scale 0 must be refused')


@case
def shell_hollow_parts():
    # Shell (G,H) — shell_body: коробка с открытой крышей и закрытая полость,
    # стакан из цилиндра, куб с бобышкой (вогнутое ребро), колесо-дозатор с
    # V-карманами 12° (узкие сегменты обода у карманов исчезают) и отказ,
    # когда остриё кармана упирается в стенку втулки
    call('new_shape', {'shape': 'cube', 'size': 40})
    d = call('shell_body', {'thickness': 2, 'open_faces': [{'point': [20, 20, 40]}]})
    closed(d, 'open box'); exact(d, 'open box'); near(d['volume_mm3'], 64000 - 36*36*38, 1e-3, 'open box')
    call('new_shape', {'shape': 'cube', 'size': 40})
    d = call('shell_body', {'thickness': 2})
    closed(d, 'closed box'); near(d['volume_mm3'], 64000 - 36**3, 1e-3, 'closed box')
    call('add_frustum', {'from': [0, 0, 0], 'to': [0, 0, 30], 'r1': 20, 'r2': 20, 'segments': 64, 'operation': 'new'})
    a, A = 20 * math.cos(math.pi / 64), 64 * 400 * math.sin(2 * math.pi / 64) / 2
    d = call('shell_body', {'thickness': 2, 'open_faces': [{'point': [0, 0, 30]}]})
    closed(d, 'cup'); near(d['volume_mm3'], A*30 - A*((a-2)/a)**2*28, 0.05, 'cup')
    call('new_shape', {'shape': 'cube', 'size': 40})
    call('add_frustum', {'from': [20, 20, 40], 'to': [20, 20, 55], 'r1': 10, 'r2': 10, 'segments': 48})
    a, A = 10 * math.cos(math.pi / 48), 48 * 100 * math.sin(2 * math.pi / 48) / 2
    d = call('shell_body', {'thickness': 2, 'open_faces': [{'point': [20, 20, 0]}]})
    closed(d, 'boss'); near(d['volume_change_mm3'], -(36*36*38 + A*((a-2)/a)**2*15), 0.05, 'boss')
    for t in (1, 1.5):
        call('new_shape', {'shape': 'gear', 'size': 60})
        d = call('shell_body', {'thickness': t, 'open_faces': [{'point': [15, 15, 11]}]})
        closed(d, f'gear {t}'); exact(d, f'gear {t}')
    call('new_shape', {'shape': 'gear', 'size': 60})
    try:
        call('shell_body', {'thickness': 2, 'open_faces': [{'point': [15, 15, 11]}]})
    except McpError as e:
        assert 'does not fit' in str(e), str(e)
    else:
        raise AssertionError('gear wall 2 mm must be refused: the pocket tip reaches the hub')


@case
def gear_v_grooves_on_tooth_flanks():
    # Сценарий пользователя: диск Ø140 на 180 сегментов, 6 зубьев (вершина R70,
    # впадина R60), линия поперёк боковой грани на высоте 5.5 и move_edge −5.5.
    # Раньше вторая канавка рвала сетку (BSP: сотни щелей, 17 с), третья
    # подвешивала вкладку, оставались висящие линии
    P = lambda deg, r, z=11: [round(r*math.cos(math.radians(deg)), 4), round(r*math.sin(math.radians(deg)), 4), z]
    call('add_revolve', {'profile': [[0, 0], [70, 0], [70, 11], [0, 11]], 'segments': 180, 'operation': 'new'})
    for k in range(6):
        a = 60 * k
        call('draw_line', {'from': P(a + 8, 70), 'to': P(a + 22, 60)})
        call('draw_line', {'from': P(a + 22, 60), 'to': P(a + 38, 60)})
        call('draw_line', {'from': P(a + 38, 60), 'to': P(a + 52, 70)})
        closed(call('cut_through', {'point': P(a + 30, 67), 'normal': [0, 0, 1]}), f'gap {k}')
    t, n = time.time(), 0
    for k in range(3):  # две соседние грани одной впадины и следующий зуб
        a = 60 * k
        for t0, r0, t1, r1 in [(a + 8, 70, a + 22, 60), (a + 38, 60, a + 52, 70)]:
            A, B = P(t0, r0, 5.5), P(t1, r1, 5.5)
            call('draw_line', {'from': A, 'to': B})
            d = call('move_edge', {'point': [(A[0]+B[0])/2, (A[1]+B[1])/2, 5.5], 'distance': -5.5})
            n += 1
            closed(d, f'groove {n}')
            assert d.get('boolean') == 'exact', f'groove {n}: wedge not cut exactly'
            # одинаковые грани — одинаковый вырез (449–453; разница — обод по 2°)
            assert 440 < -d['volume_change_mm3'] < 460, f'groove {n}: removed {d["volume_change_mm3"]}'
    assert time.time() - t < 30, f'6 grooves took {time.time() - t:.1f} s'


@case
def hole_simple_counterbore_countersink():
    # Отверстие (G,D) — add_hole: глухое, сквозное, цековка и зенковка 90/82°,
    # конус сверла 118°, на боковой грани; пресеты М3…М6 — те же числа
    frustum = lambda r1, r2, h, n=48: h / 3 * (ngon(r1, n) + math.sqrt(ngon(r1, n) * ngon(r2, n)) + ngon(r2, n))
    call('new_shape', {'shape': 'cube', 'size': 40})
    d = call('add_hole', {'point': [20, 20, 40], 'diameter': 6, 'depth': 10, 'segments': 48})
    closed(d, 'blind'); exact(d, 'blind'); near(d['volume_change_mm3'], -ngon(3) * 10, 0.05, 'blind hole')
    call('new_shape', {'shape': 'cube', 'size': 40})
    d = call('add_hole', {'point': [20, 20, 40], 'diameter': 6, 'through': True, 'segments': 48})
    closed(d, 'through'); near(d['volume_change_mm3'], -ngon(3) * 40, 0.1, 'through hole')
    call('new_shape', {'shape': 'cube', 'size': 40})
    d = call('add_hole', {'point': [20, 20, 40], 'diameter': 6.6, 'through': True, 'type': 'counterbore',
                          'head_diameter': 11, 'head_depth': 6, 'segments': 48})
    closed(d, 'counterbore'); near(d['volume_change_mm3'], -(ngon(5.5) * 6 + ngon(3.3) * 34), 0.1, 'counterbore')
    for ang in (90, 82):
        call('new_shape', {'shape': 'cube', 'size': 40})
        d = call('add_hole', {'point': [20, 20, 40], 'diameter': 6.6, 'through': True, 'type': 'countersink',
                              'head_diameter': 12, 'angle': ang, 'segments': 48})
        dc = 2.7 / math.tan(math.radians(ang / 2))
        closed(d, f'countersink {ang}')
        near(d['volume_change_mm3'], -(frustum(6, 3.3, dc) + ngon(3.3) * (40 - dc)), 0.15, f'countersink {ang}')
    call('new_shape', {'shape': 'cube', 'size': 40})
    d = call('add_hole', {'point': [20, 20, 40], 'diameter': 6, 'depth': 10, 'tip': True, 'segments': 48})
    closed(d, 'drill tip')
    near(d['volume_change_mm3'], -(ngon(3) * 10 + frustum(3, 0, 3 / math.tan(math.radians(59)))), 0.05, 'drill tip 118')
    call('new_shape', {'shape': 'cube', 'size': 40})
    d = call('add_hole', {'point': [0, 20, 20], 'diameter': 5, 'depth': 12, 'segments': 48})
    closed(d, 'side'); near(d['volume_change_mm3'], -ngon(2.5) * 12, 0.05, 'hole in a side face')
    for args, msg in ((
        {'point': [20, 20, 40], 'diameter': 6, 'depth': 10, 'type': 'counterbore', 'head_diameter': 4, 'head_depth': 3}, 'wider than the hole'),
        ({'point': [20, 20, 40], 'diameter': 6.6, 'depth': 2, 'type': 'countersink', 'head_diameter': 12}, 'deeper than the hole'),
        ({'point': [200, 20, 40], 'diameter': 6, 'depth': 10}, 'no face at this point')):
        try:
            call('add_hole', args)
        except McpError as e:
            assert msg in str(e), str(e)
        else:
            raise AssertionError(f'must be refused: {msg}')


@case
def loft_between_two_profiles():
    # Loft (G,F) — loft_profiles: призма, усечённая пирамида, наклонная призма
    # по Кавальери, переходник круг → круг; вырез лофтом между кругом на крыше
    # куба и кругом на боковой грани
    sq = lambda s, z: [[-s, -s, z], [s, -s, z], [s, s, z], [-s, s, z]]
    circ = lambda r, z, n: [[round(r*math.cos(2*math.pi*i/n), 4), round(r*math.sin(2*math.pi*i/n), 4), z] for i in range(n)]
    d = call('loft_profiles', {'profile_a': sq(10, 0), 'profile_b': sq(10, 30), 'operation': 'new'})
    closed(d, 'prism'); near(d['volume_mm3'], 400 * 30, 1e-3, 'prism')
    d = call('loft_profiles', {'profile_a': sq(10, 0), 'profile_b': sq(4, 25), 'operation': 'new'})
    closed(d, 'frustum'); near(d['volume_mm3'], 25 / 3 * (400 + math.sqrt(400 * 64) + 64), 1e-3, 'frustum')
    d = call('loft_profiles', {'profile_a': sq(10, 0), 'profile_b': [[20, 20, 30], [40, 20, 30], [40, 40, 30], [20, 40, 30]], 'operation': 'new'})
    closed(d, 'oblique'); near(d['volume_mm3'], 400 * 30, 1e-3, 'oblique prism')
    A1, A2 = ngon(12, 32), ngon(4, 32)
    d = call('loft_profiles', {'profile_a': circ(12, 0, 32), 'profile_b': circ(4, 18, 32), 'operation': 'new'})
    closed(d, 'cone'); near(d['volume_mm3'], 18 / 3 * (A1 + math.sqrt(A1 * A2) + A2), 0.2, 'cone frustum')  # координаты округлены до 0.001 мм
    # вырез между двумя гранями куба: тем же путём, что окно G,F
    call('new_shape', {'shape': 'cube', 'size': 40})
    top = circ(12, 40, 48)
    side = [[40, round(20 + 6*math.cos(2*math.pi*i/48), 4), round(12 + 6*math.sin(2*math.pi*i/48), 4)] for i in range(48)]
    d = call('loft_profiles', {'profile_a': top, 'profile_b': side, 'operation': 'cut'})
    closed(d, 'loft cut'); exact(d, 'loft cut')
    assert -7000 < d['volume_change_mm3'] < -6000, d['volume_change_mm3']
    try:
        call('loft_profiles', {'profile_a': sq(10, 0), 'profile_b': sq(8, 0.01), 'operation': 'new'})
    except McpError as e:
        assert 'same place' in str(e), str(e)
    else:
        raise AssertionError('profiles in the same place must be refused')


@case
def move_edge_end_follow_face_or_straight():
    # Переключатель End окна Move edge: наклонный сосед у конца линии.
    # Follow face — торец клина ложится в его плоскость, конец линии едет вдоль
    # соседа (32 → 33 мм); Straight — торцы поперёк линии, длина сохраняется,
    # снято ровно сечение × длина
    out = {}
    for end in ('face', 'straight'):
        call('new_shape', {'shape': 'cube', 'size': 40})
        call('cut_plane', {'point': [32, 0, 0], 'normal': [1, -0.2, 0]})
        call('draw_line', {'from': [0, 0, 20], 'to': [32, 0, 20]})
        d = call('move_edge', {'point': [16, 0, 20], 'distance': -5, 'end': end})
        closed(d, 'move_edge ' + end); exact(d, 'move_edge ' + end)
        out[end] = d['volume_change_mm3']
    near(out['straight'], -100 * 32, 0.1, 'straight: section 100 mm² × 32 mm')
    assert out['face'] < out['straight'] - 20, f"follow face must reach into the neighbour: {out}"
    call('new_shape', {'shape': 'cube', 'size': 40})
    call('draw_line', {'from': [0, 0, 20], 'to': [32, 0, 20]})
    try:
        call('move_edge', {'point': [16, 0, 20], 'distance': -5, 'end': 'sideways'})
    except McpError as e:
        assert 'face or straight' in str(e), str(e)
    else:
        raise AssertionError('an unknown end mode must be refused')


@case
def bevel_edges_tool():
    call('new_shape', {'shape': 'cube', 'size': 40})
    d = call('bevel_edges', {'points': [[20, 0, 40]], 'size': 4, 'segments': 1})
    closed(d); exact(d); near(d['volume_mm3'], 64000 - 320, 0.01, 'chamfer 4')
    call('new_shape', {'shape': 'cube', 'size': 40})
    d = call('bevel_edges', {'points': [[20, 0, 40]], 'size': 4, 'segments': 8})
    closed(d); near(d['volume_mm3'], 64000 - 40 * (16 - 64 * math.sin(math.pi / 16)), 0.01, 'round 4x8')


@case
def text_engraving_xyz_cube():
    call('new_shape', {'shape': 'cube', 'size': 20})
    call('add_text', {'center': [10, 0, 10], 'normal': [0, -1, 0], 'text': 'X', 'height': 12, 'depth': -1})
    call('add_text', {'center': [20, 10, 10], 'normal': [1, 0, 0], 'text': 'Y', 'height': 12, 'depth': -1})
    d = call('add_text', {'center': [10, 10, 20], 'normal': [0, 0, 1], 'text': 'Z', 'height': 12, 'depth': -1})
    closed(d, 'XYZ'); exact(d, 'XYZ'); near(d['volume_mm3'], 7876.55, 0.1, 'XYZ calibration cube')


@case
def gear_hole_and_engraving_fast():
    g = call('new_shape', {'shape': 'gear', 'size': 60})
    top = g['bbox_max'][2]
    call('draw_circle', {'center': [12, 0, top], 'normal': [0, 0, 1], 'radius': 4, 'segments': 48})
    t = time.time()
    d = call('extrude_face', {'point': [12, 0, top], 'normal': [0, 0, 1], 'distance': -top})
    closed(d, 'gear hole'); exact(d, 'gear hole')
    assert time.time() - t < 3, f'gear through hole took {time.time() - t:.1f} s'
    d = call('add_text', {'center': [0, -15, top], 'normal': [0, 0, 1], 'text': 'ZC', 'height': 8, 'depth': -1})
    closed(d, 'gear text'); exact(d, 'gear text')


@case
def export_stl_printable():
    call('new_shape', {'shape': 'cube', 'size': 20})
    d = call('export_stl', {'name': 'zerocad_test_cube'})
    assert d.get('printable') is True, d
    assert d['triangles'] == 12


def main():
    global URL
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--url', default=URL, help='MCP endpoint, default ' + URL)
    ap.add_argument('--yes', action='store_true', help='confirm that the model in the open tab may be replaced')
    ap.add_argument('-k', default='', help='run only tests whose name contains this text')
    a = ap.parse_args()
    URL = a.url
    if not a.yes:
        print('These tests replace the model in the open ZeroCAD tab. Re-run with --yes.')
        return 2
    try:
        call('get_state')
    except Exception as e:
        print(f'Cannot reach an editor tab through {URL}: {e}')
        return 2
    failed = 0
    for fn in TESTS:
        if a.k and a.k not in fn.__name__:
            continue
        t = time.time()
        try:
            fn()
            print(f'ok    {fn.__name__} ({time.time() - t:.1f} s)')
        except (AssertionError, McpError) as e:
            failed += 1
            print(f'FAIL  {fn.__name__}: {e}')
    print('all passed' if not failed else f'{failed} failed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
