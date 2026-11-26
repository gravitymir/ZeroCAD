# ZeroCAD — справочник для AI-агента

Как строить модели в ZeroCAD через MCP: подключение, правила, частые ошибки
и **все команды с параметрами**. Подробности устройства — в `README.md`
(раздел «MCP: AI-агент рисует»).

## Подключение

- Сервер: `cargo run` (порт 9000; другой — `PORT=9011`). MCP:
  `http://127.0.0.1:9000/mcp` (Streamable HTTP, JSON-RPC 2.0).
  `claude mcp add --transport http zerocad http://127.0.0.1:9000/mcp`
- **Команды исполняет открытая вкладка редактора** (`http://127.0.0.1:9000`):
  вся геометрия считается в браузере. Нет вкладки — ошибка
  «ZeroCAD is not open in a browser»: попросите пользователя открыть ссылку.
- Команда уходит **одной ведущей вкладке** — той, что открыли последней или
  в которую пользователь только что кликнул. Вкладка подтверждает получение;
  молчит 5 с (закрыта) — команда уходит следующей.
- **Общий рабочий сеанс.** Каждая вкладка шлёт свой проект на сервер
  (`exports/_session.zcad`); новая вкладка открывается сразу на нём, открытые
  подхватывают чужие правки за 1–2 с. Пользователь видит каждый ваш шаг и
  может сам править ту же модель — **кто правил последним, тот и прав**.
  Перед большой перестройкой сохраните текущее (`save_file`), чтобы было куда
  вернуться.
- **Пересборка сервера перезагружает вкладки** (они сами обновляются на новую
  сборку). При этом у пользователя пропадает история Ctrl+Z. Не
  пересобирайте, пока пользователь разбирает поломку шагами назад.
  Вкладку, открытую до появления автообновления, нужно один раз обновить
  руками (F5); пока она старая, сервер команд ей не шлёт.

## Единицы, оси, вид

- Всё в **миллиметрах**, **Z вверх**, стол — плоскость XY (z = 0).
- `new_shape cube` — угол в начале координат, 0…size по каждой оси;
  cylinder/sphere/pyramid стоят на столе.
- Вид: `front` смотрит с −Y, `right` — с +X, `top` — сверху. Картинка —
  `screenshot` (можно `section` — разрез только для картинки).

## Правило: проверяйте тело после каждого шага

Почти каждая команда возвращает состояние. Тело в порядке, когда
**`open_edges = 0`** (замкнуто), **`nonmanifold_edges = 0`** (нет рёбер на
три грани) и **`folded_edges = 0`** (нет сложенных встык граней).
`volume_change_mm3` сверяйте с расчётом: площадь × высота у выдавки и т. п.
Не сошлось — `undo` и разбор, а не следующий шаг поверх поломки.
`slivers` — мелкие иглы, обычно безвредны.

## Частые ошибки

- `draw_line` — концы называются **`from` / `to`**, не `a` / `b`.
- Грань задаётся **точкой на ней** (+ `normal`, если точка на ребре и граней
  две). Точка в углу/на ребре без нормали выбирает не ту грань.
- Линия, рассёкшая грань, делит её на области: выдавливается только область
  под точкой (`extrude_face`) — так делают полосу-стенку у края.
- `extrude_face`: `distance` > 0 — наружу (добавить), < 0 — в тело (карман).
  Выдавка вплотную к соседней стенке сливается с ней (союз), шва нет.
- `cut_plane`: **нормаль смотрит в ту часть, которую убрать**.
- `bevel_edges`: точка — **вдоль ребра, не в углу**. Наружное ребро
  срезается, внутреннее (вогнутое) получает выкружку. Ребро, разбитое
  вершиной посередине, всё равно берётся целиком.
- `new_shape` и `open_project` **заменяют** модель (в т. ч. у пользователя в
  общем сеансе) — сначала `save_file`, если текущее нужно.
- Пути `open_project`, `import_3mf`, `texture_surface`: абсолютный или имя
  файла в `exports/`. `save_file` пишет в `exports/` (имя без пути).
- В историю шагов (`get_history`, `edit_step`) попадают **только команды
  агента**; правки пользователя мышью туда не пишутся.
- `new_shape gear` — колесо-дозатор с карманами, **не зубчатая шестерня**.

## Замеры пользователя («жёлтый замер — должен быть 6.65»)

Пользователь меряет рулеткой (T) и с **Alt** на втором клике оставляет замер
на модели цветом: жёлтый, красный, зелёный, синий, серебристый, фиолетовый,
салатовый, оранжевый (первый свободный). `get_measurements` даёт цвет
по-английски и по-русски (`color_ru`), обе точки, длину и dx/dy/dz — по ним
найдите, о каком размере речь. Показать свой размер — `add_measurement`;
убрать после работы — `clear_measurements`. В историю замеры не попадают.

## Проверка работы (тесты)

- `node --test tests/core/<файл>.test.js` — ядро без браузера (по одному
  файлу: каталог целиком `node --test` не берёт).
- `python tests/mcp/run.py --yes --url http://127.0.0.1:9012/mcp` — через
  MCP во вкладке **тестового сервера** (`ZEROCAD_TEST=1 PORT=9012`, свой
  сеанс; откройте его страницу в отдельной вкладке). Против обычного сервера
  пользователя `run.py` не запускается — его модель тесты не трогают.
- `cargo test` — сервер, разбор `tools.js`, полнота этого файла.

<!-- commands:begin -->

## Все команды (48)

_Сгенерировано из `web/tools.js` скриптом `assets/gen_help.py` — правьте описания там и перезапустите скрипт._

- **Состояние и вид:** `get_state`, `screenshot`, `set_view`
- **Замеры: команды:** `get_measurements`, `add_measurement`, `clear_measurements`
- **Новая модель и файлы:** `new_shape`, `open_project`, `import_3mf`, `save_file`, `export_stl`, `export_3mf`, `export_glb`
- **Эскиз: линии, круги, кривые:** `draw_line`, `draw_circle`, `draw_curve`, `bend_line`
- **Выдавливание и вырезы:** `extrude_face`, `cut_through`, `cut_plane`, `add_hole`, `move_edge`
- **Тела из профилей:** `add_frustum`, `add_revolve`, `add_sweep`, `loft_profiles`, `revolve_profile`, `sweep_profile`
- **Фаски, оболочка, перенос, массивы:** `bevel_edges`, `bevel_outline`, `shell_body`, `mirror_body`, `transform_body`, `lay_flat`, `pattern_body`
- **Текст, узоры, текстуры:** `add_text`, `extrude_text`, `add_pattern`, `texture_surface`
- **Цвет: многоцветная печать:** `paint_face`, `get_paints`
- **История шагов:** `get_history`, `edit_step`, `delete_step`, `undo`
- **Машина: обводка по фото и детали:** `trace_car`, `trace_reference`, `name_part`

## Состояние и вид

### `get_state`

Current model: triangle count, volume (mm³), bounding box, open edges (0 = closed solid), drawn lines, undo steps.

Без параметров.

### `screenshot`

Picture of the 3D view (JPEG). Camera options are the same as set_view and move the user view too; applied in the order view, yaw/pitch, fit, target, distance. section {point, normal} cuts the picture only: the side the normal points to is not drawn, so walls, ribs and fins inside show (inner faces are grey-blue).

| параметр | тип | нужен | описание |
|---|---|---|---|
| `view` | home \| iso \| top \| bottom \| front \| back \| left \| right |  | as on the ViewCube: front looks from -Y, right from +X, top from above; home/iso is the isometric start view |
| `yaw` | number |  | degrees around Z |
| `pitch` | number |  | degrees above the ground |
| `target` | [x, y, z] |  | point the camera looks at, mm |
| `distance` | number |  | camera distance from target, mm |
| `fit` | boolean |  | frame the whole model (target and distance from its bounding box) |
| `section` | object |  | cut-away for this picture only — поля: `point`, `normal` |
| `width` | integer |  | px, default 1000 |
| `height` | integer |  | px, default 700 |

### `set_view`

Turn the user's 3D view — the same as the ViewCube and orbiting: a named view, yaw/pitch, the point to look at, the distance, or fit the whole model. Applied in the order view, yaw/pitch, fit, target, distance. Returns the resulting camera. Does not close the user's open tool.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `view` | home \| iso \| top \| bottom \| front \| back \| left \| right |  | as on the ViewCube: front looks from -Y, right from +X, top from above; home/iso is the isometric start view |
| `yaw` | number |  | degrees around Z |
| `pitch` | number |  | degrees above the ground |
| `target` | [x, y, z] |  | point the camera looks at, mm |
| `distance` | number |  | camera distance from target, mm |
| `fit` | boolean |  | frame the whole model (target and distance from its bounding box) |

## Замеры: команды

### `get_measurements`

Measurements the user kept on the model: Tape (T), Alt on the second click. Each has a colour (yellow, red, green, blue, silver, purple, lime, orange; color_ru is the Russian name the user says, e.g. "жёлтый замер"), its two points a and b in mm and the distance with dx/dy/dz. Use it when the user refers to a measurement by colour.

Без параметров.

### `add_measurement`

Keep a measurement on the model between points a and b (mm), the same as the user's Alt+click with Tape: it gets the next free colour and shows its length. Use it to show the user which distance you mean.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `a` | [x, y, z] | да |  |
| `b` | [x, y, z] | да |  |

### `clear_measurements`

Remove kept measurements: all of them, or one given by id or colour name (English or Russian).

| параметр | тип | нужен | описание |
|---|---|---|---|
| `which` | string |  | id or colour; omit or 'all' for every measurement |

## Новая модель и файлы

### `new_shape`

Start a new model from a preset shape, replacing the current model. size is the cube side or the gear/sphere/cylinder diameter in mm. Note: "gear" is the peanut dispenser wheel this project started from — a disc with a central shaft bore and 4 V-shaped pockets in the rim. It is NOT a toothed gear; there is no involute tooth generator. Build a toothed gear from add_revolve plus a polar set of cut_through.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `shape` | cube \| gear \| sphere \| pyramid \| cylinder | да | cube: corner at the origin, spans 0..size on each axis. gear: dispenser wheel with pockets, centred on the Z axis. sphere/pyramid/cylinder: sit on the ground plane (cylinder: axis Z, base centre at (size/2, size/2, 0)). |
| `size` | number |  | mm |
| `height` | number |  | cylinder height in mm (default 40) |

### `open_project`

Open a ZeroCAD project (.zcad, written by save_file or the File menu), replacing the current model: mesh, lines, part names and the parametric history — continue with get_history / edit_step.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `path` | string | да | absolute path to a .zcad file, or a bare file name in the server's exports folder (where save_file writes) |

### `import_3mf`

Open a 3MF file, replacing the current model (undo brings it back). A 3MF written by ZeroCAD opens as the full project; one from another program (or edited there) opens as its mesh, converted to mm from its unit, with component transforms applied. Answer says opened: project or mesh.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `path` | string | да | absolute path to a .3mf file, or a bare file name in the server's exports folder (where export_3mf writes) |

### `save_file`

Save the model to a file — the same as the File menu. format: zcad (the ZeroCAD project: mesh, lines, names — opens back with Open project), stl (printing), 3mf (printing; also carries the project inside and opens back with import_3mf), glb (three.js), obj, step (faceted AP214 solid; needs a closed mesh). The server writes it to its exports folder and returns the path, size and whether the mesh is printable.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `format` | zcad \| stl \| 3mf \| glb \| obj \| step | да |  |
| `name` | string |  | file name without extension (letters, digits, - and _), default: project name |

### `export_stl`

Export the model as a binary STL (millimetres) for 3D printing. The server saves it to its exports folder and returns the file path; the answer says whether the mesh is printable (closed, no edges shared by 3+ triangles).

| параметр | тип | нужен | описание |
|---|---|---|---|
| `name` | string |  | file name without extension (letters, digits, - and _), default: project name |

### `export_3mf`

Export the model as 3MF (millimetres, accepted by PrusaSlicer, Bambu Studio, Orca, Cura). The whole ZeroCAD project (lines, points, hard edges) rides inside, so import_3mf or Open… in the editor restores it fully; slicers ignore that part. The server saves the file to its exports folder and returns the path.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `name` | string |  | file name without extension (letters, digits, - and _), default: project name |

### `export_glb`

Export the model as GLB (glTF 2.0 binary) for Three.js viewers such as IEGarage: metres (1 unit = 1 m), Y up, the car's nose along -Z. Named parts become separate nodes (body-main, hood, wheel-fl...), hotspots become empty nodes with a position. The server saves the file to its exports folder and returns the path.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `name` | string |  | file name without extension (letters, digits, - and _), default: project name |

## Эскиз: линии, круги, кривые

### `draw_line`

Draw a line segment. If both ends lie on one face, it splits the face into regions (like the SketchUp pencil); otherwise it is a construction line in the air.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `from` | [x, y, z] | да |  |
| `to` | [x, y, z] | да |  |

### `draw_circle`

Draw a circle (a polygon of segments) in the plane given by center and normal; on a face it splits out a round region.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `center` | [x, y, z] | да |  |
| `normal` | [x, y, z] | да |  |
| `radius` | number | да | mm |
| `segments` | integer |  | 3–360, default by size |

### `draw_curve`

Draw a smooth curve (Bezier) through the given points — the same builder as the Pen tool (G,P). By default the curve is smoothed with Catmull-Rom tangents and cut into chords no further than tolerance mm from the true curve; smooth: false joins the points with straight lines. Use it to trace a car silhouette over a reference photo: keep every point in the plane of that photo.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `points` | массив точек [x,y,z] | да |  |
| `closed` | boolean |  | close the curve into a loop |
| `smooth` | boolean |  | default true |
| `tension` | number |  | how far the tangents reach, default 0.333 |
| `tolerance` | number |  | mm, max distance from chord to curve, default 0.4 |
| `on_face` | boolean |  | cut the chords into the face they lie on, default true |

### `bend_line`

Bend a drawn straight line into an arc through its own ends and a handle point — the same thing as holding Alt and dragging a point placed on that line. The line is replaced by chords of the arc (no further than 0.05 mm from the true arc) and they are cut into the face, so the face splits along the arc.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `point` | [x, y, z] | да | any point on the line, mm |
| `through` | [x, y, z] | да | the point the arc must pass through, mm — keep it in the plane of the face |

## Выдавливание и вырезы

### `extrude_face`

Push/pull the face region under a point by a distance along its normal: positive adds material, negative cuts into the body (like E in the editor). The region is bounded by drawn lines and edges.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `point` | [x, y, z] | да | a point on the face, mm |
| `normal` | [x, y, z] |  | optional face normal to choose between faces meeting at the point |
| `distance` | number | да | mm, + out of the face, − into the body |
| `operation` | auto \| join \| cut |  | auto: into the body cuts, outward joins |
| `end_scale` | number |  | tapered extrude (End size in the Extrude window): size of the end face relative to the base, scaled around the outline centre (0.05–5, default 1). Works outward and into the body, also for regions with holes. |

### `cut_through`

Cut the face region under a point straight through the whole body along the face normal (Through All) — a through hole (draw its outline first, e.g. draw_circle). The region may have holes; the far side need not be parallel.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `point` | [x, y, z] | да | a point inside the region, mm |
| `normal` | [x, y, z] |  | optional face normal |

### `cut_plane`

Slice the body with a plane and remove everything on the side the normal points to (like Split Body + delete in Fusion). Useful to cut corners at any angle, e.g. a tetrahedron from a cube.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `point` | [x, y, z] | да | a point on the cutting plane, mm |
| `normal` | [x, y, z] | да | points to the part to remove |

### `add_hole`

Drill a hole in a face — the same builder as the user's Hole window (G,D). point: the centre on a face (+ normal when the point is on an edge); the hole goes along the face normal into the body. type simple (default), counterbore (a flat seat for a cheese head) or countersink (a cone for a flat head, angle 90 by default); head_diameter and head_depth (counterbore) or angle (countersink). depth in mm, or through: true to go right through. tip: a 118 degree drill point instead of a flat bottom. Clearance and head sizes for M3…M6 screws: M3 3.4/6.0/6.5x3, M4 4.5/8.0/8.0x4, M5 5.5/10/10x5, M6 6.6/12/11x6 (hole / countersink head / counterbore).

| параметр | тип | нужен | описание |
|---|---|---|---|
| `pattern` | object |  | circular pattern of this operation: the solid is built once and cut/added count times around the axis in one step (fins on a wall, holes on a flange). angle 360 (default) spreads them evenly, less goes from 0 to angle inclusive — поля: `count`, `axis_point`, `axis`, `angle` |
| `point` | [x, y, z] | да |  |
| `normal` | [x, y, z] |  |  |
| `diameter` | number | да | mm |
| `depth` | number |  | mm from the face |
| `through` | boolean |  |  |
| `type` | simple \| counterbore \| countersink |  |  |
| `head_diameter` | number |  | mm |
| `head_depth` | number |  | mm, counterbore only |
| `angle` | number |  | degrees, countersink only (default 90) |
| `tip` | boolean |  | 118 degree drill point |
| `segments` | integer |  |  |

### `move_edge`

Move a drawn line or an edge of the body perpendicular to the face it lies on (M, then Shift or N, then a distance in the editor). Pushed into the body (distance < 0) it becomes a V groove: the neighbouring face strips fold in and the wedge is cut out, e.g. a line drawn across a face from edge to edge at mid-height, moved -5.5, notches that face. Pulled outward it raises a ridge. Draw the line first with draw_line.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `point` | [x, y, z] | да | a point on the line or edge, mm (not at its end) |
| `distance` | number | да | mm along the face normal: − into the body (V groove), + outward |
| `end` | face \| straight |  | how the groove ends, default face: face lets the ends lean into the neighbouring faces, so the edge slides along them and gets shorter; straight cuts the ends square across the edge, so the edge keeps its length and the neighbouring face gets one more edge |

## Тела из профилей

### `add_frustum`

Solid truncated cone (or cylinder when r1 = r2) from point "from" (radius r1) to point "to" (radius r2). operation: join — merge with the body, cut — subtract it, intersect — keep only what lies inside both (how two blueprint silhouettes are crossed), new — replace the whole model with this solid.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `pattern` | object |  | circular pattern of this operation: the solid is built once and cut/added count times around the axis in one step (fins on a wall, holes on a flange). angle 360 (default) spreads them evenly, less goes from 0 to angle inclusive — поля: `count`, `axis_point`, `axis`, `angle` |
| `from` | [x, y, z] | да |  |
| `to` | [x, y, z] | да |  |
| `r1` | number | да | mm at "from" |
| `r2` | number | да | mm at "to" |
| `segments` | integer |  | 3–256, default 48 |
| `operation` | join \| cut \| intersect \| new |  |  |

### `add_revolve`

Solid of revolution (Revolve / lathe): profile [[r, h], ...] is turned around the axis through "base" along "axis" (default Z). r is the distance from the axis, h the height along it; the profile must start and end on the axis (r = 0) and must not cross itself. Sample curves densely yourself. operation: join, cut, intersect (keep only what lies inside both — crossing two blueprint views) or new.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `pattern` | object |  | circular pattern of this operation: the solid is built once and cut/added count times around the axis in one step (fins on a wall, holes on a flange). angle 360 (default) spreads them evenly, less goes from 0 to angle inclusive — поля: `count`, `axis_point`, `axis`, `angle` |
| `profile` | массив массивов | да |  |
| `base` | [x, y, z] |  |  |
| `axis` | [x, y, z] |  |  |
| `segments` | integer |  | 3–256, default 64 |
| `operation` | join \| cut \| intersect \| new |  |  |

### `add_sweep`

Solid tube swept along a path (Sweep / pipe): an ellipse section follows the polyline "path" [[x,y,z], ...], ends capped. radius: mm, one number or one per path point; side_radius: the other semi-axis (default = radius), measured along "side" (a direction; default chosen automatically). The section is carried along the path without twisting. Sample curves densely and keep the radius below the bend radius. operation: join, cut, intersect (keep only what lies inside both — crossing two blueprint views) or new.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `pattern` | object |  | circular pattern of this operation: the solid is built once and cut/added count times around the axis in one step (fins on a wall, holes on a flange). angle 360 (default) spreads them evenly, less goes from 0 to angle inclusive — поля: `count`, `axis_point`, `axis`, `angle` |
| `path` | массив точек [x,y,z] | да |  |
| `radius` | объект | да | number or array per path point |
| `side_radius` | объект |  | number or array per path point |
| `side` | [x, y, z] |  |  |
| `segments` | integer |  | 3–128, default 24 |
| `operation` | join \| cut \| intersect \| new |  |  |

### `loft_profiles`

Stretch a solid between two flat closed profiles given in 3D — the same builder as the user's Loft tool (G,F): a funnel, an adapter, a neck. Vertices are stitched by the share of the outline length from the closest starting vertex, so the corners of both profiles stay and the walls run straight from one to the other. Both profiles must be flat and not in the same place.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `pattern` | object |  | circular pattern of this operation: the solid is built once and cut/added count times around the axis in one step (fins on a wall, holes on a flange). angle 360 (default) spreads them evenly, less goes from 0 to angle inclusive — поля: `count`, `axis_point`, `axis`, `angle` |
| `profile_a` | массив точек [x,y,z] | да |  |
| `profile_b` | массив точек [x,y,z] | да |  |
| `operation` | join \| cut \| intersect \| new |  | default join |

### `revolve_profile`

Revolve a flat closed profile given in 3D around an axis — the same builder as the user's Revolve tool (G,O). The axis must lie in the plane of the profile and the profile on one side of it (points on the axis are fine). |angle| < 360 makes a sector with flat ends.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `pattern` | object |  | circular pattern of this operation: the solid is built once and cut/added count times around the axis in one step (fins on a wall, holes on a flange). angle 360 (default) spreads them evenly, less goes from 0 to angle inclusive — поля: `count`, `axis_point`, `axis`, `angle` |
| `profile` | массив точек [x,y,z] | да |  |
| `axis_point` | [x, y, z] | да |  |
| `axis_direction` | [x, y, z] | да |  |
| `angle` | number |  | degrees, default 360; negative turns the other way |
| `segments` | integer |  | per full turn, default 64 |
| `operation` | join \| cut \| intersect \| new |  | default join |

### `sweep_profile`

Sweep a flat closed profile given in 3D along a polyline path — the same builder as the user's Sweep tool (G,W). The profile is carried without twisting from the path end nearest to it; corners are mitred (no sharper than 30°). closed: the path is a loop (no end caps).

| параметр | тип | нужен | описание |
|---|---|---|---|
| `pattern` | object |  | circular pattern of this operation: the solid is built once and cut/added count times around the axis in one step (fins on a wall, holes on a flange). angle 360 (default) spreads them evenly, less goes from 0 to angle inclusive — поля: `count`, `axis_point`, `axis`, `angle` |
| `profile` | массив точек [x,y,z] | да |  |
| `path` | массив точек [x,y,z] | да |  |
| `closed` | boolean |  |  |
| `operation` | join \| cut \| intersect \| new |  | default join |

## Фаски, оболочка, перенос, массивы

### `bevel_edges`

Chamfer (segments = 1) or round/fillet (segments ≥ 2) straight edges of the body — the same tool as Ctrl+B. A convex (outer) edge is cut away; a concave (inner) edge gets material added — a cove between the two faces. Each edge is given by a point on it (not at a corner). size is the setback along each face from the edge; on a 90° edge the fillet radius equals size. Ball corner: where three of the edges meet at right angles (all outer or all inner) the corner becomes a piece of a sphere of radius size instead of a crease — pass the corner in vertices to take all three of its edges at once (an inner corner gets material, which strengthens it).

| параметр | тип | нужен | описание |
|---|---|---|---|
| `points` | массив точек [x,y,z] |  | one point on each edge, mm |
| `vertices` | массив точек [x,y,z] |  | corner points where three edges meet at 90°: all three edges are rounded and the corner becomes a ball, mm |
| `size` | number | да | mm, setback along the faces |
| `segments` | integer |  | 1 — chamfer, 2–32 — round (default 8) |

### `bevel_outline`

Chamfer (segments = 1, default) or round (segments ≥ 2) whole outlines of a face — straight edges and arcs together, e.g. the top edge of a box with rounded corners or the rims of holes. outlines: outer (default), holes, or all. The walls along the outline should be perpendicular to the face and taller than size.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `point` | [x, y, z] | да | a point on the face, mm |
| `normal` | [x, y, z] |  | optional face normal |
| `size` | number | да | mm: inset on the face and drop on the walls |
| `segments` | integer |  | 1 — chamfer (default), 2–32 — round |
| `outlines` | outer \| holes \| all |  | which outlines, default outer |

### `shell_body`

Hollow a body with an even wall — the same as the user's Shell window (G,H). thickness in mm; open_faces: flat faces to remove, each by a point on it (+ normal when the point is on an edge) — a whole flat face opens even if lines split it. No open faces leaves a closed cavity inside. body_point: a point on the body; omit it for the whole model. Fails if the wall is thicker than a thin part of the body.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `thickness` | number | да |  |
| `open_faces` | массив object |  |  |
| `body_point` | [x, y, z] |  |  |

### `mirror_body`

Mirror a body across a plane — the same as the user's Mirror window (G,I). body_point: a point on the surface of the body (a connected part of the mesh); omit it for the whole model. mode join (default) keeps the original and unites it with the mirrored copy (a half part becomes whole); flip moves the body to the other side. Lines on the body follow it.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `plane_point` | [x, y, z] | да |  |
| `plane_normal` | [x, y, z] | да |  |
| `body_point` | [x, y, z] |  |  |
| `mode` | join \| flip |  |  |

### `transform_body`

Move, scale or rotate a body — the same as the user's Move / Scale window (G,B) plus rotation. rotate {axis, angle (degrees)} turns it around an axis through pivot (default: the centre of the body's bounding box) — 180 around a horizontal axis turns a part upside down for printing. body_point: a point on the surface of the body; omit it for the whole model. move [dx, dy, dz] in mm, or scale (a factor, or [sx, sy, sz]) around pivot (default: the bottom centre of the body's bounding box). copies 0 (default) transforms the body itself; N keeps the original and adds N copies, each one more step further (a linear array; scale allows 1). Copies touching the rest are united with exact booleans.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `body_point` | [x, y, z] |  |  |
| `move` | [x, y, z] |  |  |
| `scale` | объект |  | factor, or [sx, sy, sz] |
| `rotate` | object |  | поля: `axis`, `angle` |
| `pivot` | [x, y, z] |  |  |
| `copies` | integer |  |  |

### `lay_flat`

Lay the model on a face — the same as K on a selected face in the editor (Lay on Face in slicers): the whole model turns so that this face points down and lies on the XY plane (the bed), its bottom at z = 0, the X/Y centre stays. Lines, points and kept measurements turn with it.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `point` | [x, y, z] | да | a point on the face, mm |
| `normal` | [x, y, z] |  | optional face normal to choose between faces meeting at the point |

### `pattern_body`

Circular pattern of a body — the same as the user's G,A on a body: keeps the body and adds copies turned around the axis. body_point: a point on the surface of the body (a connected part of the mesh); omit it for the whole model. count includes the original; angle 360 (default) spreads them evenly, less goes from 0 to angle inclusive. Copies touching the rest are united with exact booleans. To repeat a feature that merges into a wall (fins, holes) use the pattern option of the solid commands instead.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `body_point` | [x, y, z] |  |  |
| `axis_point` | [x, y, z] | да |  |
| `axis` | [x, y, z] |  | direction, default [0, 0, 1] |
| `count` | integer | да | 2…360, the original included |
| `angle` | number |  | degrees, default 360 |

## Текст, узоры, текстуры

### `add_text`

Put text on a face, centred at a point: depth > 0 embosses (raised letters), depth < 0 engraves, 0 only draws the letter outlines. Blocky 5×7 font (A–Z, 0–9, '-', '.') plus vector symbols typed as {name} anywhere in the line — {triskele} (three spiral arms), {spiral} (one even spiral), {swirl} (a hand-drawn spiral silhouette); a symbol is a square of the text height and needs depth + or −; on vertical faces the text reads upright, on horizontal faces along +X. wrap {axis_point, axis} bends the letters around a cylinder wall (outer or inner) so the depth stays even along the line — use it on round walls, where a flat block would sink at the ends; normal then points along the radius, the axis is parallel to the wall. project: true lays the text on a plane through center facing normal and projects every letter point along -normal from that plane onto the first face it meets (like projecting a sketch): seen from the normal side the text looks flat, on any curved surface (the bottom of a cone, a dome); depth is along the local surface normal. Put the plane just above the target surface: anything above the plane (fins, ribs, other text) is not hit. depth 0 with wrap or project draws the letter outlines as lines on the curved surface (a text sketch, no volume); then extrude_text raises or engraves any single letter of it, or the whole line.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `center` | [x, y, z] | да | centre of the text on the face, mm |
| `normal` | [x, y, z] | да | outward normal of that face |
| `text` | string | да |  |
| `height` | number | да | letter height, mm (≥ 3) |
| `depth` | number | да | mm: + raised, − engraved, 0 outline |
| `project` | boolean |  | project the text onto the surface along -normal (seen from the normal side it stays flat) |
| `rotate` | number |  | degrees, with project: turns the line in its plane counter-clockwise as seen from the normal side (-10 = 10° clockwise) |
| `wrap` | object |  | cylinder to wrap around: axis_point and axis direction (default [0, 0, 1]) — поля: `axis_point`, `axis` |

### `extrude_text`

Raise (+) or engrave (−) one letter of a text sketch on a curved surface — the outline drawn by add_text with depth 0 and wrap or project. point: a point on (or at the edge of) the letter on the surface; whole: true takes the whole line. The letter is built from the sketch with the same wrap/projection, so it follows its outline exactly and the depth is along the local surface normal.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `point` | [x, y, z] | да |  |
| `distance` | number | да | mm, + raised, − engraved |
| `whole` | boolean |  | all letters of the sketch |

### `add_pattern`

Raise (+) or engrave (−) a decorative band: kind honeycomb (hexagon walls with a frame), honeycomb_relief (solid hexagon tiles, each with its own tilted top — zero at a random corner, depth at the opposite one; seed changes the randomness), meander (Greek key with a frame), triskele (three spiral arms from one centre; whole figures in rows, alternately pointing up and down so they interlock like honeycomb; cell = spacing of the figures, line = stroke, turns = turns of each spiral, default 1.75), symbol (rows of any library symbol, see symbol) or knurl (a grip like on a knurled lathe handle or a barbell; style straight — ribs along the band height, on a cylinder along its axis; diamond — two sets of grooves at ±angle to that axis with diamond pyramids between them; cross — grooves along and across the axis, square pyramids; cell = groove pitch; raised only, line is not used). The band length × height is centred at center on a face facing normal; wrap {axis_point, axis} bends it around a cylinder (it may go almost all the way round; ring: true closes it seamlessly), project: true projects it along -normal from its plane like the text (skip_missing: true lets it skip holes where there is no surface), rotate turns it in its plane (project). cell: hexagon spacing or meander module, mm; line: wall/stroke width, mm.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `kind` | honeycomb \| honeycomb_relief \| meander \| triskele \| symbol \| knurl | да |  |
| `symbol` | string |  | kind symbol: a symbol of the library (the same as {name} in add_text) - triskele, spiral, swirl (a silhouette: its own stroke, line is not used); whole figures in rows, every other row shifted by half a step; cell = spacing, the figure fits a circle of 0.8 cell, line = stroke |
| `turns` | number |  | triskele: turns of each spiral arm, 0.5…4, default 1.75 |
| `style` | straight \| diamond \| cross |  | knurl: default diamond |
| `angle` | number |  | knurl diamond: groove angle to the band height (cylinder axis), degrees 10…60, default 30; knurl straight: tilt of the ribs from that axis - 0 along it (default), 90 across (a washboard), 45 slanted |
| `center` | [x, y, z] | да |  |
| `normal` | [x, y, z] | да |  |
| `length` | number | да | band length, mm |
| `height` | number | да | band height, mm |
| `cell` | number | да | mm |
| `line` | number |  | mm |
| `depth` | number | да | mm, + raised, − engraved |
| `wrap` | object |  | поля: `axis_point`, `axis` |
| `project` | boolean |  |  |
| `skip_missing` | boolean |  |  |
| `onto_point` | [x, y, z] |  | with project: project only onto the smooth surface under this point (edges sharper than 20 degrees bound it) - fins, ribs and text above are ignored, so the plane may be anywhere above |
| `rotate` | number |  |  |
| `seed` | integer |  |  |
| `spin` | none \| random |  | kind symbol: random turns every figure by its own angle (seed changes them) |
| `tilt` | random \| down \| up \| left \| right |  | honeycomb_relief: which way every tile rises - random (default, each its own corner) or the same for all: down = zero at the top vertex, full depth at the bottom (a wedge for testing overhangs) |
| `fill` | walls \| cells |  | honeycomb: raise/engrave the walls between cells (default) or the hexagons themselves; the inner size of a cell is cell - line |
| `ring` | boolean |  | with wrap: a closed ring all the way round the wall with no seam - length becomes the circumference and cell is adjusted to a whole number of cells (answer: cell_used_mm, cells_around) |

### `texture_surface`

Texture the surface (displacement, like texture tools in slicers): the faces are split down to resolution and every vertex moves along its normal by the texture height times depth. texture: noise (soft relief), voronoi (pebbles with grooves), hex (hexagon tiles), knurl (diamond pyramids), brick, wood, or image (path: a png/jpg/webp height map, bright = high; it tiles). projection: triplanar (default; three planar projections blended by the normal), cubic, cylindrical / spherical (around axis through center; a whole number of tiles fits round, no seam), planar_xy / planar_xz / planar_yz. size (or size_u, size_v) — tile size in mm; rotation (degrees), offset_u / offset_v (tiles). Region: the whole model, or point — the smooth surface under that point; mask_bottom_deg / mask_top_deg leave faces facing down / up within that angle untouched (a flat bottom for the bed); transition (mm, default 1) fades the depth in from the mask edge. depth + raises, − sinks; symmetric goes both ways; invert flips the texture. The mesh stays closed; mind the triangle count (area / resolution² × 2, capped by max_triangles, default 3 M).

| параметр | тип | нужен | описание |
|---|---|---|---|
| `texture` | noise \| voronoi \| hex \| knurl \| brick \| wood \| image |  |  |
| `path` | string |  | texture image: a height map file (absolute or in exports/) |
| `depth` | number | да | mm |
| `resolution` | number |  | mm, edge length after splitting, default 0.6 |
| `projection` | triplanar \| cubic \| cylindrical \| spherical \| planar_xy \| planar_xz \| planar_yz |  |  |
| `size` | number |  | tile size, mm (default 6) |
| `size_u` | number |  |  |
| `size_v` | number |  |  |
| `rotation` | number |  | degrees |
| `offset_u` | number |  |  |
| `offset_v` | number |  |  |
| `center` | [x, y, z] |  | projection centre (default: the centre of the region) |
| `axis` | [x, y, z] |  | cylindrical / spherical axis (default Z) |
| `point` | [x, y, z] |  | texture only the smooth surface under this point |
| `mask_bottom_deg` | number |  |  |
| `mask_top_deg` | number |  |  |
| `transition` | number |  | mm, fade-in from the mask edge (default 1) |
| `symmetric` | boolean |  |  |
| `invert` | boolean |  |  |
| `seed` | integer |  |  |
| `max_triangles` | integer |  |  |

## Цвет: многоцветная печать

### `paint_face`

Paint faces with a filament for multi-colour printing — the same as Shift+1…8 on selected faces in the editor. The whole face region under the point is painted (what a click selects: up to edges and drawn lines); a point on a fillet made by bevel_edges / Ctrl+B paints the whole rounded surface — all its strips, ball corners and the coves joining them. filament 1 is the main one (clears the paint), 2–8 are the other filaments (AMS slots on a Bambu printer). The paint follows the face if it is extruded along its normal. export_3mf writes it per triangle as paint_color (Bambu Studio, OrcaSlicer) and slic3rpe:mmu_segmentation (PrusaSlicer).

| параметр | тип | нужен | описание |
|---|---|---|---|
| `point` | [x, y, z] |  | a point on the face, mm |
| `normal` | [x, y, z] |  | optional face normal to choose between faces meeting at the point |
| `faces` | массив object |  | several faces at once: [{point, normal}] instead of point/normal |
| `filament` | integer | да | 1–8; 1 clears the paint |

### `get_paints`

List painted faces: point, normal, filament and lost (the face is no longer found — the paint is ignored), plus the display colours of filaments 1–8.

Без параметров.

## История шагов

### `get_history`

The parametric history: every model-changing command so far as {index, command, args, status, volume_change_mm3}. Step 0 is new_shape or 'base' — a snapshot of a model without a recipe (imported, or edited by the user's mouse). If the user changed the model by hand after the last command, the history folds into a new 'base' of the current model. failed lists steps that did not apply on the last rebuild.

Без параметров.

### `edit_step`

Change the parameters of a history step and rebuild the model from scratch by replaying all steps (like editing a feature in the Fusion timeline). args: only the keys to change; null removes a key. A step that no longer applies is marked failed and skipped, the rest still run — fix it with another edit_step. One undo reverts the whole rebuild.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `index` | integer | да |  |
| `args` | object | да | parameters to change, e.g. {"thickness": 3} |

### `delete_step`

Remove a history step (not step 0) and rebuild the model from scratch by replaying the rest. One undo reverts the rebuild.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `index` | integer | да |  |

### `undo`

Undo the last step (the same history as Ctrl+Z).

Без параметров.

## Машина: обводка по фото и детали

### `trace_car`

Turn on Trace (car) mode and set the car's bounding box in mm: reference photo planes stand on that box. preset picks a standard body size (City car, Hatchback, Sedan, SUV medium, SUV large, Van small, Van medium, Van large, Wagon, Coupe, Pickup). The car stands on the ground: X is width, +Y is the nose, Z is height, origin at the centre of the wheelbase on the tarmac.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `preset` | string |  |  |
| `length` | number |  | mm along Y |
| `width` | number |  | mm along X |
| `height` | number |  | mm along Z |
| `view` | front \| rear \| left \| right \| top \| bottom |  | also jump to this orthographic view |
| `on` | boolean |  | default true |

### `trace_reference`

Put a photo on one of the six reference planes and calibrate it. path is an image file (png/jpg) the server reads. width is how many mm of the car the photo spans across the plane (for a side view: the car's length), shift_u / shift_v move the photo inside the plane, opacity 0.05…1. Draw over the photo with the ordinary tools, then export_glb.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `view` | front \| rear \| left \| right \| top \| bottom | да |  |
| `path` | string |  | absolute path to a png/jpg, or a bare file name in the server's exports folder |
| `width` | number |  | mm the photo spans along the plane |
| `opacity` | number |  |  |
| `shift_u` | number |  | mm, right in the photo's own plane |
| `shift_v` | number |  | mm, up in the photo's own plane |
| `flip` | boolean |  | mirror the photo |

### `name_part`

Name the part of the body under a point, or place a hotspot there. Names are the IEGarage contract: body-main, hood, roof, trunk, door-front-l/r, door-rear-l/r, door-sliding, windshield, window-rear, window-side-l/r, wheel-fl/fr/rl/rr, headlight-l/r, taillight-l/r, turnsignal-l/r, bumper-front/rear, mirror-l/r, wipers, fuel-cap-l/r; hotspots: hotspot-engine, hotspot-battery, hotspot-oil-fill, hotspot-air-filter, hotspot-brakes-front, hotspot-brakes-rear, hotspot-wipers. Each name becomes a node in export_glb.

| параметр | тип | нужен | описание |
|---|---|---|---|
| `name` | string | да |  |
| `point` | [x, y, z] | да | mm; for a part — a point on its face, for a hotspot — where the marker goes |

<!-- commands:end -->
