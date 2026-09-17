#!/usr/bin/env python3
"""Тесты моста агент↔вкладка — без браузера: вкладки здесь поддельные.

Проверяется то, что руками не поймать: кому уходит команда, когда вкладок
несколько, и что делает мост, пока вкладка считает.

    python tests/mcp/bridge.py                 # поднимет свой сервер на :9007
    python tests/mcp/bridge.py --url http://127.0.0.1:9001/mcp

Только стандартная библиотека. Код выхода 0 — всё прошло.
"""
import argparse, json, os, random, subprocess, sys, threading, time, urllib.request


class Tab:
    """Поддельная вкладка: SSE-подписка + ответы на команды."""

    def __init__(self, base, answer=True):
        self.base, self.answer = base, answer
        self.id = random.randrange(1, 10 ** 15)
        self.got = []                      # команды, дошедшие до этой вкладки
        self.ready = threading.Event()
        self._stop = False
        self.t = threading.Thread(target=self._run, daemon=True)
        self.t.start()
        if not self.ready.wait(5):
            raise RuntimeError('вкладка не подписалась на /agent/events')

    def _post(self, path, obj):
        req = urllib.request.Request(self.base + path, json.dumps(obj).encode(),
                                     {'Content-Type': 'application/json'})
        urllib.request.urlopen(req, timeout=10).read()

    def _run(self):
        r = urllib.request.urlopen(self.base + '/agent/events?tab=%d' % self.id, timeout=60)
        self._post('/agent/hello', {'build': 'fake', 'tools': [], 'tab': self.id})
        self.ready.set()
        event = None
        for raw in r:
            if self._stop:
                return
            line = raw.decode('utf-8').rstrip('\n')
            if line.startswith('event: '):
                event = line[7:]
            elif line.startswith('data: ') and event == 'command':
                msg = json.loads(line[6:])
                self.got.append(msg)
                if self.answer:
                    self._post('/agent/result', {'id': msg['id'], 'ok': True,
                                                 'result': {'tab': self.id}})
                event = None

    def lead(self):
        """Вкладка получила фокус — просит команды себе."""
        self._post('/agent/lead', {'tab': self.id})
        time.sleep(0.2)

    def stop(self):
        self._stop = True


def call(url, tool, args=None, timeout=200):
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": tool, "arguments": args or {}}}
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=timeout))
    res = r['result']
    return res.get('isError', False), res['content'][0].get('text', '')


def rpc(url, method, params=None):
    body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=30))


TESTS = []


def case(fn):
    TESTS.append(fn)
    return fn


@case
def one_tab_gets_the_command(url, base):
    """Команда уходит ОДНОЙ вкладке — ведущей, а не всем сразу."""
    a, b = Tab(base), Tab(base)          # b открыта последней → ведущая
    try:
        err, _ = call(url, 'get_state')
        assert not err, 'команда не дошла'
        assert len(b.got) == 1, f'ведущая вкладка получила {len(b.got)} команд'
        assert len(a.got) == 0, f'вторая вкладка тоже выполнила команду ({len(a.got)})'
    finally:
        a.stop(); b.stop()


@case
def focus_moves_the_lead(url, base):
    """Вкладка, получившая фокус, забирает команды себе."""
    a, b = Tab(base), Tab(base)
    try:
        call(url, 'get_state')           # ведёт b
        a.lead()                         # пользователь переключился на a
        call(url, 'get_state')
        assert len(a.got) == 1, f'после фокуса a получила {len(a.got)}'
        assert len(b.got) == 1, f'b получила лишнее ({len(b.got)})'
    finally:
        a.stop(); b.stop()


@case
def busy_bridge_refuses_second_command(url, base):
    """Пока вкладка считает, вторая команда получает внятный отказ."""
    slow = Tab(base, answer=False)       # молчит: команда «считается»
    try:
        done = []
        threading.Thread(target=lambda: done.append(call(url, 'get_state')), daemon=True).start()
        time.sleep(0.6)
        err, text = call(url, 'get_state')
        assert err, 'мост принял вторую команду поверх незаконченной'
        assert 'still running' in text, text
        # вкладка досчитала — мост снова свободен
        slow.answer = True               # дальше отвечает как обычная
        slow._post('/agent/result', {'id': slow.got[0]['id'], 'ok': True, 'result': {'ok': 1}})
        for _ in range(50):
            if done:
                break
            time.sleep(0.1)
        assert done and not done[0][0], 'первая команда не завершилась'
        err, _ = call(url, 'get_state')
        assert not err, 'мост остался занятым после ответа вкладки'
    finally:
        slow.stop()


@case
def protocol_version_is_negotiated(url, base):
    """Неизвестную версию протокола подтверждать нельзя."""
    r = rpc(url, 'initialize', {'protocolVersion': '2024-11-05'})
    assert r['result']['protocolVersion'] == '2024-11-05', r['result']
    r = rpc(url, 'initialize', {'protocolVersion': '2099-01-01'})
    got = r['result']['protocolVersion']
    assert got != '2099-01-01', 'сервер подтвердил несуществующую версию'
    assert got == '2025-06-18', got


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--url', help='MCP endpoint уже запущенного сервера')
    ap.add_argument('-k', default='', help='только тесты, содержащие эту подстроку')
    a = ap.parse_args()
    proc = None
    if a.url:
        url = a.url
    else:
        port = 9007
        url = f'http://127.0.0.1:{port}/mcp'
        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        exe = os.path.join(root, 'target', 'debug', 'zerocad' + ('.exe' if os.name == 'nt' else ''))
        if not os.path.exists(exe):
            print('сначала cargo build'); return 2
        proc = subprocess.Popen([exe], cwd=root, env={**os.environ, 'PORT': str(port)},
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                rpc(url, 'ping'); break
            except Exception:
                time.sleep(0.1)
        else:
            proc.kill(); print('сервер не поднялся'); return 2
    base = url[:-len('/mcp')]
    failed = 0
    try:
        for fn in TESTS:
            if a.k and a.k not in fn.__name__:
                continue
            t = time.time()
            try:
                fn(url, base)
                print(f'ok    {fn.__name__} ({time.time() - t:.1f} s)')
            except AssertionError as e:
                failed += 1
                print(f'FAIL  {fn.__name__}: {e}')
    finally:
        if proc:
            proc.kill()
    print('all passed' if not failed else f'{failed} failed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
