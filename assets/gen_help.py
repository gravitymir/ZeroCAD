"""Справочник команд для агента: HELP.md из web/tools.js.

web/tools.js — единственный источник правды о командах MCP (его же вшивает
сервер). Скрипт переписывает в HELP.md только блок между метками
<!-- commands:begin --> и <!-- commands:end -->; всё, что выше и ниже,
пишется руками. `cargo test` проверяет, что в HELP.md есть каждая команда.

    python assets/gen_help.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'web', 'tools.js')
HELP = os.path.join(ROOT, 'HELP.md')
BEGIN, END = '<!-- commands:begin -->', '<!-- commands:end -->'

# порядок разделов и какие команды в них; новая команда без раздела
# попадёт в «Прочее» — допишите её сюда
GROUPS = [
    ('Состояние и вид', ['get_state', 'screenshot', 'set_view']),
    ('Замеры: команды', ['get_measurements', 'add_measurement', 'clear_measurements']),
    ('Новая модель и файлы', ['new_shape', 'open_project', 'import_3mf', 'save_file',
                              'export_stl', 'export_3mf', 'export_glb']),
    ('Эскиз: линии, круги, кривые', ['draw_line', 'draw_circle', 'draw_curve', 'bend_line']),
    ('Выдавливание и вырезы', ['extrude_face', 'cut_through', 'cut_plane', 'add_hole', 'move_edge']),
    ('Тела из профилей', ['add_frustum', 'add_revolve', 'add_sweep', 'loft_profiles',
                          'revolve_profile', 'sweep_profile']),
    ('Фаски, оболочка, перенос, массивы', ['bevel_edges', 'bevel_outline', 'shell_body',
                                           'mirror_body', 'transform_body', 'lay_flat', 'pattern_body']),
    ('Текст, узоры, текстуры', ['add_text', 'extrude_text', 'add_pattern', 'texture_surface']),
    ('История шагов', ['get_history', 'edit_step', 'delete_step', 'undo']),
    ('Машина: обводка по фото и детали', ['trace_car', 'trace_reference', 'name_part']),
]


def load_tools():
    s = open(TOOLS, encoding='utf-8').read()
    a = s.index('[', s.index('const ZC_TOOLS'))
    b = s.rindex(']')
    return json.loads(s[a:b + 1])


def type_of(p):
    t = p.get('type')
    if t == 'array':
        it = p.get('items', {})
        if it.get('type') == 'array':
            return 'массив точек [x,y,z]' if it.get('minItems') == 3 else 'массив массивов'
        if it.get('type') == 'number' and p.get('minItems') == p.get('maxItems') == 3:
            return '[x, y, z]'
        if it.get('type') == 'number' and p.get('minItems') == p.get('maxItems') == 2:
            return '[a, b]'
        return 'массив ' + (it.get('type') or '')
    if 'enum' in p:
        return ' | '.join(str(x) for x in p['enum'])
    return t or 'объект'


def esc(text):
    return (text or '').replace('|', '\\|').replace('\n', ' ')


def render_tool(t):
    out = ['### `%s`' % t['name'], '', t['description'].strip(), '']
    props = t.get('inputSchema', {}).get('properties', {})
    req = set(t.get('inputSchema', {}).get('required', []))
    if props:
        out += ['| параметр | тип | нужен | описание |', '|---|---|---|---|']
        for name, p in props.items():
            desc = p.get('description', '')
            if p.get('type') == 'object' and p.get('properties'):
                sub = ', '.join('`%s`' % k for k in p['properties'])
                desc = (desc + ' — поля: ' + sub).strip(' —')
            out.append('| `%s` | %s | %s | %s |' % (name, esc(type_of(p)), 'да' if name in req else '',
                                                   esc(desc)))
        out.append('')
    else:
        out += ['Без параметров.', '']
    return out


def render(tools):
    by = {t['name']: t for t in tools}
    seen = set()
    lines = [BEGIN, '',
             '## Все команды (%d)' % len(tools), '',
             '_Сгенерировано из `web/tools.js` скриптом `assets/gen_help.py` — правьте'
             ' описания там и перезапустите скрипт._', '']
    toc = []
    body = []
    groups = GROUPS + [('Прочее', [t['name'] for t in tools if not any(t['name'] in g for _, g in GROUPS)])]
    for title, names in groups:
        names = [n for n in names if n in by]
        if not names:
            continue
        toc.append('- **%s:** %s' % (title, ', '.join('`%s`' % n for n in names)))
        body += ['## %s' % title, '']
        for n in names:
            body += render_tool(by[n])
            seen.add(n)
    lines += toc + [''] + body + [END]
    return '\n'.join(lines)


def main():
    tools = load_tools()
    block = render(tools)
    text = open(HELP, encoding='utf-8').read() if os.path.exists(HELP) else BEGIN + '\n' + END + '\n'
    if BEGIN not in text or END not in text:
        text = text.rstrip() + '\n\n' + BEGIN + '\n' + END + '\n'
    a = text.index(BEGIN)
    b = text.index(END) + len(END)
    text = text[:a] + block + text[b:]
    open(HELP, 'w', encoding='utf-8', newline='\n').write(text)
    print('HELP.md: %d commands' % len(tools))


if __name__ == '__main__':
    main()
