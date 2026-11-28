#!/usr/bin/env python3
"""Интеграционные тесты ZeroCAD через MCP: команды агента и инструменты мыши
(выдавливание, карман, фаска, текст) на настоящем редакторе в браузере.

Нужны тестовый сервер и открытая вкладка его редактора: команды выполняет
она. Тестовый сервер (ZEROCAD_TEST=1) держит свой сеанс — модель в общем
сеансе пользователя тесты не трогают; против обычного сервера run.py не
запускается (--allow-main — если очень надо).

    ZEROCAD_TEST=1 PORT=9012 cargo run               # и открыть http://127.0.0.1:9012
    python tests/mcp/run.py --yes --url http://127.0.0.1:9012/mcp
    python tests/mcp/run.py --yes -k bevel            # только тесты с «bevel»

Файлы, которые тесты экспортируют в exports/, после прогона удаляются.
Только стандартная библиотека. Код выхода 0 — всё прошло.
"""
import argparse, json, math, os, sys, time, urllib.request

URL = 'http://127.0.0.1:9000/mcp'


class McpError(Exception):
    pass


# файлы, которые тесты заставили сервер записать в exports/ (export_*,
# save_file): после прогона удаляются — в папке остаётся только работа
# пользователя, тестовые кубы не путаются с его моделями в слайсере
CREATED = set()


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
    out = json.loads(c['text']) if c['type'] == 'text' else c
    if (tool.startswith('export_') or tool == 'save_file') and isinstance(out, dict) and out.get('path'):
        CREATED.add(out['path'])
    return out


def cleanup_exports():
    import os
    for path in sorted(CREATED):
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
        except OSError as e:
            print(f'cannot remove {path}: {e}')
    CREATED.clear()


def closed(d, what=''):
    assert d['open_edges'] == 0, f'{what}: open_edges {d["open_edges"]}'
    assert d['nonmanifold_edges'] == 0, f'{what}: nonmanifold_edges {d["nonmanifold_edges"]}'


def unfolded(d, what=''):
    # вывернутый лоскут в плоскости грани: сетка замкнута, но это дефект.
    # Пока не во всех сценариях: выдавливание кармана и move_edge их ещё
    # оставляют (README, «Загибы») — проверяем там, где они уже исправлены
    closed(d, what)
    assert d.get('folded_edges', 0) == 0, f'{what}: folded_edges {d.get("folded_edges")}'


def near(a, b, tol, what=''):
    assert abs(a - b) <= tol, f'{what}: {a} vs {b} (±{tol})'


def exact(d, what=''):
    # точный путь — наш meshBoolean или Manifold; не запасной BSP
    assert d.get('boolean', 'exact') in ('exact', 'manifold'), f'{what}: boolean path {d.get("boolean")}'


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
def polar_pattern_body_and_features():
    # Круговой массив (G,A по телу, Circular Pattern во Fusion): pattern_body —
    # копии тела по кругу; pattern у команд тела — элемент строится раз и
    # режется/добавляется count раз одним шагом (плавники по стенке, отверстия
    # по фланцу). Числа — точные объёмы
    call('new_shape', {'shape': 'cube', 'size': 20})
    d = call('pattern_body', {'axis_point': [50, 10, 0], 'count': 4})
    closed(d, 'apart'); near(d['volume_mm3'], 32000, 1e-3, '4 cubes apart')
    assert d['boolean'] == 'none' and d['undo_steps'] == 1, d
    call('new_shape', {'shape': 'cube', 'size': 20})
    d = call('pattern_body', {'axis_point': [15, 10, 0], 'count': 4})
    closed(d, 'overlap'); exact(d, 'overlap'); near(d['volume_mm3'], 16000, 1e-2, '4 overlapping cubes')
    call('new_shape', {'shape': 'cube', 'size': 20})
    d = call('pattern_body', {'axis_point': [50, 10, 0], 'count': 3, 'angle': 180})
    near(d['bbox_max'][0], 100, 1e-3, 'half turn: 0, 90, 180')
    # плавники на стенке трубы: 6 штук одним вызовом = 6 по отдельности
    call('new_shape', {'shape': 'cube', 'size': 100})
    call('add_revolve', {'profile': [[0, 0], [40, 0], [40, 50], [0, 50]], 'base': [50, 50, 0], 'segments': 96, 'operation': 'intersect'})
    d0 = call('add_revolve', {'profile': [[0, -1], [37, -1], [37, 51], [0, 51]], 'base': [50, 50, 0], 'segments': 96, 'operation': 'cut'})
    fin = lambda s: [[50 + 37.5, 50 + s, 40], [50 + 33, 50 + s, 40], [50 + 37.5, 50 + s, 30]]
    one = call('loft_profiles', {'profile_a': fin(-1.5), 'profile_b': fin(1.5)})
    call('undo')
    d = call('loft_profiles', {'profile_a': fin(-1.5), 'profile_b': fin(1.5),
                               'pattern': {'count': 6, 'axis_point': [50, 50, 0]}})
    closed(d, 'fins'); exact(d, 'fins'); assert d['pattern_copies'] == 6 and d['undo_steps'] == d0['undo_steps'] + 1, d
    near(d['volume_change_mm3'], 6 * one['volume_change_mm3'], 0.05, '6 fins = 6 × one fin')
    # отверстия по фланцу: 8 × Ø6 сквозь плиту 10
    call('new_shape', {'shape': 'cube', 'size': 100})
    call('cut_plane', {'point': [0, 0, 10], 'normal': [0, 0, 1]})
    d = call('add_hole', {'point': [80, 50, 10], 'diameter': 6, 'through': True, 'segments': 48,
                          'pattern': {'count': 8, 'axis_point': [50, 50, 0]}})
    closed(d, 'holes'); near(d['volume_change_mm3'], -8 * ngon(3) * 10, 0.05, '8 holes')
    for bad, msg in [({'count': 1, 'axis_point': [0, 0, 0]}, 'count'), ({'count': 4}, 'axis_point')]:
        try:
            call('add_frustum', {'from': [0, 0, 0], 'to': [0, 0, 5], 'r1': 2, 'r2': 2, 'pattern': bad})
        except McpError as e:
            assert msg in str(e), str(e)
        else:
            raise AssertionError('bad pattern must be refused: %r' % bad)
    try:
        call('add_text', {'text': 'A', 'point': [50, 50, 10], 'pattern': {'count': 2, 'axis_point': [0, 0, 0]}})
    except McpError as e:
        assert 'not supported' in str(e), str(e)
    else:
        raise AssertionError('pattern on add_text must be refused')


@case
def view_section_and_save_formats():
    # set_view — виды ViewCube для агента; screenshot с разрезом только на
    # снимке; save_file — проект .zcad и все форматы экспорта в exports/
    call('new_shape', {'shape': 'cylinder', 'size': 40, 'height': 30})
    d = call('set_view', {'view': 'front', 'fit': True})
    assert d['yaw_deg'] == -90 and d['pitch_deg'] == 0, d
    near(d['target'][2], 15, 1e-6, 'fit centre')
    d = call('set_view', {'view': 'top', 'target': [1, 2, 3], 'distance': 150})
    assert d['pitch_deg'] > 85 and d['target'] == [1, 2, 3] and d['distance_mm'] == 150, d
    try:
        call('set_view', {'view': 'sideways'})
    except McpError as e:
        assert 'view must be one of' in str(e), str(e)
    else:
        raise AssertionError('unknown view must be refused')
    img = call('screenshot', {'view': 'iso', 'fit': True, 'width': 300, 'height': 200,
                              'section': {'point': [20, 20, 0], 'normal': [0, -1, 0]}})
    assert img['type'] == 'image' and len(img['data']) > 1000, img.get('type')
    import base64, os
    for fmt in ['zcad', 'stl', '3mf', 'glb', 'obj', 'step']:
        d = call('save_file', {'format': fmt, 'name': 'zc_test_save'})
        assert d['path'].endswith('zc_test_save.' + fmt) and os.path.getsize(d['path']) == d['bytes'], d
        assert d['printable'], d
        head = open(d['path'], 'rb').read(64)
        sig = {'zcad': b'{', '3mf': b'PK', 'glb': b'glTF', 'step': b'ISO-10303-21', 'obj': b'#'}.get(fmt)
        if sig:
            assert head.startswith(sig), (fmt, head[:16])
        os.remove(d['path'])
    try:
        call('save_file', {'format': 'dwg'})
    except McpError as e:
        assert 'format must be' in str(e), str(e)
    else:
        raise AssertionError('unknown format must be refused')


@case
def parametric_history_edit_delete_undo():
    # История операций: команды записываются шагами, edit_step / delete_step
    # пересобирают модель повтором с нуля — результат обязан совпасть с
    # моделью, построенной сразу с новыми числами; сломанный шаг — failed и
    # пропускается; undo возвращает и модель, и историю; история едет в
    # проекте (3MF несёт .zcad). Правка мышью мимо истории (base) проверена
    # сценарием в браузере (README, «История операций»)
    def build(t, hole=8.0):
        call('new_shape', {'shape': 'cube', 'size': 100})
        call('add_revolve', {'profile': [[0, 0], [40, 0], [40, 60], [0, 60]], 'base': [50, 50, 0], 'segments': 96, 'operation': 'intersect'})
        d = call('shell_body', {'thickness': t, 'open_faces': [{'point': [50, 50, 60]}]})
        if hole:
            d = call('add_hole', {'point': [50, 50, 0], 'normal': [0, 0, -1], 'diameter': hole, 'through': True, 'segments': 48})
        return d
    ref = {k: build(*k)['volume_mm3'] for k in [(3, 8.0), (3, 12.0), (3, None), (2, 12.0)]}
    d = build(2)
    assert d['history_step'] == 3, d
    h = call('get_history')
    assert [s['command'] for s in h['steps']] == ['new_shape', 'add_revolve', 'shell_body', 'add_hole'], h
    d = call('edit_step', {'index': 2, 'args': {'thickness': 3}})
    closed(d, 'wall 3'); near(d['volume_mm3'], ref[(3, 8.0)], 1e-3, 'wall 3'); assert d['failed'] == [], d
    d = call('edit_step', {'index': 3, 'args': {'diameter': 12}})
    near(d['volume_mm3'], ref[(3, 12.0)], 1e-3, 'hole 12')
    d = call('delete_step', {'index': 3})
    near(d['volume_mm3'], ref[(3, None)], 1e-3, 'no hole'); assert len(d['steps']) == 3, d
    d = call('undo')
    near(d['volume_mm3'], ref[(3, 12.0)], 1e-3, 'undo brings the hole back')
    assert len(call('get_history')['steps']) == 4, 'undo brings the step back too'
    d = call('edit_step', {'index': 2, 'args': {'thickness': 45}})
    assert d['failed'] == [2] and d['steps'][2]['status'].startswith('failed'), d
    d = call('edit_step', {'index': 2, 'args': {'thickness': 3}})
    assert d['failed'] == [], d
    near(d['volume_mm3'], ref[(3, 12.0)], 1e-3, 'fixed again')
    # история в проекте: свой 3MF открывается обратно вместе с ней
    import os
    path = call('save_file', {'format': '3mf', 'name': 'zc_test_history'})['path']
    call('new_shape', {'shape': 'cube', 'size': 10})
    call('import_3mf', {'path': path})
    os.remove(path)
    h = call('get_history')
    assert [s['command'] for s in h['steps']] == ['new_shape', 'add_revolve', 'shell_body', 'add_hole'], h
    d = call('edit_step', {'index': 2, 'args': {'thickness': 2}})
    near(d['volume_mm3'], ref[(2, 12.0)], 1e-3, 'edit after reopening')
    # .zcad: open_project открывает проект с историей и правится дальше
    path = call('save_file', {'format': 'zcad', 'name': 'zc_test_history'})['path']
    call('new_shape', {'shape': 'cube', 'size': 10})
    d = call('open_project', {'path': 'zc_test_history.zcad'})
    assert d['opened'] == 'project' and d['history_steps'] == 4, d
    d = call('edit_step', {'index': 2, 'args': {'thickness': 3}})
    near(d['volume_mm3'], ref[(3, 12.0)], 1e-3, 'edit after open_project')
    try:
        call('open_project', {'path': 'no_such_file.zcad'})
    except McpError as e:
        assert 'cannot read' in str(e), str(e)
    else:
        raise AssertionError('missing file must be refused')
    # ошибки: шаг 0 не удаляется, индекс вне истории
    for tool, args, msg in [('delete_step', {'index': 0}, 'step 0'), ('edit_step', {'index': 9, 'args': {'x': 1}}, 'index must be')]:
        try:
            call(tool, args)
        except McpError as e:
            assert msg in str(e), str(e)
        else:
            raise AssertionError('must be refused: %s %r' % (tool, args))


@case
def text_wrapped_on_round_walls():
    # Текст по цилиндру (wrap): буквы изгибаются вокруг оси, глубина ровная по
    # всей строке — снаружи трубы и изнутри. Плоский блок на кривой стенке
    # уходил бы краями вглубь и оставлял скрытые полости. Круг — 64-угольник,
    # поэтому глубина у середины граней отличается на сотые: допуск 10 %
    call('new_shape', {'shape': 'cylinder', 'size': 80, 'height': 60})
    call('shell_body', {'thickness': 3, 'open_faces': [{'point': [40, 40, 60]}]})
    w = {'axis_point': [40, 40, 0]}
    for center, normal, text in [([80, 40, 30], [1, 0, 0], '15.11.2026'), ([77, 40, 30], [-1, 0, 0], 'PETG')]:
        d = call('add_text', {'center': center, 'normal': normal, 'text': text, 'height': 6, 'depth': -0.6, 'wrap': w})
        unfolded(d, 'wrap ' + text); exact(d, 'wrap ' + text)
        area = d['solid_volume_mm3'] / 1.6           # тело букв: 1 мм над стенкой + 0.6 вглубь
        near(-d['volume_change_mm3'], area * 0.6, area * 0.6 * 0.1, 'even depth ' + text)
    # стенка Shell из длинных узких треугольников (1 × 69 мм, как у колпака):
    # чистка щепок после выреза стягивала вершину и выворачивала соседа —
    # плоский лоскут (folded_edges); collapseShortEdges теперь это запрещает
    call('new_shape', {'shape': 'cube', 'size': 160})
    call('add_revolve', {'profile': [[0, 0], [6.929, 0], [48.25, 67.7], [48.25, 137.7], [0, 137.7]],
                         'base': [80, 80, 0], 'segments': 128, 'operation': 'intersect'})
    call('shell_body', {'thickness': 2.5, 'open_faces': [{'point': [80, 80, 137.7]}, {'point': [80, 80, 0]}]})
    cw = {'axis_point': [80, 80, 0]}
    for z, text in [(98, '15.11.2026'), (88, 'PETG')]:
        d = call('add_text', {'center': [125.75, 80, z], 'normal': [-1, 0, 0], 'text': text, 'height': 6, 'depth': -0.6, 'wrap': cw})
        unfolded(d, 'canopy ' + text)
    call('new_shape', {'shape': 'cylinder', 'size': 80, 'height': 60})
    for args, msg in [({'center': [40, 40, 60], 'normal': [0, 0, 1]}, 'parallel'),
                      ({'center': [80, 40, 30], 'normal': [1, 0, 0], 'text': 'X' * 30}, 'half the circumference')]:
        a = {'text': 'AB', 'height': 6, 'depth': -0.6, 'wrap': w}
        a.update(args)
        try:
            call('add_text', a)
        except McpError as e:
            assert msg in str(e), str(e)
        else:
            raise AssertionError('must be refused: %r' % args)


@case
def text_projected_onto_cone():
    # Текст проекцией (project): строка на плоскости, обращённой вверх, по
    # лучам вниз ложится на дно воронки 45°. Сверху — ровная, на склоне —
    # вытянута в √2; глубина — по нормали склона: вырез ≈ площадь букв на
    # склоне × 0.6 (тело букв — 1 мм над склоном + 0.6 вглубь)
    call('new_shape', {'shape': 'cube', 'size': 100})
    call('add_revolve', {'profile': [[0, 0], [5, 0], [45, 40], [45, 60], [0, 60]], 'base': [50, 50, 0], 'segments': 128, 'operation': 'intersect'})
    call('shell_body', {'thickness': 3, 'open_faces': [{'point': [50, 50, 60]}]})
    d = call('add_text', {'center': [50, 70, 100], 'normal': [0, 0, 1], 'text': '15.11.2026', 'height': 5, 'depth': -0.6, 'project': True})
    unfolded(d, 'project'); exact(d, 'project')
    near(-d['volume_change_mm3'], d['solid_volume_mm3'] / 1.6 * 0.6, d['solid_volume_mm3'] / 1.6 * 0.6 * 0.1, 'even depth on the slope')
    d = call('add_text', {'center': [50, 32, 100], 'normal': [0, 0, 1], 'text': 'PETG', 'height': 5, 'depth': 0.5, 'project': True})
    unfolded(d, 'project raised'); assert d['volume_change_mm3'] > 0, d
    # Лучи стартуют с плоскости текста: брусок над склоном (как плавник
    # колпака) с плоскости выше него перехватывает часть лучей — отказ с
    # понятной причиной, а не «лучи» до бруска; с плоскости ниже — проходит.
    # rotate поворачивает строку в её плоскости
    call('new_shape', {'shape': 'cube', 'size': 100})
    call('add_revolve', {'profile': [[0, 0], [5, 0], [45, 40], [45, 60], [0, 60]], 'base': [50, 50, 0], 'segments': 128, 'operation': 'intersect'})
    call('shell_body', {'thickness': 3, 'open_faces': [{'point': [50, 50, 60]}]})
    call('add_frustum', {'from': [40, 68, 50], 'to': [60, 68, 50], 'r1': 2, 'r2': 2, 'segments': 24, 'operation': 'join'})
    try:
        call('add_text', {'center': [50, 70, 100], 'normal': [0, 0, 1], 'text': '15.11.2026', 'height': 5, 'depth': 0.5, 'project': True})
    except McpError as e:
        assert 'another surface' in str(e) or 'parallel' in str(e), str(e)  # бок бруска — почти вдоль взгляда
    else:
        raise AssertionError('a bar above the plane of the text must stop the projection')
    d = call('add_text', {'center': [50, 70, 45], 'normal': [0, 0, 1], 'text': '15.11.2026', 'height': 5, 'depth': 0.5, 'project': True, 'rotate': -10})
    unfolded(d, 'project under the bar'); assert d['volume_change_mm3'] > 0, d
    # строка шире воронки: часть лучей проходит мимо модели — отказ
    try:
        call('add_text', {'center': [50, 50, 100], 'normal': [0, 0, 1], 'text': 'X' * 40, 'height': 5, 'depth': -0.6, 'project': True})
    except McpError as e:
        assert 'falls past' in str(e), str(e)
    else:
        raise AssertionError('text past the model must be refused')


@case
def text_sketch_on_curve_then_extrude_letters():
    # Чертёжный текст на кривой: add_text с глубиной 0 и project/wrap рисует
    # контуры линиями (эскиз, объём не меняется); extrude_text по точке
    # выдавливает или вдавливает одну букву — тем же отображателем, что и
    # весь текст; whole — всю строку. Каждый шаг — в истории
    call('new_shape', {'shape': 'cube', 'size': 100})
    call('add_revolve', {'profile': [[0, 0], [5, 0], [45, 40], [45, 60], [0, 60]], 'base': [50, 50, 0], 'segments': 128, 'operation': 'intersect'})
    v0 = call('shell_body', {'thickness': 3, 'open_faces': [{'point': [50, 50, 60]}]})['volume_mm3']
    d = call('add_text', {'center': [50, 70, 45], 'normal': [0, 0, 1], 'text': 'AB', 'height': 10, 'depth': 0, 'project': True})
    assert d['letters'] == 2 and d['outline_segments'] > 100 and d['lines'] >= d['outline_segments'], d
    near(d['volume_mm3'], v0, 1e-6, 'outline adds no volume')
    z = lambda x, y: math.hypot(x - 50, y - 50) - 0.757          # склон изнутри: r = z + 0.757
    xa, ya = 50 - 15.71 / 2 + 1, 66
    a = call('extrude_text', {'point': [xa, ya, z(xa, ya)], 'distance': 0.8})
    unfolded(a, 'letter A'); assert a['volume_change_mm3'] > 0 and a['cells'] < 120, a
    xb = 50 + 15.71 / 2 - 1
    b = call('extrude_text', {'point': [xb, ya, z(xb, ya)], 'distance': -0.6})
    unfolded(b, 'letter B'); assert b['volume_change_mm3'] < 0, b
    h = call('get_history')
    assert [s['command'] for s in h['steps']][-3:] == ['add_text', 'extrude_text', 'extrude_text'], h
    try:
        call('extrude_text', {'point': [50, 30, z(50, 30)], 'distance': 0.5})
    except McpError as e:
        assert 'not on a letter' in str(e), str(e)
    else:
        raise AssertionError('a point off the letters must be refused')
    # на цилиндре (wrap) — вся строка сразу
    call('new_shape', {'shape': 'cylinder', 'size': 80, 'height': 60})
    d = call('add_text', {'center': [80, 40, 30], 'normal': [1, 0, 0], 'text': 'PETG', 'height': 8, 'depth': 0, 'wrap': {'axis_point': [40, 40, 0]}})
    assert d['letters'] == 4, d
    w = call('extrude_text', {'point': [80, 40, 30], 'distance': 0.5, 'whole': True})
    unfolded(w, 'whole line'); assert w['volume_change_mm3'] > 0, w


@case
def patterns_honeycomb_relief_meander():
    # Узоры add_pattern: поле линий → полоса marching squares → тело,
    # отображённое на поверхность тем же textMapper, что текст. Соты и рельеф
    # сот (у каждой соты своя наклонная крышка) — по стенке трубы; меандр —
    # проекцией на дно воронки сквозь отверстие (skip_missing обходит дыру)
    call('new_shape', {'shape': 'cylinder', 'size': 80, 'height': 60})
    call('shell_body', {'thickness': 3, 'open_faces': [{'point': [40, 40, 60]}]})
    w = {'axis_point': [40, 40, 0]}
    d = call('add_pattern', {'kind': 'honeycomb', 'center': [77, 40, 30], 'normal': [-1, 0, 0], 'length': 60, 'height': 20,
                             'cell': 8, 'line': 1.2, 'depth': 0.6, 'wrap': w})
    unfolded(d, 'honeycomb'); assert d['volume_change_mm3'] > 100, d
    d = call('add_pattern', {'kind': 'honeycomb_relief', 'center': [40, 77, 30], 'normal': [0, -1, 0], 'length': 50, 'height': 18,
                             'cell': 8, 'line': 1.0, 'depth': 1.0, 'seed': 3, 'wrap': w})
    unfolded(d, 'relief'); assert d['volume_change_mm3'] > 100, d
    # замкнутое кольцо без шва (ring): шаг подгоняется под целое число сот,
    # у полосы нет концов; fill cells — выдавливаются сами соты
    for fill in ['walls', 'cells']:
        call('new_shape', {'shape': 'cylinder', 'size': 80, 'height': 60})
        call('shell_body', {'thickness': 3, 'open_faces': [{'point': [40, 40, 60]}]})
        d = call('add_pattern', {'kind': 'honeycomb', 'fill': fill, 'ring': True, 'center': [77, 40, 30], 'normal': [-1, 0, 0],
                                 'length': 0, 'height': 18, 'cell': 8, 'line': 1.2, 'depth': 0.6, 'wrap': w})
        unfolded(d, 'ring ' + fill)
        near(d['cell_used_mm'] * d['cells_around'], 2 * math.pi * 37, 1e-2, 'whole cells around')
    call('new_shape', {'shape': 'cube', 'size': 100})
    call('add_revolve', {'profile': [[0, 0], [6.929, 0], [48.25, 67.7], [48.25, 100], [0, 100]], 'base': [50, 50, 0], 'segments': 128, 'operation': 'intersect'})
    call('shell_body', {'thickness': 2.5, 'open_faces': [{'point': [50, 50, 100]}, {'point': [50, 50, 0]}]})
    d = call('add_pattern', {'kind': 'meander', 'center': [50, 50, 69], 'normal': [0, 0, 1], 'length': 80, 'height': 14,
                             'cell': 1.5, 'line': 1.2, 'depth': 0.6, 'project': True, 'skip_missing': True})
    closed(d, 'meander over the hole'); assert d['volume_change_mm3'] > 100, d
    # onto_point: проекция только на гладкую поверхность под точкой — брусок над
    # склоном (как плавник) не мешает даже с плоскостью далеко вверху; так
    # проецирует окно узоров (G,N)
    call('add_frustum', {'from': [40, 75, 60], 'to': [60, 75, 60], 'r1': 2, 'r2': 2, 'segments': 24, 'operation': 'join'})
    d = call('add_pattern', {'kind': 'honeycomb', 'center': [50, 72, 500], 'normal': [0, 0, 1], 'length': 30, 'height': 12,
                             'cell': 6, 'line': 1.0, 'depth': 0.5, 'project': True, 'onto_point': [50, 72, 29.49]})
    closed(d, 'onto the cone under the bar'); assert d['volume_change_mm3'] > 20, d
    for args, msg in [({'kind': 'stars'}, 'pattern must be'), ({'line': 9}, 'line must be')]:
        a = {'kind': 'honeycomb', 'center': [50, 50, 69], 'normal': [0, 0, 1], 'length': 40, 'height': 10, 'cell': 8,
             'line': 1.2, 'depth': 0.5, 'project': True}
        a.update(args)
        try:
            call('add_pattern', a)
        except McpError as e:
            assert msg in str(e), str(e)
        else:
            raise AssertionError('must be refused: %r' % args)


@case
def text_symbols_triskele():
    # Векторные знаки в тексте: {triskele} — квадрат высоты строки, штрихи с
    # толщиной; один знак, знак среди букв, по стенке трубы и проекцией
    call('new_shape', {'shape': 'cube', 'size': 60})
    d = call('add_text', {'text': '{triskele}', 'center': [30, 30, 60], 'normal': [0, 0, 1], 'height': 20, 'depth': 0.8})
    unfolded(d, 'one symbol'); assert d['symbols'] == ['triskele'] and d['volume_change_mm3'] > 20, d
    near(d['text_width_mm'], 20, 1e-3, 'a symbol is 7 columns wide: a square of the text height')
    d = call('add_text', {'text': 'AB {Triskele} 7', 'center': [30, 0, 30], 'normal': [0, -1, 0], 'height': 8, 'depth': -0.5})
    unfolded(d, 'symbol among letters'); assert d['volume_change_mm3'] < -5, d
    near(d['text_width_mm'], (6 * 3 + 8 + 6 + 6 - 1) * 8 / 7, 1e-3, 'width: letters 6 columns, the symbol 8')
    call('new_shape', {'shape': 'cylinder', 'size': 80, 'height': 40})
    d = call('add_text', {'text': 'Z{triskele}Z', 'center': [80, 40, 20], 'normal': [1, 0, 0], 'height': 10, 'depth': 0.6,
                          'wrap': {'axis_point': [40, 40, 0]}})
    unfolded(d, 'wrapped symbol'); assert d['volume_change_mm3'] > 5, d
    d = call('add_text', {'text': '{triskele}', 'center': [40, 40, 45], 'normal': [0, 0, 1], 'height': 14, 'depth': -0.5,
                          'project': True})
    unfolded(d, 'projected symbol'); assert d['volume_change_mm3'] < -5, d
    for args, msg in [({'text': '{star}'}, 'unknown symbol'), ({'text': '{triskele}', 'depth': 0, 'project': True}, 'symbols need depth')]:
        a = {'center': [40, 40, 45], 'normal': [0, 0, 1], 'height': 10, 'depth': 0.5}
        a.update(args)
        try:
            call('add_text', a)
        except McpError as e:
            assert msg in str(e), str(e)
        else:
            raise AssertionError('must be refused: %r' % args)


@case
def texture_surface_displacement():
    # Текстура по поверхности: дробление до resolution + сдвиг вершин по
    # нормали. Сетка замкнута (решение о делении — по ребру, у обоих соседей
    # одинаково), маски держат низ ровным, область под точкой — только её
    call('new_shape', {'shape': 'cube', 'size': 30})
    d = call('texture_surface', {'texture': 'voronoi', 'depth': 0.6, 'size': 5, 'resolution': 0.6, 'mask_bottom_deg': 30})
    unfolded(d, 'voronoi cube'); assert d['volume_change_mm3'] > 100, d
    near(d['bbox_min'][2], 0, 1e-6, 'masked bottom stays flat on the bed')
    call('new_shape', {'shape': 'cylinder', 'size': 30, 'height': 20})
    d = call('texture_surface', {'texture': 'knurl', 'depth': -0.5, 'size': 3, 'resolution': 0.6, 'projection': 'cylindrical',
                                 'mask_bottom_deg': 30, 'mask_top_deg': 30})
    unfolded(d, 'knurled cylinder'); assert d['volume_change_mm3'] < -50, d
    turns = 2 * math.pi * 15 / d['tile_u_mm']  # радиус граней чуть меньше 15 — почти целое
    near(turns, round(turns), 0.1, 'whole tiles round the cylinder (no seam)')
    call('new_shape', {'shape': 'cube', 'size': 30})
    d = call('texture_surface', {'texture': 'hex', 'depth': 0.5, 'size': 4, 'resolution': 0.6, 'point': [15, 15, 30]})
    unfolded(d, 'top face only'); near(d['bbox_min'][0], 0, 1e-6, 'sides untouched'); near(d['bbox_max'][0], 30, 1e-6, 'sides untouched')
    assert d['bbox_max'][2] > 30.3, d
    # карта высот из картинки: полосы 8×8 px
    import struct, zlib
    raw = b''.join(b'\x00' + bytes([255 if (x // 2) % 2 else 0 for x in range(8)]) for _ in range(8))
    ch = lambda t, b: struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t + b) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', 8, 8, 8, 0, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b'')
    img = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_stripes.png')
    open(img, 'wb').write(png)
    try:
        call('new_shape', {'shape': 'cube', 'size': 30})
        d = call('texture_surface', {'texture': 'image', 'path': img, 'depth': 0.4, 'size': 6, 'resolution': 0.6, 'point': [15, 15, 30],
                                     'projection': 'planar_xy'})
        unfolded(d, 'image height map'); assert d['volume_change_mm3'] > 20, d
    finally:
        os.remove(img)
    for args, msg in [({'texture': 'plasma'}, 'texture must be'), ({'resolution': 0.01}, 'resolution'), ({'depth': 0}, 'depth')]:
        a = {'texture': 'noise', 'depth': 0.5}
        a.update(args)
        try:
            call('texture_surface', a)
        except McpError as e:
            assert msg in str(e), str(e)
        else:
            raise AssertionError('must be refused: %r' % args)


@case
def rotate_body_upside_down():
    # transform_body rotate: поворот вокруг оси через центр габарита —
    # переворот детали для печати (колпак вверх дном). Это поворот, а не
    # зеркало: надпись остаётся читаемой, объём и габарит те же
    call('new_shape', {'shape': 'cube', 'size': 20})
    t = call('add_text', {'text': 'UP', 'center': [10, 10, 20], 'normal': [0, 0, 1], 'height': 8, 'depth': 1})
    v0 = t['volume_mm3']
    d = call('transform_body', {'rotate': {'axis': [1, 0, 0], 'angle': 180}})
    closed(d, 'rotated'); near(d['volume_mm3'], v0, 1e-3, 'volume kept')
    near(d['bbox_min'][2], 0, 1e-3, 'the letters now stick out below'); near(d['bbox_max'][2], 21, 1e-3, 'the cube went up')
    # повернуть ещё раз — вернулось на место
    d = call('transform_body', {'rotate': {'axis': [1, 0, 0], 'angle': 180}})
    near(d['bbox_max'][2], 21, 1e-3, 'back'); near(d['bbox_min'][2], 0, 1e-3, 'back')
    try:
        call('transform_body', {'rotate': {'axis': [0, 0, 0], 'angle': 90}})
    except McpError as e:
        assert 'axis' in str(e), str(e)
    else:
        raise AssertionError('zero axis must be refused')


@case
def concave_edge_gets_a_cove():
    # Ctrl+B на внутреннем ребре: не срез, а добавка — выкружка между гранями
    # (как Fillet во Fusion). Площадь добавки на 90° = r² − площадь сектора
    # из segments хорд; ребро в кармане упирается в дно — выкружка до него
    import math
    call('new_shape', {'shape': 'cube', 'size': 20})
    b = lambda z: [[10, -1, z], [21, -1, z], [21, 21, z], [10, 21, z]]
    call('loft_profiles', {'profile_a': b(10), 'profile_b': b(21), 'operation': 'cut'})   # ступенька
    d = call('bevel_edges', {'points': [[10, 10, 10]], 'size': 2, 'segments': 8})
    closed(d, 'step cove')
    near(d['volume_change_mm3'], (4 - 0.5 * 4 * 8 * math.sin(math.pi / 16)) * 20, 0.02, 'step cove volume')
    call('new_shape', {'shape': 'cube', 'size': 20})
    b = lambda z: [[5, 5, z], [15, 5, z], [15, 15, z], [5, 15, z]]
    call('loft_profiles', {'profile_a': b(10), 'profile_b': b(21), 'operation': 'cut'})   # карман
    d = call('bevel_edges', {'points': [[5, 5, 15]], 'size': 2, 'segments': 8})
    closed(d, 'pocket corner cove')
    near(d['volume_change_mm3'], (4 - 0.5 * 4 * 8 * math.sin(math.pi / 16)) * 10, 0.05, 'pocket cove volume')
    assert d['bbox_max'][2] == 20, ('the cove must not stick out of the pocket', d)
    # ребро дна упирается не в стенку, а в выкружку угла: выкружка дна
    # всё равно идёт до самой стенки (раньше обрывалась на конце ребра —
    # угол оставался веером с дырой). Ребро дна — 8 мм (угол занят
    # выкружкой R2): без продления добавка 0.2196·4·8 ≈ 7.03 мм³
    d = call('bevel_edges', {'points': [[10, 5, 10]], 'size': 2, 'segments': 8})
    closed(d, 'floor cove into the corner cove')
    assert d['volume_change_mm3'] > 7.5, ('the floor cove must reach the wall through the corner cove', d)
    # Наружное ребро стойки упирается в пол: вырез кончается ровно в полу.
    # Раньше заходил в него на 0.02 мм — в полу у основания скругления
    # оставалась канавка (тонкий прямоугольник). Объём — ровно сечение × длина
    call('new_shape', {'shape': 'cube', 'size': 20})
    b = lambda z: [[10, -1, z], [21, -1, z], [21, 21, z], [10, 21, z]]
    call('loft_profiles', {'profile_a': b(10), 'profile_b': b(21), 'operation': 'cut'})
    d = call('bevel_edges', {'points': [[10, 0, 15]], 'size': 2, 'segments': 8})
    closed(d, 'post on a floor')
    near(d['volume_change_mm3'], -(4 - 0.5 * 4 * 8 * math.sin(math.pi / 16)) * 10, 0.02, 'no groove in the floor')
    assert d['bbox_min'][2] == 0 and d['folded_edges'] == 0, d
    # Косой торец: нижняя ступень срезана наискось у конца ребра (крышка
    # коробки с косым краем). Выкружка не должна торчать за косую грань —
    # раньше торчала, с плёнкой 0.05 мм поверх, и срез E+Ctrl по плёнке рвал
    # сетку. Срез той же плоскостью после скругления ничего не снимает
    call('new_shape', {'shape': 'cube', 'size': 20})
    b = lambda z: [[10, -1, z], [21, -1, z], [21, 21, z], [10, 21, z]]
    call('loft_profiles', {'profile_a': b(10), 'profile_b': b(21), 'operation': 'cut'})
    nn = [26 / math.hypot(26, 63), 63 / math.hypot(26, 63), 0]
    call('cut_plane', {'point': [10, 20, 5], 'normal': nn})
    d = call('bevel_edges', {'points': [[10, 10, 10]], 'size': 2, 'segments': 8})
    closed(d, 'cove at a slanted end')
    v = d['volume_mm3']
    try:
        d = call('cut_plane', {'point': [10, 20, 5], 'normal': nn})
        assert v - d['volume_mm3'] < 0.01, ('the cove must not stick out past the slanted end face', v, d['volume_mm3'])
    except McpError as e:
        assert 'does not cut' in str(e), e   # плоскость ничего не срезает — так и надо


@case
def ball_corner_at_a_vertex():
    # Три ребра в вершине под 90° — угол шариком (rolling ball во Fusion):
    # кусок шара радиуса size, а не стык трёх цилиндров со складкой.
    # Наружный угол срезается, внутренний (три вогнутых ребра) получает тело
    import math
    seg = lambda r: r * r - 0.5 * r * r * 8 * math.sin(math.pi / 16)   # сечение скругления из 8 хорд
    call('new_shape', {'shape': 'cube', 'size': 20})
    d = call('bevel_edges', {'vertices': [[20, 20, 20]], 'size': 4, 'segments': 8})
    closed(d, 'outer ball corner')
    assert d['ball_corners'] == 1 and len(d['edges']) == 3, d
    assert d['folded_edges'] == 0, ('no crease at the corner', d)
    want = -(3 * seg(4) * 16 + 64 - math.pi * 64 / 6)
    near(d['volume_change_mm3'], want, abs(want) * 0.02, 'outer corner volume')
    # внутренний угол кармана: дно и две стенки
    call('new_shape', {'shape': 'cube', 'size': 20})
    b = lambda z: [[5, 5, z], [15, 5, z], [15, 15, z], [5, 15, z]]
    call('loft_profiles', {'profile_a': b(10), 'profile_b': b(21), 'operation': 'cut'})
    d = call('bevel_edges', {'vertices': [[5, 5, 10]], 'size': 2, 'segments': 8})
    closed(d, 'inner ball corner')
    assert d['ball_corners'] == 1, d
    want = 3 * seg(2) * 8 + 8 - math.pi * 8 / 6
    near(d['volume_change_mm3'], want, want * 0.03, 'inner corner volume')
    assert d['bbox_max'][2] == 20, ('nothing sticks out of the pocket', d)
    # стакан: четыре угла дна разом — дно и стойки скругляются, углы шарами.
    # По одному нельзя: первый шарик скругляет ребро дна целиком, и у
    # соседнего угла уже нет трёх острых рёбер
    call('new_shape', {'shape': 'cube', 'size': 20})
    call('loft_profiles', {'profile_a': b(10), 'profile_b': b(21), 'operation': 'cut'})
    d = call('bevel_edges', {'vertices': [[5, 5, 10], [15, 5, 10], [15, 15, 10], [5, 15, 10]], 'size': 2, 'segments': 8})
    closed(d, 'cup bottom')
    assert d['ball_corners'] == 4 and len(d['edges']) == 8, d
    assert d['folded_edges'] == 0, d
    want = seg(2) * (4 * 6 + 4 * 8) + 4 * (8 - math.pi * 8 / 6)
    near(d['volume_change_mm3'], want, want * 0.03, 'cup bottom volume')


@case
def paint_faces_for_multicolour():
    # покраска граней филаментом: в 3MF — paint_color (Bambu/Orca) и
    # slic3rpe:mmu_segmentation (Prusa) у каждого треугольника грани;
    # покраска идёт за гранью при выдавливании и при повороте на стол
    import zipfile, re
    call('new_shape', {'shape': 'cube', 'size': 20})
    assert call('get_paints', {})['paints'] == [], 'a new model starts unpainted'
    d = call('paint_face', {'point': [10, 10, 20], 'normal': [0, 0, 1], 'filament': 2})
    assert d['faces'][0]['triangles'] >= 2 and len(d['paints']) == 1, d
    d = call('paint_face', {'point': [0, 10, 10], 'normal': [-1, 0, 0], 'filament': 3})
    def painted():
        path = call('export_3mf', {'name': 'zc_paint_test'})['path']
        with zipfile.ZipFile(path) as z:
            xml = z.read('3D/3dmodel.model').decode()
        return (re.findall(r'paint_color="([0-9A-F]+)"', xml), xml.count('slic3rpe:mmu_segmentation="'))
    codes, prusa = painted()
    assert sorted(set(codes)) == ['0C', '8'] and codes.count('8') >= 2 and prusa == len(codes), (codes, prusa)
    # грань выдавили — покраска осталась на ней
    call('extrude_face', {'point': [10, 10, 20], 'normal': [0, 0, 1], 'distance': 5})
    ps = call('get_paints', {})['paints']
    assert not any(p['lost'] for p in ps), ps
    assert painted()[0].count('8') >= 2
    # модель на бок — покраска поворачивается вместе с ней
    call('lay_flat', {'point': [0, 10, 10], 'normal': [-1, 0, 0]})
    ps = call('get_paints', {})['paints']
    assert not any(p['lost'] for p in ps), ps
    # филамент 1 снимает покраску
    d = call('paint_face', {'point': [10, 10, 0.0], 'normal': [0, 0, -1], 'filament': 1})
    assert len(d['paints']) == 1 and d['paints'][0]['filament'] == 2, d


@case
def paint_a_whole_fillet():
    # клик по одной полосе скругления красит всё скругление: выкружки дна,
    # стойки и шары в углах стакана — но не стенки и не дно (они касаются
    # скругления только по линии)
    import zipfile, re
    call('new_shape', {'shape': 'cube', 'size': 20})
    b = lambda z: [[5, 5, z], [15, 5, z], [15, 15, z], [5, 15, z]]
    call('loft_profiles', {'profile_a': b(10), 'profile_b': b(21), 'operation': 'cut'})
    call('bevel_edges', {'vertices': [[5, 5, 10], [15, 5, 10], [15, 15, 10], [5, 15, 10]], 'size': 3, 'segments': 8})
    # точка на середине дуги выкружки дна у стенки y=5 (центр дуги: y=8, z=13)
    a = math.pi / 4
    d = call('paint_face', {'point': [10, 8 - 3 * math.cos(a), 13 - 3 * math.sin(a)], 'filament': 2})
    n = d['faces'][0]['triangles']
    path = call('export_3mf', {'name': 'zc_paint_fillet'})['path']
    with zipfile.ZipFile(path) as z:
        xml = z.read('3D/3dmodel.model').decode()
    V = [tuple(float(x) for x in m) for m in re.findall(r'<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"', xml)]
    painted = [tuple(int(i) for i in m) for m in re.findall(r'<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)" paint_color', xml)]
    assert len(painted) == n and n > 100, (n, len(painted))
    flat = [t for t in painted for ax, val in ((0, 5), (0, 15), (1, 5), (1, 15), (2, 10))
            if all(abs(V[i][ax] - val) < 1e-3 for i in t)]
    assert not flat, ('walls and the floor must stay unpainted', flat[:3])
    zs = [V[i][2] for t in painted for i in t]
    assert max(zs) > 19.9, 'the vertical coves go up to the top'


@case
def post_corner_gets_a_torus():
    # Стойка на полу: наружное ребро вверх, внутренние — по полу вдоль её
    # стенок. Ctrl+B по нижней точке ребра: торец скруглён, выкружки пола
    # огибают его куском тора (раньше обрывались, оставляя щель). Объём:
    # −срез ребра стойки (15 мм) + две выкружки по 8 мм + четверть тора
    call('new_shape', {'shape': 'cube', 'size': 20})
    call('loft_profiles', {'profile_a': [[10, -1, 5], [21, -1, 5], [21, 21, 5], [10, 21, 5]],
                           'profile_b': [[10, -1, 21], [21, -1, 21], [21, 21, 21], [10, 21, 21]], 'operation': 'cut'})
    call('loft_profiles', {'profile_a': [[-1, 10, 5], [10, 10, 5], [10, 21, 5], [-1, 21, 5]],
                           'profile_b': [[-1, 10, 21], [10, 10, 21], [10, 21, 21], [-1, 21, 21]], 'operation': 'cut'})
    d = call('bevel_edges', {'vertices': [[10, 10, 5]], 'size': 2, 'segments': 8})
    closed(d, 'post corner')
    assert len(d['edges']) == 3, d
    seg = 4 - 0.5 * 4 * 8 * math.sin(math.pi / 16)
    torus = (math.pi / 2) * seg * (2 + 2 * (10 - 3 * math.pi) / (3 * (4 - math.pi)))
    near(d['volume_change_mm3'], -seg * 15 + 2 * seg * 8 + torus, 0.3, 'post corner volume')


@case
def corner_rounds_the_whole_edge():
    # Ребро пола разрезано вершиной (линия по дну от стенки до стенки):
    # скругление угла брало кусок до этой вершины — из углов торчали
    # «корешки». Теперь куски по прямой между теми же гранями склеены —
    # объём как у стакана без линии
    seg = lambda r: r * r - 0.5 * r * r * 8 * math.sin(math.pi / 16)
    call('new_shape', {'shape': 'cube', 'size': 20})
    b = lambda z: [[5, 5, z], [15, 5, z], [15, 15, z], [5, 15, z]]
    call('loft_profiles', {'profile_a': b(10), 'profile_b': b(21), 'operation': 'cut'})
    call('draw_line', {'from': [10, 5, 10], 'to': [10, 15, 10]})
    d = call('bevel_edges', {'vertices': [[5, 5, 10], [15, 5, 10], [15, 15, 10], [5, 15, 10]], 'size': 2, 'segments': 8})
    closed(d, 'cup with a line on the floor')
    assert len(d['edges']) == 8 and all(e['edge_length_mm'] in (10, 10.0) for e in d['edges'][:4] if e['edge_length_mm'] < 11), d['edges']
    want = seg(2) * (4 * 6 + 4 * 8) + 4 * (8 - math.pi * 8 / 6)
    near(d['volume_change_mm3'], want, want * 0.03, 'whole floor edges rounded')


@case
def bevel_suggests_a_working_size():
    # слишком большое скругление: Ctrl+B не принимает его, а агенту называет
    # самый большой рабочий размер (стакан 10 мм: шарики с двух концов ребра
    # дна съедают по size — больше 5 мм не помещается)
    import re
    call('new_shape', {'shape': 'cube', 'size': 20})
    b = lambda z: [[5, 5, z], [15, 5, z], [15, 15, z], [5, 15, z]]
    call('loft_profiles', {'profile_a': b(10), 'profile_b': b(21), 'operation': 'cut'})
    v0 = call('get_state', {})['volume_mm3']
    try:
        call('bevel_edges', {'vertices': [[5, 5, 10], [15, 5, 10], [15, 15, 10], [5, 15, 10]], 'size': 9, 'segments': 4})
        raise AssertionError('size 9 must not fit a 10 mm pocket')
    except McpError as e:
        m = re.search(r'largest working size for these edges is ([0-9.]+) mm', str(e))
        assert m and 0 < float(m.group(1)) <= 5, e
        best = float(m.group(1))
    assert abs(call('get_state', {})['volume_mm3'] - v0) < 1e-6, 'the model is untouched'
    d = call('bevel_edges', {'vertices': [[5, 5, 10], [15, 5, 10], [15, 15, 10], [5, 15, 10]], 'size': best, 'segments': 4})
    closed(d, 'suggested size works')


def painted_codes(name):
    import zipfile, re
    path = call('export_3mf', {'name': name})['path']
    with zipfile.ZipFile(path) as z:
        return re.findall(r'paint_color="([0-9A-F]+)"', z.read('3D/3dmodel.model').decode())


@case
def paint_follows_body_transforms():
    # перенос, поворот, зеркало тела (G,B, G,I) несут покраску с собой;
    # раньше точка грани оставалась на старом месте и покраска терялась
    call('new_shape', {'shape': 'cube', 'size': 20})
    call('paint_face', {'point': [10, 10, 20], 'normal': [0, 0, 1], 'filament': 2})
    call('paint_face', {'point': [20, 10, 10], 'normal': [1, 0, 0], 'filament': 3})
    n0 = len(painted_codes('zc_paint_xf0'))
    call('transform_body', {'move': [30, 0, 0]})
    ps = call('get_paints', {})['paints']
    assert len(ps) == 2 and not any(p['lost'] for p in ps), ps
    assert len(painted_codes('zc_paint_xf1')) == n0
    call('transform_body', {'rotate': {'axis': [0, 0, 1], 'angle': 90}})
    ps = call('get_paints', {})['paints']
    assert not any(p['lost'] for p in ps), ps
    assert len(painted_codes('zc_paint_xf2')) == n0
    # зеркальная копия рядом: покраска у обеих
    d = call('get_state', {})
    call('mirror_body', {'plane_point': [d['bbox_min'][0] - 5, 0, 0], 'plane_normal': [1, 0, 0], 'mode': 'join'})
    ps = call('get_paints', {})['paints']
    assert len(ps) == 4 and not any(p['lost'] for p in ps), ps
    assert len(painted_codes('zc_paint_xf3')) == 2 * n0


@case
def paint_an_old_fillet():
    # скругление из старой модели (поверхности не записаны): узнаётся по
    # жёстким линиям полос — красится целиком, как новое
    import json
    call('new_shape', {'shape': 'cube', 'size': 20})
    b = lambda z: [[5, 5, z], [15, 5, z], [15, 15, z], [5, 15, z]]
    call('loft_profiles', {'profile_a': b(10), 'profile_b': b(21), 'operation': 'cut'})
    call('bevel_edges', {'vertices': [[5, 5, 10], [15, 5, 10], [15, 15, 10], [5, 15, 10]], 'size': 3, 'segments': 8})
    a = math.pi / 4
    P = [10, 8 - 3 * math.cos(a), 13 - 3 * math.sin(a)]
    n_new = call('paint_face', {'point': P, 'filament': 2})['faces'][0]['triangles']
    path = call('save_file', {'name': 'zc_old_fillet', 'format': 'zcad'})['path']
    d = json.load(open(path, encoding='utf-8'))
    d.pop('surfs', None); d['paints'] = []; d['history'] = None
    old = path.replace('zc_old_fillet', 'zc_old_fillet_nosurfs')
    json.dump(d, open(old, 'w', encoding='utf-8'))
    CREATED.add(old)
    # обе — на сетке, открытой из файла (открытие подчищает сетку)
    call('open_project', {'path': path})
    n_new = call('paint_face', {'point': P, 'filament': 2})['faces'][0]['triangles']
    call('open_project', {'path': old})
    n_old = call('paint_face', {'point': P, 'filament': 2})['faces'][0]['triangles']
    assert n_old == n_new and n_old > 100, (n_old, n_new)


@case
def lay_flat_on_a_face():
    # K по грани (Lay on Face): модель ложится этой гранью на стол. Плита
    # 20 x 20 x 10 гранью y=0 вниз: высота становится 20, глубина 10, низ на z=0
    call('new_shape', {'shape': 'cube', 'size': 20})
    call('cut_plane', {'point': [0, 0, 10], 'normal': [0, 0, 1]})
    d = call('lay_flat', {'point': [10, 0, 5], 'normal': [0, -1, 0]})
    closed(d, 'laid flat')
    near(d['volume_mm3'], 4000, 0.01, 'volume')
    size = [d['bbox_max'][i] - d['bbox_min'][i] for i in range(3)]
    near(size[2], 20, 1e-3, 'height is the old Y'); near(size[1], 10, 1e-3, 'depth is the old Z')
    near(d['bbox_min'][2], 0, 1e-4, 'on the bed')
    try:
        mid = [(d['bbox_min'][i] + d['bbox_max'][i]) / 2 for i in range(2)]
        call('lay_flat', {'point': [mid[0], mid[1], 0], 'normal': [0, 0, -1]})
        raise AssertionError('the bottom face already lies on the bed')
    except McpError as e:
        assert 'already' in str(e), e


@case
def extrude_against_a_wall_merges():
    # Полоса у стены поднята выдавкой: бок призмы встаёт вплотную к стенке.
    # Быстрый путь «сдвиг грани» оставлял между ними двойную внутреннюю
    # грань (объём сходился!), и следующий выбор торца уходил за стенку,
    # а выдавка рвала сетку (60 дыр). Теперь это союз — тела сливаются
    call('new_shape', {'shape': 'cube', 'size': 20})
    call('cut_plane', {'point': [0, 0, 10], 'normal': [0, 0, 1]})
    r = lambda z: [[0, 18, z], [20, 18, z], [20, 20, z], [0, 20, z]]
    call('loft_profiles', {'profile_a': r(9.8), 'profile_b': r(15), 'operation': 'join'})   # бортик
    call('draw_line', {'from': [20, 18, 10], 'to': [17.8, 18, 10]})
    call('draw_line', {'from': [17.8, 18, 10], 'to': [17.8, 0, 10]})
    d = call('extrude_face', {'point': [19, 9, 10], 'normal': [0, 0, 1], 'distance': 8})
    closed(d, 'wall'); near(d['volume_change_mm3'], 2.2 * 18 * 8, 0.05, 'wall volume')
    assert d['folded_edges'] == 0, ('no double face against the rim', d)
    # торец стены над бортиком — только видимая часть 2.2 x 3, не до плиты
    d = call('extrude_face', {'point': [19, 18, 16.5], 'normal': [0, 1, 0], 'distance': 2})
    near(d['face_area_mm2'], 2.2 * 3, 0.01, 'only the visible end face')
    closed(d, 'end pushed'); near(d['volume_change_mm3'], 2.2 * 3 * 2, 0.05, 'end volume')


@case
def kept_measurements_by_colour():
    # замеры, оставленные на модели (рулетка + Alt): цвета по кругу, первый
    # свободный; читаются агентом, живут в проекте и не попадают в историю
    call('new_shape', {'shape': 'cube', 'size': 20})
    call('clear_measurements', {})
    h0 = len(call('get_history', {})['steps'])
    m1 = call('add_measurement', {'a': [0, 0, 20], 'b': [20, 0, 20]})
    m2 = call('add_measurement', {'a': [0, 0, 0], 'b': [0, 0, 6.65]})
    assert (m1['color'], m2['color']) == ('yellow', 'red'), (m1, m2)
    assert m2['color_ru'] == 'красный', m2
    near(m2['distance'], 6.65, 1e-6, 'distance')
    ms = call('get_measurements', {})['measurements']
    assert [m['color'] for m in ms] == ['yellow', 'red'], ms
    near(ms[0]['dx'], 20, 1e-6, 'dx')
    assert len(call('get_history', {})['steps']) == h0, 'measurements are not history steps'
    # убрали жёлтый — следующий замер снова жёлтый (первый свободный цвет)
    assert call('clear_measurements', {'which': 'жёлтый'})['removed'] == 1
    assert call('add_measurement', {'a': [0, 0, 0], 'b': [1, 0, 0]})['color'] == 'yellow'
    assert call('clear_measurements', {})['left'] == 0


@case
def symbol_pattern_and_relief_tilt():
    # Узор из любого знака библиотеки (kind symbol) и клин сот одного наклона
    # (honeycomb_relief, tilt down: ноль сверху, полная высота снизу)
    call('new_shape', {'shape': 'cube', 'size': 60})
    d = call('add_pattern', {'kind': 'symbol', 'symbol': 'spiral', 'center': [30, 30, 60], 'normal': [0, 0, 1],
                             'length': 40, 'height': 20, 'cell': 9, 'line': 0.8, 'depth': 0.6})
    unfolded(d, 'spiral pattern'); assert d['volume_change_mm3'] > 20, d
    d = call('add_text', {'text': '{SPIRAL}', 'center': [30, 0, 30], 'normal': [0, -1, 0], 'height': 14, 'depth': -0.5})
    unfolded(d, 'spiral symbol in text'); assert d['symbols'] == ['spiral'], d
    # знак-силуэт (рисованный вихрь из SVG): в узоре и в тексте
    d = call('add_pattern', {'kind': 'symbol', 'symbol': 'swirl', 'spin': 'random', 'center': [30, 30, 60], 'normal': [0, 0, 1],
                             'length': 30, 'height': 12, 'cell': 9, 'line': 0.8, 'depth': -0.4})
    unfolded(d, 'swirl pattern'); assert d['volume_change_mm3'] < -5, d
    d = call('add_text', {'text': 'A{swirl}', 'center': [60, 30, 30], 'normal': [1, 0, 0], 'height': 12, 'depth': 0.5})
    unfolded(d, 'swirl in text'); assert d['symbols'] == ['swirl'], d
    call('new_shape', {'shape': 'cube', 'size': 60})
    d = call('add_pattern', {'kind': 'honeycomb_relief', 'tilt': 'down', 'center': [30, 0, 30], 'normal': [0, -1, 0],
                             'length': 44, 'height': 11.5, 'cell': 8, 'line': 2, 'depth': 3})
    unfolded(d, 'tilted wedges')
    # клин: высота растёт от 0 до 3 — объём меньше призм высотой 3
    assert 0 < d['volume_change_mm3'] < 5 * 6 * 7 * 3, d
    for args, msg in [({'kind': 'symbol', 'symbol': 'dragon'}, 'symbol must be'), ({'kind': 'honeycomb', 'tilt': 'down'}, 'tilt works with')]:
        a = {'center': [30, 30, 60], 'normal': [0, 0, 1], 'length': 40, 'height': 20, 'cell': 9, 'line': 0.8, 'depth': 0.6}
        a.update(args)
        try:
            call('add_pattern', a)
        except McpError as e:
            assert msg in str(e), str(e)
        else:
            raise AssertionError('must be refused: %r' % args)


@case
def triskele_rows_raised_and_engraved():
    # Трискель: три спиральных рукава из общего центра, фигуры рядами
    # вверх-вниз, ряд через один сдвинут на полшага. Тело узора чистое:
    # почти касающиеся витки не дают ни защемлённых точек (немногообразных
    # рёбер у вдавленного), ни щелей мельче клетки (загибов)
    call('new_shape', {'shape': 'cube', 'size': 60})
    d = call('add_pattern', {'kind': 'triskele', 'center': [30, 30, 60], 'normal': [0, 0, 1], 'length': 50, 'height': 30,
                             'cell': 12, 'line': 0.8, 'depth': 0.6})
    unfolded(d, 'raised triskele'); assert d['volume_change_mm3'] > 50, d
    d = call('add_pattern', {'kind': 'triskele', 'center': [30, 0, 30], 'normal': [0, -1, 0], 'length': 50, 'height': 30,
                             'cell': 12, 'line': 0.8, 'depth': -0.5, 'turns': 2})
    unfolded(d, 'engraved triskele'); assert d['volume_change_mm3'] < -50, d
    try:
        call('add_pattern', {'kind': 'triskele', 'center': [30, 30, 60], 'normal': [0, 0, 1], 'length': 50, 'height': 30,
                             'cell': 12, 'line': 0.8, 'depth': 0.6, 'turns': 9})
    except McpError as e:
        assert 'turns' in str(e), str(e)
    else:
        raise AssertionError('turns 9 must be refused')


@case
def knurl_straight_diamond_cross():
    # Накатка (рифление, насечка): площадка, рисунок которой — в высоте верха.
    # straight — рёбра вдоль оси цилиндра (средняя высота depth/2), diamond —
    # ромбы-пирамидки между канавками под ±angle к оси, cross — квадратные
    # (у пирамидок средняя высота depth/3: объём меньше, чем у рёбер)
    w = {'axis_point': [40, 40, 0]}
    vol = {}
    for style, extra in [('straight', {}), ('straight', {'angle': 90}), ('straight', {'angle': 45}),
                         ('diamond', {'angle': 30}), ('diamond', {'angle': 45}), ('cross', {})]:
        call('new_shape', {'shape': 'cylinder', 'size': 80, 'height': 40})
        call('shell_body', {'thickness': 3, 'open_faces': [{'point': [40, 40, 40]}]})
        a = {'kind': 'knurl', 'style': style, 'center': [77, 40, 20], 'normal': [-1, 0, 0], 'length': 12, 'height': 8,
             'cell': 1.5, 'depth': 0.6, 'wrap': w}
        a.update(extra)
        d = call('add_pattern', a)
        unfolded(d, 'knurl ' + style)
        assert d['style'] == style, d
        vol[style + str(extra.get('angle', ''))] = d['volume_change_mm3']
    flat = 12 * 8 * 0.6
    for k in ['straight', 'straight90', 'straight45']:
        near(vol[k], flat / 2, flat * 0.12, k + ' ribs: half the pad (any tilt)')
    for k in ['diamond30', 'diamond45', 'cross']:
        near(vol[k], flat / 3, flat * 0.12, k + ': pyramids, a third of the pad')
    for args, msg in [({'depth': -0.5}, 'raised only'), ({'style': 'wavy'}, 'knurl style'), ({'angle': 80}, 'knurl angle')]:
        a = {'kind': 'knurl', 'center': [77, 40, 20], 'normal': [-1, 0, 0], 'length': 12, 'height': 8,
             'cell': 1.5, 'depth': 0.6, 'wrap': w}
        a.update(args)
        try:
            call('add_pattern', a)
        except McpError as e:
            assert msg in str(e), str(e)
        else:
            raise AssertionError('must be refused: %r' % args)


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
            assert d.get('boolean') in ('exact', 'manifold'), f'groove {n}: wedge not cut exactly'
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


@case
def draw_curve_and_name_a_part():
    # перо (G,P) тем же ядром: гладкая кривая режется на хорды по допуску
    call('new_shape', {'shape': 'cube', 'size': 40})
    a = call('draw_curve', {'points': [[5, 5, 40], [20, 35, 40], [35, 5, 40]], 'tolerance': 0.4})
    assert a['segments'] > 8, a
    call('undo', {})
    b = call('draw_curve', {'points': [[5, 5, 40], [20, 35, 40], [35, 5, 40]], 'tolerance': 0.02})
    assert b['segments'] > a['segments'] * 2, (a, b)
    closed = call('draw_curve', {'points': [[-60, -60, 0], [60, -60, 0], [60, 60, 0], [-60, 60, 0]],
                                 'closed': True, 'on_face': False})
    assert closed['segments'] > 40, closed
    # имя детали ставится по точке в середине грани, а не только у вершины
    d = call('name_part', {'name': 'body-main', 'point': [20, 20, 40]})
    assert d['glb_nodes'] == ['body-main'], d
    call('name_part', {'name': 'hotspot-engine', 'point': [20, 20, 25]})
    g = call('export_glb', {'name': 'zerocad_test_curve'})
    assert g['parts'] == ['body-main'] and g['hotspots'] == ['hotspot-engine'], g
    try:
        call('name_part', {'name': 'hood', 'point': [500, 500, 500]})
        raise AssertionError('a point far from the body must be refused')
    except McpError as e:
        assert 'within 20 mm' in str(e), e


@case
def extrude_leaves_no_slivers():
    # выдавливание шло мимо чистки игл: на шестерне пользователя их накопилось
    # 188, и их края рисовались лишними рёбрами
    before = call('new_shape', {'shape': 'gear', 'size': 120})
    top = before['bbox_max'][2]
    p = [36, 0, top]          # на верхней грани, в стороне от отверстия вала
    d = call('extrude_face', {'point': p, 'distance': -3})
    closed(d, 'extrude pocket')
    assert d['slivers'] <= before['slivers'], ('extrude added slivers', before, d)
    e = call('extrude_face', {'point': [p[0], p[1], top - 3], 'distance': 2})
    closed(e, 'extrude back')
    assert e['slivers'] <= before['slivers'], ('extrude added slivers', before, e)


@case
def bend_a_line_into_an_arc():
    # то же ядро, что у Alt+перетаскивания точки на линии
    call('new_shape', {'shape': 'cube', 'size': 100})
    call('draw_line', {'from': [20, 50, 100], 'to': [80, 50, 100]})
    d = call('bend_line', {'point': [50, 50, 100], 'through': [50, 75, 100]})
    # хорда 60, стрелка 25 -> R = (60^2/4 + 25^2) / (2*25)
    near(d['radius_mm'], (3600/4 + 625) / 50, 0.5, 'arc radius')
    assert d['chords'] > 8, d
    assert d['lines'] == d['chords'], ('the line became the arc', d)
    closed(d, 'after bending')
    try:
        call('bend_line', {'point': [50, 10, 100], 'through': [50, 20, 100]})
        raise AssertionError('a point with no line under it must be refused')
    except McpError as e:
        assert 'no drawn line' in str(e), e


@case
def long_text_keeps_the_mesh_clean():
    # Врезка контура букв резала грань сотнями хорд: на «CLIFFORDS BAR»
    # оставалось 12 открытых рёбер, 433 немногообразных и 7921 щепка.
    # Теперь после врезки идёт тот же ремонт, что у гравировки, и чистка
    for depth, what in [(0, 'outline'), (0.2, 'raised'), (-0.5, 'engraved')]:
        call('new_shape', {'shape': 'cube', 'size': 20})
        call('sweep_profile', {'profile': [[0, 0, 0], [213, 0, 0], [213, 23, 0], [0, 23, 0]],
                               'path': [[0, 0, 0], [0, 0, 5]], 'operation': 'new'})
        d = call('add_text', {'center': [106.5, 11.5, 5], 'normal': [0, 0, 1],
                              'text': 'CLIFFORDS BAR', 'height': 19, 'depth': depth})
        closed(d, 'text ' + what)
        assert d['slivers'] < 300, (what, d['slivers'])
        # объём: контур ничего не добавляет, буквы дают свой слой
        if depth == 0:
            near(d['volume_mm3'], 213 * 23 * 5, 1.5, 'outline keeps the volume')


@case
def text_on_a_rounded_plate_is_cleaned_too():
    # Та же надпись на плитке со СКРУГЛЁННЫМИ углами оставляла 14288 щепок:
    # чистку откатывал допуск по объёму (честные 0.34 мм³ на детали в 5188),
    # и одного прохода всё равно не хватало — щепки стоят цепочками
    import math

    def rounded(cx, cy, w, h, r, n=10):
        pts = []
        x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2
        for ccx, ccy, a0 in [(x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90),
                             (x0 + r, y0 + r, 180), (x1 - r, y0 + r, 270)]:
            for i in range(n + 1):
                a = math.radians(a0 + 90 * i / n)
                pts.append([round(ccx + r * math.cos(a), 3),
                            round(ccy + r * math.sin(a), 3), 0.0])
        out = [pts[0]]
        for q in pts[1:]:
            if abs(q[0] - out[-1][0]) > 1e-6 or abs(q[1] - out[-1][1]) > 1e-6:
                out.append(q)
        return out

    for thick in (0.8, 5.0):
        call('new_shape', {'shape': 'cube', 'size': 20})
        call('sweep_profile', {'profile': rounded(106.5, 11.5, 213, 23, 4),
                               'path': [[0, 0, 0], [0, 0, thick]], 'operation': 'new'})
        d = call('add_text', {'center': [106.5, 11.5, thick], 'normal': [0, 0, 1],
                              'text': 'CLIFFORDS BAR', 'height': 19, 'depth': 0.4})
        closed(d, 'rounded plate %g' % thick)
        assert d['slivers'] < 100, (thick, d['slivers'])
        assert d['triangles'] < 15000, (thick, d['triangles'])


@case
def export_glb_for_three_js():
    # GLB: метры вместо миллиметров, Y вверх; имена узлов — контракт с IEGarage
    call('new_shape', {'shape': 'cube', 'size': 400})
    d = call('export_glb', {'name': 'zerocad_test_glb'})
    assert d['path'].endswith('zerocad_test_glb.glb'), d
    assert d['parts'] == ['body-main'], d
    assert 20 < d['bytes'] < 200000, d


@case
def export_3mf_and_open_it_back():
    # свой 3MF несёт проект: после импорта на месте и сетка, и нарисованная линия
    call('new_shape', {'shape': 'cube', 'size': 20})
    call('draw_line', {'from': [0, 10, 20], 'to': [20, 10, 20]})
    d = call('export_3mf', {'name': 'zerocad_test_3mf'})
    assert d.get('printable') is True, d
    assert d['path'].endswith('zerocad_test_3mf.3mf'), d
    call('new_shape', {'shape': 'sphere', 'size': 30})
    d = call('import_3mf', {'path': 'zerocad_test_3mf.3mf'})
    assert d['opened'] == 'project', d
    assert d['lines'] == 1, d
    near(d['volume_mm3'], 8000, 0.01, '3mf volume'); closed(d, '3mf')
    try:
        call('import_3mf', {'path': 'no_such_file.3mf'})
        raise AssertionError('a missing file must be refused')
    except McpError as e:
        assert 'cannot read' in str(e), e


def main():
    global URL
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--url', default=URL, help='MCP endpoint, default ' + URL)
    ap.add_argument('--yes', action='store_true', help='confirm that the model in the open tab may be replaced')
    ap.add_argument('-k', default='', help='run only tests whose name contains this text')
    ap.add_argument('--allow-main', action='store_true',
                    help='run against a normal (non-test) server — replaces the shared session model of the user')
    a = ap.parse_args()
    URL = a.url
    if not a.yes:
        print('These tests replace the model in the open ZeroCAD tab. Re-run with --yes.')
        return 2
    # тесты — только на тестовом сервере (ZEROCAD_TEST=1): у основного общий
    # сеанс пользователя, и тесты заменяли его модель тестовым кубом
    base = URL.rsplit('/mcp', 1)[0]
    try:
        role = urllib.request.urlopen(base + '/api/role', timeout=10).read().decode().strip()
    except Exception:
        role = 'main'   # старый сервер без /api/role — считаем основным
    if role != 'test' and not a.allow_main:
        print(f'{base} is not a test server (role: {role}). Start one with ZEROCAD_TEST=1 on its own port, '
              f'open its page in a browser tab and pass --url; --allow-main skips this check.')
        return 2
    try:
        call('get_state')
    except Exception as e:
        print(f'Cannot reach an editor tab through {URL}: {e}')
        return 2
    failed = 0
    try:
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
    finally:
        cleanup_exports()
    print('all passed' if not failed else f'{failed} failed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
