//! Запись STL. Бинарный формат: 80 байт заголовка, u32 число треугольников,
//! далее на каждый: нормаль (3×f32), три вершины (9×f32), u16 атрибут.

use crate::geometry::Tri;

fn normal(t: &Tri) -> [f32; 3] {
    let e1 = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]];
    let e2 = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]];
    let n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
    ];
    let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
    if len > 0.0 { [n[0] / len, n[1] / len, n[2] / len] } else { [0.0, 0.0, 0.0] }
}

pub fn to_binary(name: &str, tris: &[Tri]) -> Vec<u8> {
    let mut out = Vec::with_capacity(84 + tris.len() * 50);
    let mut header = [0u8; 80];
    let tag = name.as_bytes();
    header[..tag.len().min(80)].copy_from_slice(&tag[..tag.len().min(80)]);
    out.extend_from_slice(&header);
    out.extend_from_slice(&(tris.len() as u32).to_le_bytes());
    for t in tris {
        for f in normal(t) {
            out.extend_from_slice(&f.to_le_bytes());
        }
        for vtx in t {
            for f in vtx {
                out.extend_from_slice(&f.to_le_bytes());
            }
        }
        out.extend_from_slice(&0u16.to_le_bytes());
    }
    out
}

#[allow(dead_code)]
pub fn to_ascii(name: &str, tris: &[Tri]) -> String {
    let mut s = format!("solid {name}\n");
    for t in tris {
        let n = normal(t);
        s += &format!(" facet normal {} {} {}\n  outer loop\n", n[0], n[1], n[2]);
        for vtx in t {
            s += &format!("   vertex {} {} {}\n", vtx[0], vtx[1], vtx[2]);
        }
        s += "  endloop\n endfacet\n";
    }
    s += &format!("endsolid {name}\n");
    s
}
