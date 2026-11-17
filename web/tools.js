// MCP-схема команд для агента — ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ.
//
// Отсюда её берут оба потребителя, и второго списка нет нигде:
//   - вкладка (`zcToolList()` в app.js) шлёт её серверу в POST /agent/hello;
//   - сервер вшивает ЭТОТ ЖЕ файл через include_str! (src/main.rs) и отдаёт
//     `tools/list` даже когда вкладка ещё не открыта — иначе агент,
//     подключившийся раньше пользователя, видел пустой список и считал,
//     что ZeroCAD ничего не умеет (см. «MCP» в README).
//
// Поэтому файл — чистые данные, без выражений: его разбирает и Rust.
// Реализация команд (`run`) живёт в `ZC_COMMANDS` в app.js; имена здесь и
// там обязаны совпадать — это проверяет `cargo test` и тест вкладки.
// Правка здесь требует `cargo build` + перезапуск сервера + F5, как и app.js.
const ZC_TOOLS = [
  {
    "name": "get_state",
    "description": "Current model: triangle count, volume (mm³), bounding box, open edges (0 = closed solid), drawn lines, undo steps.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "new_shape",
    "description": "Start a new model from a preset shape, replacing the current model. size is the cube side or the gear/sphere/cylinder diameter in mm. Note: \"gear\" is the peanut dispenser wheel this project started from — a disc with a central shaft bore and 4 V-shaped pockets in the rim. It is NOT a toothed gear; there is no involute tooth generator. Build a toothed gear from add_revolve plus a polar set of cut_through.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "shape": {
          "type": "string",
          "enum": [
            "cube",
            "gear",
            "sphere",
            "pyramid",
            "cylinder"
          ],
          "description": "cube: corner at the origin, spans 0..size on each axis. gear: dispenser wheel with pockets, centred on the Z axis. sphere/pyramid/cylinder: sit on the ground plane (cylinder: axis Z, base centre at (size/2, size/2, 0))."
        },
        "size": {
          "type": "number",
          "description": "mm"
        },
        "height": {
          "type": "number",
          "description": "cylinder height in mm (default 40)"
        }
      },
      "required": [
        "shape"
      ]
    }
  },
  {
    "name": "draw_line",
    "description": "Draw a line segment. If both ends lie on one face, it splits the face into regions (like the SketchUp pencil); otherwise it is a construction line in the air.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "from": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "to": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        }
      },
      "required": [
        "from",
        "to"
      ]
    }
  },
  {
    "name": "draw_circle",
    "description": "Draw a circle (a polygon of segments) in the plane given by center and normal; on a face it splits out a round region.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "center": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "normal": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "radius": {
          "type": "number",
          "description": "mm"
        },
        "segments": {
          "type": "integer",
          "description": "3–360, default by size"
        }
      },
      "required": [
        "center",
        "normal",
        "radius"
      ]
    }
  },
  {
    "name": "extrude_face",
    "description": "Push/pull the face region under a point by a distance along its normal: positive adds material, negative cuts into the body (like E in the editor). The region is bounded by drawn lines and edges.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "point": {
          "description": "a point on the face, mm",
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "normal": {
          "description": "optional face normal to choose between faces meeting at the point",
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "distance": {
          "type": "number",
          "description": "mm, + out of the face, − into the body"
        },
        "operation": {
          "type": "string",
          "enum": [
            "auto",
            "join",
            "cut"
          ],
          "description": "auto: into the body cuts, outward joins"
        },
        "end_scale": {
          "type": "number",
          "description": "tapered extrude (End size in the Extrude window): size of the end face relative to the base, scaled around the outline centre (0.05–5, default 1). Works outward and into the body, also for regions with holes."
        }
      },
      "required": [
        "point",
        "distance"
      ]
    }
  },
  {
    "name": "cut_through",
    "description": "Cut the face region under a point straight through the whole body along the face normal (Through All) — a through hole (draw its outline first, e.g. draw_circle). The region may have holes; the far side need not be parallel.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "point": {
          "description": "a point inside the region, mm",
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "normal": {
          "description": "optional face normal",
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        }
      },
      "required": [
        "point"
      ]
    }
  },
  {
    "name": "add_text",
    "description": "Put text on a face, centred at a point: depth > 0 embosses (raised letters), depth < 0 engraves, 0 only draws the letter outlines. Blocky 5×7 font (A–Z, 0–9, '-', '.') plus vector symbols typed as {name} anywhere in the line — {triskele} (three spiral arms), {spiral} (one even spiral), {swirl} (a hand-drawn spiral silhouette); a symbol is a square of the text height and needs depth + or −; on vertical faces the text reads upright, on horizontal faces along +X. wrap {axis_point, axis} bends the letters around a cylinder wall (outer or inner) so the depth stays even along the line — use it on round walls, where a flat block would sink at the ends; normal then points along the radius, the axis is parallel to the wall. project: true lays the text on a plane through center facing normal and projects every letter point along -normal from that plane onto the first face it meets (like projecting a sketch): seen from the normal side the text looks flat, on any curved surface (the bottom of a cone, a dome); depth is along the local surface normal. Put the plane just above the target surface: anything above the plane (fins, ribs, other text) is not hit. depth 0 with wrap or project draws the letter outlines as lines on the curved surface (a text sketch, no volume); then extrude_text raises or engraves any single letter of it, or the whole line.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "center": {
          "description": "centre of the text on the face, mm",
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "normal": {
          "description": "outward normal of that face",
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "text": {
          "type": "string"
        },
        "height": {
          "type": "number",
          "description": "letter height, mm (≥ 3)"
        },
        "depth": {
          "type": "number",
          "description": "mm: + raised, − engraved, 0 outline"
        },
        "project": {
          "type": "boolean",
          "description": "project the text onto the surface along -normal (seen from the normal side it stays flat)"
        },
        "rotate": {
          "type": "number",
          "description": "degrees, with project: turns the line in its plane counter-clockwise as seen from the normal side (-10 = 10° clockwise)"
        },
        "wrap": {
          "type": "object",
          "description": "cylinder to wrap around: axis_point and axis direction (default [0, 0, 1])",
          "properties": {
            "axis_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
            "axis": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}
          },
          "required": ["axis_point"]
        }
      },
      "required": [
        "center",
        "normal",
        "text",
        "height",
        "depth"
      ]
    }
  },
  {
    "name": "export_3mf",
    "description": "Export the model as 3MF (millimetres, accepted by PrusaSlicer, Bambu Studio, Orca, Cura). The whole ZeroCAD project (lines, points, hard edges) rides inside, so import_3mf or Open… in the editor restores it fully; slicers ignore that part. The server saves the file to its exports folder and returns the path.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "file name without extension (letters, digits, - and _), default: project name"
        }
      },
      "required": []
    }
  },
  {
    "name": "open_project",
    "description": "Open a ZeroCAD project (.zcad, written by save_file or the File menu), replacing the current model: mesh, lines, part names and the parametric history — continue with get_history / edit_step.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {"type": "string", "description": "absolute path to a .zcad file, or a bare file name in the server's exports folder (where save_file writes)"}
      },
      "required": ["path"]
    }
  },
  {
    "name": "import_3mf",
    "description": "Open a 3MF file, replacing the current model (undo brings it back). A 3MF written by ZeroCAD opens as the full project; one from another program (or edited there) opens as its mesh, converted to mm from its unit, with component transforms applied. Answer says opened: project or mesh.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "absolute path to a .3mf file, or a bare file name in the server's exports folder (where export_3mf writes)"
        }
      },
      "required": ["path"]
    }
  },
  {
    "name": "trace_car",
    "description": "Turn on Trace (car) mode and set the car's bounding box in mm: reference photo planes stand on that box. preset picks a standard body size (City car, Hatchback, Sedan, SUV medium, SUV large, Van small, Van medium, Van large, Wagon, Coupe, Pickup). The car stands on the ground: X is width, +Y is the nose, Z is height, origin at the centre of the wheelbase on the tarmac.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "preset": {"type": "string"},
        "length": {"type": "number", "description": "mm along Y"},
        "width": {"type": "number", "description": "mm along X"},
        "height": {"type": "number", "description": "mm along Z"},
        "view": {"type": "string", "enum": ["front", "rear", "left", "right", "top", "bottom"], "description": "also jump to this orthographic view"},
        "on": {"type": "boolean", "description": "default true"}
      },
      "required": []
    }
  },
  {
    "name": "trace_reference",
    "description": "Put a photo on one of the six reference planes and calibrate it. path is an image file (png/jpg) the server reads. width is how many mm of the car the photo spans across the plane (for a side view: the car's length), shift_u / shift_v move the photo inside the plane, opacity 0.05…1. Draw over the photo with the ordinary tools, then export_glb.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "view": {"type": "string", "enum": ["front", "rear", "left", "right", "top", "bottom"]},
        "path": {"type": "string", "description": "absolute path to a png/jpg, or a bare file name in the server's exports folder"},
        "width": {"type": "number", "description": "mm the photo spans along the plane"},
        "opacity": {"type": "number"},
        "shift_u": {"type": "number", "description": "mm, right in the photo's own plane"},
        "shift_v": {"type": "number", "description": "mm, up in the photo's own plane"},
        "flip": {"type": "boolean", "description": "mirror the photo"}
      },
      "required": ["view"]
    }
  },
  {
    "name": "draw_curve",
    "description": "Draw a smooth curve (Bezier) through the given points — the same builder as the Pen tool (G,P). By default the curve is smoothed with Catmull-Rom tangents and cut into chords no further than tolerance mm from the true curve; smooth: false joins the points with straight lines. Use it to trace a car silhouette over a reference photo: keep every point in the plane of that photo.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "points": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}, "minItems": 2},
        "closed": {"type": "boolean", "description": "close the curve into a loop"},
        "smooth": {"type": "boolean", "description": "default true"},
        "tension": {"type": "number", "description": "how far the tangents reach, default 0.333"},
        "tolerance": {"type": "number", "description": "mm, max distance from chord to curve, default 0.4"},
        "on_face": {"type": "boolean", "description": "cut the chords into the face they lie on, default true"}
      },
      "required": ["points"]
    }
  },
  {
    "name": "bend_line",
    "description": "Bend a drawn straight line into an arc through its own ends and a handle point — the same thing as holding Alt and dragging a point placed on that line. The line is replaced by chords of the arc (no further than 0.05 mm from the true arc) and they are cut into the face, so the face splits along the arc.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "any point on the line, mm"},
        "through": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "the point the arc must pass through, mm — keep it in the plane of the face"}
      },
      "required": ["point", "through"]
    }
  },
  {
    "name": "name_part",
    "description": "Name the part of the body under a point, or place a hotspot there. Names are the IEGarage contract: body-main, hood, roof, trunk, door-front-l/r, door-rear-l/r, door-sliding, windshield, window-rear, window-side-l/r, wheel-fl/fr/rl/rr, headlight-l/r, taillight-l/r, turnsignal-l/r, bumper-front/rear, mirror-l/r, wipers, fuel-cap-l/r; hotspots: hotspot-engine, hotspot-battery, hotspot-oil-fill, hotspot-air-filter, hotspot-brakes-front, hotspot-brakes-rear, hotspot-wipers. Each name becomes a node in export_glb.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {"type": "string"},
        "point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "mm; for a part — a point on its face, for a hotspot — where the marker goes"}
      },
      "required": ["name", "point"]
    }
  },
  {
    "name": "export_glb",
    "description": "Export the model as GLB (glTF 2.0 binary) for Three.js viewers such as IEGarage: metres (1 unit = 1 m), Y up, the car's nose along -Z. Named parts become separate nodes (body-main, hood, wheel-fl...), hotspots become empty nodes with a position. The server saves the file to its exports folder and returns the path.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "file name without extension (letters, digits, - and _), default: project name"
        }
      },
      "required": []
    }
  },
  {
    "name": "save_file",
    "description": "Save the model to a file — the same as the File menu. format: zcad (the ZeroCAD project: mesh, lines, names — opens back with Open project), stl (printing), 3mf (printing; also carries the project inside and opens back with import_3mf), glb (three.js), obj, step (faceted AP214 solid; needs a closed mesh). The server writes it to its exports folder and returns the path, size and whether the mesh is printable.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "format": {"type": "string", "enum": ["zcad", "stl", "3mf", "glb", "obj", "step"]},
        "name": {"type": "string", "description": "file name without extension (letters, digits, - and _), default: project name"}
      },
      "required": ["format"]
    }
  },
  {
    "name": "export_stl",
    "description": "Export the model as a binary STL (millimetres) for 3D printing. The server saves it to its exports folder and returns the file path; the answer says whether the mesh is printable (closed, no edges shared by 3+ triangles).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "file name without extension (letters, digits, - and _), default: project name"
        }
      },
      "required": []
    }
  },
  {
    "name": "bevel_edges",
    "description": "Chamfer (segments = 1) or round/fillet (segments ≥ 2) straight convex edges of the body — the same tool as Ctrl+B. Each edge is given by a point on it (not at a corner). size is the setback along each face from the edge; on a 90° edge the fillet radius equals size.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "points": {
          "type": "array",
          "items": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          "description": "one point on each edge, mm"
        },
        "size": {
          "type": "number",
          "description": "mm, setback along the faces"
        },
        "segments": {
          "type": "integer",
          "description": "1 — chamfer, 2–32 — round (default 8)"
        }
      },
      "required": [
        "points",
        "size"
      ]
    }
  },
  {
    "name": "bevel_outline",
    "description": "Chamfer (segments = 1, default) or round (segments ≥ 2) whole outlines of a face — straight edges and arcs together, e.g. the top edge of a box with rounded corners or the rims of holes. outlines: outer (default), holes, or all. The walls along the outline should be perpendicular to the face and taller than size.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "point": {
          "description": "a point on the face, mm",
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "normal": {
          "description": "optional face normal",
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "size": {
          "type": "number",
          "description": "mm: inset on the face and drop on the walls"
        },
        "segments": {
          "type": "integer",
          "description": "1 — chamfer (default), 2–32 — round"
        },
        "outlines": {
          "type": "string",
          "enum": [
            "outer",
            "holes",
            "all"
          ],
          "description": "which outlines, default outer"
        }
      },
      "required": [
        "point",
        "size"
      ]
    }
  },
  {
    "name": "undo",
    "description": "Undo the last step (the same history as Ctrl+Z).",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "cut_plane",
    "description": "Slice the body with a plane and remove everything on the side the normal points to (like Split Body + delete in Fusion). Useful to cut corners at any angle, e.g. a tetrahedron from a cube.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "point": {
          "description": "a point on the cutting plane, mm",
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "normal": {
          "description": "points to the part to remove",
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        }
      },
      "required": [
        "point",
        "normal"
      ]
    }
  },
  {
    "name": "add_hole",
    "description": "Drill a hole in a face — the same builder as the user's Hole window (G,D). point: the centre on a face (+ normal when the point is on an edge); the hole goes along the face normal into the body. type simple (default), counterbore (a flat seat for a cheese head) or countersink (a cone for a flat head, angle 90 by default); head_diameter and head_depth (counterbore) or angle (countersink). depth in mm, or through: true to go right through. tip: a 118 degree drill point instead of a flat bottom. Clearance and head sizes for M3…M6 screws: M3 3.4/6.0/6.5x3, M4 4.5/8.0/8.0x4, M5 5.5/10/10x5, M6 6.6/12/11x6 (hole / countersink head / counterbore).",
    "inputSchema": {"type": "object", "properties": {
      "pattern": {"type": "object", "description": "circular pattern of this operation: the solid is built once and cut/added count times around the axis in one step (fins on a wall, holes on a flange). angle 360 (default) spreads them evenly, less goes from 0 to angle inclusive", "properties": {
        "count": {"type": "integer", "description": "2…360, the original included"},
        "axis_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "axis": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "direction, default [0, 0, 1]"},
        "angle": {"type": "number", "description": "degrees, default 360"}
      }, "required": ["count", "axis_point"]},
      "point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "normal": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "diameter": {"type": "number", "description": "mm"},
      "depth": {"type": "number", "description": "mm from the face"},
      "through": {"type": "boolean"},
      "type": {"type": "string", "enum": ["simple", "counterbore", "countersink"]},
      "head_diameter": {"type": "number", "description": "mm"},
      "head_depth": {"type": "number", "description": "mm, counterbore only"},
      "angle": {"type": "number", "description": "degrees, countersink only (default 90)"},
      "tip": {"type": "boolean", "description": "118 degree drill point"},
      "segments": {"type": "integer"}
    }, "required": ["point", "diameter"]}
  },
  {
    "name": "add_frustum",
    "description": "Solid truncated cone (or cylinder when r1 = r2) from point \"from\" (radius r1) to point \"to\" (radius r2). operation: join — merge with the body, cut — subtract it, intersect — keep only what lies inside both (how two blueprint silhouettes are crossed), new — replace the whole model with this solid.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "pattern": {"type": "object", "description": "circular pattern of this operation: the solid is built once and cut/added count times around the axis in one step (fins on a wall, holes on a flange). angle 360 (default) spreads them evenly, less goes from 0 to angle inclusive", "properties": {
        "count": {"type": "integer", "description": "2…360, the original included"},
        "axis_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "axis": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "direction, default [0, 0, 1]"},
        "angle": {"type": "number", "description": "degrees, default 360"}
      }, "required": ["count", "axis_point"]},
        "from": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "to": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "r1": {
          "type": "number",
          "description": "mm at \"from\""
        },
        "r2": {
          "type": "number",
          "description": "mm at \"to\""
        },
        "segments": {
          "type": "integer",
          "description": "3–256, default 48"
        },
        "operation": {
          "type": "string",
          "enum": [
            "join",
            "cut",
            "intersect",
            "new"
          ]
        }
      },
      "required": [
        "from",
        "to",
        "r1",
        "r2"
      ]
    }
  },
  {
    "name": "add_revolve",
    "description": "Solid of revolution (Revolve / lathe): profile [[r, h], ...] is turned around the axis through \"base\" along \"axis\" (default Z). r is the distance from the axis, h the height along it; the profile must start and end on the axis (r = 0) and must not cross itself. Sample curves densely yourself. operation: join, cut, intersect (keep only what lies inside both — crossing two blueprint views) or new.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "pattern": {"type": "object", "description": "circular pattern of this operation: the solid is built once and cut/added count times around the axis in one step (fins on a wall, holes on a flange). angle 360 (default) spreads them evenly, less goes from 0 to angle inclusive", "properties": {
        "count": {"type": "integer", "description": "2…360, the original included"},
        "axis_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "axis": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "direction, default [0, 0, 1]"},
        "angle": {"type": "number", "description": "degrees, default 360"}
      }, "required": ["count", "axis_point"]},
        "profile": {
          "type": "array",
          "items": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 2,
            "maxItems": 2
          },
          "minItems": 3
        },
        "base": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "axis": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "segments": {
          "type": "integer",
          "description": "3–256, default 64"
        },
        "operation": {
          "type": "string",
          "enum": [
            "join",
            "cut",
            "intersect",
            "new"
          ]
        }
      },
      "required": [
        "profile"
      ]
    }
  },
  {
    "name": "add_sweep",
    "description": "Solid tube swept along a path (Sweep / pipe): an ellipse section follows the polyline \"path\" [[x,y,z], ...], ends capped. radius: mm, one number or one per path point; side_radius: the other semi-axis (default = radius), measured along \"side\" (a direction; default chosen automatically). The section is carried along the path without twisting. Sample curves densely and keep the radius below the bend radius. operation: join, cut, intersect (keep only what lies inside both — crossing two blueprint views) or new.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "pattern": {"type": "object", "description": "circular pattern of this operation: the solid is built once and cut/added count times around the axis in one step (fins on a wall, holes on a flange). angle 360 (default) spreads them evenly, less goes from 0 to angle inclusive", "properties": {
        "count": {"type": "integer", "description": "2…360, the original included"},
        "axis_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "axis": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "direction, default [0, 0, 1]"},
        "angle": {"type": "number", "description": "degrees, default 360"}
      }, "required": ["count", "axis_point"]},
        "path": {
          "type": "array",
          "items": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          "minItems": 2
        },
        "radius": {
          "description": "number or array per path point"
        },
        "side_radius": {
          "description": "number or array per path point"
        },
        "side": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "segments": {
          "type": "integer",
          "description": "3–128, default 24"
        },
        "operation": {
          "type": "string",
          "enum": [
            "join",
            "cut",
            "intersect",
            "new"
          ]
        }
      },
      "required": [
        "path",
        "radius"
      ]
    }
  },
  {
    "name": "shell_body",
    "description": "Hollow a body with an even wall — the same as the user's Shell window (G,H). thickness in mm; open_faces: flat faces to remove, each by a point on it (+ normal when the point is on an edge) — a whole flat face opens even if lines split it. No open faces leaves a closed cavity inside. body_point: a point on the body; omit it for the whole model. Fails if the wall is thicker than a thin part of the body.",
    "inputSchema": {"type": "object", "properties": {
      "thickness": {"type": "number"},
      "open_faces": {"type": "array", "items": {"type": "object", "properties": {"point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}, "normal": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}}, "required": ["point"]}},
      "body_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}
    }, "required": ["thickness"]}
  },
  {
    "name": "mirror_body",
    "description": "Mirror a body across a plane — the same as the user's Mirror window (G,I). body_point: a point on the surface of the body (a connected part of the mesh); omit it for the whole model. mode join (default) keeps the original and unites it with the mirrored copy (a half part becomes whole); flip moves the body to the other side. Lines on the body follow it.",
    "inputSchema": {"type": "object", "properties": {
      "plane_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "plane_normal": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "body_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "mode": {"type": "string", "enum": ["join", "flip"]}
    }, "required": ["plane_point", "plane_normal"]}
  },
  {
    "name": "transform_body",
    "description": "Move, scale or rotate a body — the same as the user's Move / Scale window (G,B) plus rotation. rotate {axis, angle (degrees)} turns it around an axis through pivot (default: the centre of the body's bounding box) — 180 around a horizontal axis turns a part upside down for printing. body_point: a point on the surface of the body; omit it for the whole model. move [dx, dy, dz] in mm, or scale (a factor, or [sx, sy, sz]) around pivot (default: the bottom centre of the body's bounding box). copies 0 (default) transforms the body itself; N keeps the original and adds N copies, each one more step further (a linear array; scale allows 1). Copies touching the rest are united with exact booleans.",
    "inputSchema": {"type": "object", "properties": {
      "body_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "move": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "scale": {"description": "factor, or [sx, sy, sz]"},
      "rotate": {"type": "object", "properties": {
        "axis": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "angle": {"type": "number", "description": "degrees, right-hand around axis"}
      }, "required": ["axis", "angle"]},
      "pivot": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "copies": {"type": "integer"}
    }}
  },
  {
    "name": "pattern_body",
    "description": "Circular pattern of a body — the same as the user's G,A on a body: keeps the body and adds copies turned around the axis. body_point: a point on the surface of the body (a connected part of the mesh); omit it for the whole model. count includes the original; angle 360 (default) spreads them evenly, less goes from 0 to angle inclusive. Copies touching the rest are united with exact booleans. To repeat a feature that merges into a wall (fins, holes) use the pattern option of the solid commands instead.",
    "inputSchema": {"type": "object", "properties": {
      "body_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "axis_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "axis": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "direction, default [0, 0, 1]"},
      "count": {"type": "integer", "description": "2…360, the original included"},
      "angle": {"type": "number", "description": "degrees, default 360"}
    }, "required": ["axis_point", "count"]}
  },
  {
    "name": "loft_profiles",
    "description": "Stretch a solid between two flat closed profiles given in 3D — the same builder as the user's Loft tool (G,F): a funnel, an adapter, a neck. Vertices are stitched by the share of the outline length from the closest starting vertex, so the corners of both profiles stay and the walls run straight from one to the other. Both profiles must be flat and not in the same place.",
    "inputSchema": {"type": "object", "properties": {
      "pattern": {"type": "object", "description": "circular pattern of this operation: the solid is built once and cut/added count times around the axis in one step (fins on a wall, holes on a flange). angle 360 (default) spreads them evenly, less goes from 0 to angle inclusive", "properties": {
        "count": {"type": "integer", "description": "2…360, the original included"},
        "axis_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "axis": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "direction, default [0, 0, 1]"},
        "angle": {"type": "number", "description": "degrees, default 360"}
      }, "required": ["count", "axis_point"]},
      "profile_a": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}, "minItems": 3},
      "profile_b": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}, "minItems": 3},
      "operation": {"type": "string", "enum": ["join", "cut", "intersect", "new"], "description": "default join"}
    }, "required": ["profile_a", "profile_b"]}
  },
  {
    "name": "revolve_profile",
    "description": "Revolve a flat closed profile given in 3D around an axis — the same builder as the user's Revolve tool (G,O). The axis must lie in the plane of the profile and the profile on one side of it (points on the axis are fine). |angle| < 360 makes a sector with flat ends.",
    "inputSchema": {"type": "object", "properties": {
      "pattern": {"type": "object", "description": "circular pattern of this operation: the solid is built once and cut/added count times around the axis in one step (fins on a wall, holes on a flange). angle 360 (default) spreads them evenly, less goes from 0 to angle inclusive", "properties": {
        "count": {"type": "integer", "description": "2…360, the original included"},
        "axis_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "axis": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "direction, default [0, 0, 1]"},
        "angle": {"type": "number", "description": "degrees, default 360"}
      }, "required": ["count", "axis_point"]},
      "profile": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}, "minItems": 3},
      "axis_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "axis_direction": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "angle": {"type": "number", "description": "degrees, default 360; negative turns the other way"},
      "segments": {"type": "integer", "description": "per full turn, default 64"},
      "operation": {"type": "string", "enum": ["join", "cut", "intersect", "new"], "description": "default join"}
    }, "required": ["profile", "axis_point", "axis_direction"]}
  },
  {
    "name": "sweep_profile",
    "description": "Sweep a flat closed profile given in 3D along a polyline path — the same builder as the user's Sweep tool (G,W). The profile is carried without twisting from the path end nearest to it; corners are mitred (no sharper than 30°). closed: the path is a loop (no end caps).",
    "inputSchema": {"type": "object", "properties": {
      "pattern": {"type": "object", "description": "circular pattern of this operation: the solid is built once and cut/added count times around the axis in one step (fins on a wall, holes on a flange). angle 360 (default) spreads them evenly, less goes from 0 to angle inclusive", "properties": {
        "count": {"type": "integer", "description": "2…360, the original included"},
        "axis_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "axis": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "direction, default [0, 0, 1]"},
        "angle": {"type": "number", "description": "degrees, default 360"}
      }, "required": ["count", "axis_point"]},
      "profile": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}, "minItems": 3},
      "path": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}, "minItems": 2},
      "closed": {"type": "boolean"},
      "operation": {"type": "string", "enum": ["join", "cut", "intersect", "new"], "description": "default join"}
    }, "required": ["profile", "path"]}
  },
  {
    "name": "move_edge",
    "description": "Move a drawn line or an edge of the body perpendicular to the face it lies on (M, then Shift or N, then a distance in the editor). Pushed into the body (distance < 0) it becomes a V groove: the neighbouring face strips fold in and the wedge is cut out, e.g. a line drawn across a face from edge to edge at mid-height, moved -5.5, notches that face. Pulled outward it raises a ridge. Draw the line first with draw_line.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "point": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3,
          "description": "a point on the line or edge, mm (not at its end)"
        },
        "distance": {
          "type": "number",
          "description": "mm along the face normal: − into the body (V groove), + outward"
        },
        "end": {
          "type": "string",
          "enum": ["face", "straight"],
          "description": "how the groove ends, default face: face lets the ends lean into the neighbouring faces, so the edge slides along them and gets shorter; straight cuts the ends square across the edge, so the edge keeps its length and the neighbouring face gets one more edge"
        }
      },
      "required": [
        "point",
        "distance"
      ]
    }
  },
  {
    "name": "add_pattern",
    "description": "Raise (+) or engrave (−) a decorative band: kind honeycomb (hexagon walls with a frame), honeycomb_relief (solid hexagon tiles, each with its own tilted top — zero at a random corner, depth at the opposite one; seed changes the randomness), meander (Greek key with a frame), triskele (three spiral arms from one centre; whole figures in rows, alternately pointing up and down so they interlock like honeycomb; cell = spacing of the figures, line = stroke, turns = turns of each spiral, default 1.75), symbol (rows of any library symbol, see symbol) or knurl (a grip like on a knurled lathe handle or a barbell; style straight — ribs along the band height, on a cylinder along its axis; diamond — two sets of grooves at ±angle to that axis with diamond pyramids between them; cross — grooves along and across the axis, square pyramids; cell = groove pitch; raised only, line is not used). The band length × height is centred at center on a face facing normal; wrap {axis_point, axis} bends it around a cylinder (it may go almost all the way round; ring: true closes it seamlessly), project: true projects it along -normal from its plane like the text (skip_missing: true lets it skip holes where there is no surface), rotate turns it in its plane (project). cell: hexagon spacing or meander module, mm; line: wall/stroke width, mm.",
    "inputSchema": {"type": "object", "properties": {
      "kind": {"type": "string", "enum": ["honeycomb", "honeycomb_relief", "meander", "triskele", "symbol", "knurl"]},
      "symbol": {"type": "string", "description": "kind symbol: a symbol of the library (the same as {name} in add_text) - triskele, spiral, swirl (a silhouette: its own stroke, line is not used); whole figures in rows, every other row shifted by half a step; cell = spacing, the figure fits a circle of 0.8 cell, line = stroke"},
      "turns": {"type": "number", "description": "triskele: turns of each spiral arm, 0.5…4, default 1.75"},
      "style": {"type": "string", "enum": ["straight", "diamond", "cross"], "description": "knurl: default diamond"},
      "angle": {"type": "number", "description": "knurl diamond: groove angle to the band height (cylinder axis), degrees 10…60, default 30; knurl straight: tilt of the ribs from that axis - 0 along it (default), 90 across (a washboard), 45 slanted"},
      "center": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "normal": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "length": {"type": "number", "description": "band length, mm"},
      "height": {"type": "number", "description": "band height, mm"},
      "cell": {"type": "number", "description": "mm"},
      "line": {"type": "number", "description": "mm"},
      "depth": {"type": "number", "description": "mm, + raised, − engraved"},
      "wrap": {"type": "object", "properties": {"axis_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}, "axis": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}}, "required": ["axis_point"]},
      "project": {"type": "boolean"},
      "skip_missing": {"type": "boolean"},
      "onto_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "with project: project only onto the smooth surface under this point (edges sharper than 20 degrees bound it) - fins, ribs and text above are ignored, so the plane may be anywhere above"},
      "rotate": {"type": "number"},
      "seed": {"type": "integer"},
      "spin": {"type": "string", "enum": ["none", "random"], "description": "kind symbol: random turns every figure by its own angle (seed changes them)"},
      "tilt": {"type": "string", "enum": ["random", "down", "up", "left", "right"], "description": "honeycomb_relief: which way every tile rises - random (default, each its own corner) or the same for all: down = zero at the top vertex, full depth at the bottom (a wedge for testing overhangs)"},
      "fill": {"type": "string", "enum": ["walls", "cells"], "description": "honeycomb: raise/engrave the walls between cells (default) or the hexagons themselves; the inner size of a cell is cell - line"},
      "ring": {"type": "boolean", "description": "with wrap: a closed ring all the way round the wall with no seam - length becomes the circumference and cell is adjusted to a whole number of cells (answer: cell_used_mm, cells_around)"}
    }, "required": ["kind", "center", "normal", "length", "height", "cell", "depth"]}
  },
  {
    "name": "texture_surface",
    "description": "Texture the surface (displacement, like texture tools in slicers): the faces are split down to resolution and every vertex moves along its normal by the texture height times depth. texture: noise (soft relief), voronoi (pebbles with grooves), hex (hexagon tiles), knurl (diamond pyramids), brick, wood, or image (path: a png/jpg/webp height map, bright = high; it tiles). projection: triplanar (default; three planar projections blended by the normal), cubic, cylindrical / spherical (around axis through center; a whole number of tiles fits round, no seam), planar_xy / planar_xz / planar_yz. size (or size_u, size_v) — tile size in mm; rotation (degrees), offset_u / offset_v (tiles). Region: the whole model, or point — the smooth surface under that point; mask_bottom_deg / mask_top_deg leave faces facing down / up within that angle untouched (a flat bottom for the bed); transition (mm, default 1) fades the depth in from the mask edge. depth + raises, − sinks; symmetric goes both ways; invert flips the texture. The mesh stays closed; mind the triangle count (area / resolution² × 2, capped by max_triangles, default 3 M).",
    "inputSchema": {"type": "object", "properties": {
      "texture": {"type": "string", "enum": ["noise", "voronoi", "hex", "knurl", "brick", "wood", "image"]},
      "path": {"type": "string", "description": "texture image: a height map file (absolute or in exports/)"},
      "depth": {"type": "number", "description": "mm"},
      "resolution": {"type": "number", "description": "mm, edge length after splitting, default 0.6"},
      "projection": {"type": "string", "enum": ["triplanar", "cubic", "cylindrical", "spherical", "planar_xy", "planar_xz", "planar_yz"]},
      "size": {"type": "number", "description": "tile size, mm (default 6)"},
      "size_u": {"type": "number"}, "size_v": {"type": "number"},
      "rotation": {"type": "number", "description": "degrees"},
      "offset_u": {"type": "number"}, "offset_v": {"type": "number"},
      "center": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "projection centre (default: the centre of the region)"},
      "axis": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "cylindrical / spherical axis (default Z)"},
      "point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "texture only the smooth surface under this point"},
      "mask_bottom_deg": {"type": "number"}, "mask_top_deg": {"type": "number"},
      "transition": {"type": "number", "description": "mm, fade-in from the mask edge (default 1)"},
      "symmetric": {"type": "boolean"}, "invert": {"type": "boolean"},
      "seed": {"type": "integer"},
      "max_triangles": {"type": "integer"}
    }, "required": ["depth"]}
  },
  {
    "name": "extrude_text",
    "description": "Raise (+) or engrave (−) one letter of a text sketch on a curved surface — the outline drawn by add_text with depth 0 and wrap or project. point: a point on (or at the edge of) the letter on the surface; whole: true takes the whole line. The letter is built from the sketch with the same wrap/projection, so it follows its outline exactly and the depth is along the local surface normal.",
    "inputSchema": {"type": "object", "properties": {
      "point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "distance": {"type": "number", "description": "mm, + raised, − engraved"},
      "whole": {"type": "boolean", "description": "all letters of the sketch"}
    }, "required": ["point", "distance"]}
  },
  {
    "name": "get_history",
    "description": "The parametric history: every model-changing command so far as {index, command, args, status, volume_change_mm3}. Step 0 is new_shape or 'base' — a snapshot of a model without a recipe (imported, or edited by the user's mouse). If the user changed the model by hand after the last command, the history folds into a new 'base' of the current model. failed lists steps that did not apply on the last rebuild.",
    "inputSchema": {"type": "object", "properties": {}, "required": []}
  },
  {
    "name": "edit_step",
    "description": "Change the parameters of a history step and rebuild the model from scratch by replaying all steps (like editing a feature in the Fusion timeline). args: only the keys to change; null removes a key. A step that no longer applies is marked failed and skipped, the rest still run — fix it with another edit_step. One undo reverts the whole rebuild.",
    "inputSchema": {"type": "object", "properties": {
      "index": {"type": "integer"},
      "args": {"type": "object", "description": "parameters to change, e.g. {\"thickness\": 3}"}
    }, "required": ["index", "args"]}
  },
  {
    "name": "delete_step",
    "description": "Remove a history step (not step 0) and rebuild the model from scratch by replaying the rest. One undo reverts the rebuild.",
    "inputSchema": {"type": "object", "properties": {
      "index": {"type": "integer"}
    }, "required": ["index"]}
  },
  {
    "name": "set_view",
    "description": "Turn the user's 3D view — the same as the ViewCube and orbiting: a named view, yaw/pitch, the point to look at, the distance, or fit the whole model. Applied in the order view, yaw/pitch, fit, target, distance. Returns the resulting camera. Does not close the user's open tool.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "view": {"type": "string", "enum": ["home", "iso", "top", "bottom", "front", "back", "left", "right"], "description": "as on the ViewCube: front looks from -Y, right from +X, top from above; home/iso is the isometric start view"},
        "yaw": {"type": "number", "description": "degrees around Z"},
        "pitch": {"type": "number", "description": "degrees above the ground"},
        "target": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "point the camera looks at, mm"},
        "distance": {"type": "number", "description": "camera distance from target, mm"},
        "fit": {"type": "boolean", "description": "frame the whole model (target and distance from its bounding box)"}
      },
      "required": []
    }
  },
  {
    "name": "screenshot",
    "description": "Picture of the 3D view (JPEG). Camera options are the same as set_view and move the user view too; applied in the order view, yaw/pitch, fit, target, distance. section {point, normal} cuts the picture only: the side the normal points to is not drawn, so walls, ribs and fins inside show (inner faces are grey-blue).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "view": {"type": "string", "enum": ["home", "iso", "top", "bottom", "front", "back", "left", "right"], "description": "as on the ViewCube: front looks from -Y, right from +X, top from above; home/iso is the isometric start view"},
        "yaw": {"type": "number", "description": "degrees around Z"},
        "pitch": {"type": "number", "description": "degrees above the ground"},
        "target": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": "point the camera looks at, mm"},
        "distance": {"type": "number", "description": "camera distance from target, mm"},
        "fit": {"type": "boolean", "description": "frame the whole model (target and distance from its bounding box)"},
        "section": {"type": "object", "properties": {
          "point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
          "normal": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}
        }, "required": ["point", "normal"], "description": "cut-away for this picture only"},
        "width": {
          "type": "integer",
          "description": "px, default 1000"
        },
        "height": {
          "type": "integer",
          "description": "px, default 700"
        }
      },
      "required": []
    }
  }
];
