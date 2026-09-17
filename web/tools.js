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
    "description": "Start a new model from a preset shape, replacing the current model. size is the cube side or the gear/sphere diameter in mm. Note: \"gear\" is the peanut dispenser wheel this project started from — a disc with a central shaft bore and 4 V-shaped pockets in the rim. It is NOT a toothed gear; there is no involute tooth generator. Build a toothed gear from add_revolve plus a polar set of cut_through.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "shape": {
          "type": "string",
          "enum": [
            "cube",
            "gear",
            "sphere",
            "pyramid"
          ],
          "description": "cube: corner at the origin, spans 0..size on each axis. gear: dispenser wheel with pockets, centred on the Z axis. sphere/pyramid: sit on the ground plane."
        },
        "size": {
          "type": "number",
          "description": "mm"
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
    "description": "Put text on a face, centred at a point: depth > 0 embosses (raised letters), depth < 0 engraves, 0 only draws the letter outlines. Blocky 5×7 font; on vertical faces the text reads upright, on horizontal faces along +X.",
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
    "name": "add_frustum",
    "description": "Solid truncated cone (or cylinder when r1 = r2) from point \"from\" (radius r1) to point \"to\" (radius r2). operation: join — merge with the body, cut — subtract it, new — replace the whole model with this solid.",
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
    "description": "Solid of revolution (Revolve / lathe): profile [[r, h], ...] is turned around the axis through \"base\" along \"axis\" (default Z). r is the distance from the axis, h the height along it; the profile must start and end on the axis (r = 0) and must not cross itself. Sample curves densely yourself. operation: join, cut or new.",
    "inputSchema": {
      "type": "object",
      "properties": {
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
    "description": "Solid tube swept along a path (Sweep / pipe): an ellipse section follows the polyline \"path\" [[x,y,z], ...], ends capped. radius: mm, one number or one per path point; side_radius: the other semi-axis (default = radius), measured along \"side\" (a direction; default chosen automatically). The section is carried along the path without twisting. Sample curves densely and keep the radius below the bend radius. operation: join, cut or new.",
    "inputSchema": {
      "type": "object",
      "properties": {
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
    "description": "Move or scale a body — the same as the user's Move / Scale window (G,B). body_point: a point on the surface of the body; omit it for the whole model. move [dx, dy, dz] in mm, or scale (a factor, or [sx, sy, sz]) around pivot (default: the bottom centre of the body's bounding box). copies 0 (default) transforms the body itself; N keeps the original and adds N copies, each one more step further (a linear array; scale allows 1). Copies touching the rest are united with exact booleans.",
    "inputSchema": {"type": "object", "properties": {
      "body_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "move": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "scale": {"description": "factor, or [sx, sy, sz]"},
      "pivot": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "copies": {"type": "integer"}
    }}
  },
  {
    "name": "revolve_profile",
    "description": "Revolve a flat closed profile given in 3D around an axis — the same builder as the user's Revolve tool (G,O). The axis must lie in the plane of the profile and the profile on one side of it (points on the axis are fine). |angle| < 360 makes a sector with flat ends.",
    "inputSchema": {"type": "object", "properties": {
      "profile": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}, "minItems": 3},
      "axis_point": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "axis_direction": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
      "angle": {"type": "number", "description": "degrees, default 360; negative turns the other way"},
      "segments": {"type": "integer", "description": "per full turn, default 64"},
      "operation": {"type": "string", "enum": ["join", "cut", "new"], "description": "default join"}
    }, "required": ["profile", "axis_point", "axis_direction"]}
  },
  {
    "name": "sweep_profile",
    "description": "Sweep a flat closed profile given in 3D along a polyline path — the same builder as the user's Sweep tool (G,W). The profile is carried without twisting from the path end nearest to it; corners are mitred (no sharper than 30°). closed: the path is a loop (no end caps).",
    "inputSchema": {"type": "object", "properties": {
      "profile": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}, "minItems": 3},
      "path": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}, "minItems": 2},
      "closed": {"type": "boolean"},
      "operation": {"type": "string", "enum": ["join", "cut", "new"], "description": "default join"}
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
        }
      },
      "required": [
        "point",
        "distance"
      ]
    }
  },
  {
    "name": "screenshot",
    "description": "Picture of the 3D view (JPEG). fit: frame the whole model first (moves the user view too); yaw/pitch in degrees turn the camera.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "fit": {
          "type": "boolean"
        },
        "yaw": {
          "type": "number",
          "description": "degrees around Z"
        },
        "pitch": {
          "type": "number",
          "description": "degrees above the ground"
        },
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
