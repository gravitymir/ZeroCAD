//! Ступень 2 лесенки: колесо через НАСТОЯЩИЕ булевы операции (csgrs).
//! Строим как на станке: диск − вал − N V-призм. Универсальный путь —
//! так можно вычитать что угодно под любым углом, не только радиальные V.
//! Плата за универсальность — скорость (BSP-булевы вместо прямой генерации).

use crate::geometry::{Tri, WheelParams};
use csgrs::mesh::Mesh;
use csgrs::traits::CSG;

/// Сегментация окружности диска. У своего генератора 720 (0.5°); BSP-булевы
/// на такой плотности взрываются по времени, 256 хватает для печати.
const SEGMENTS: usize = 256;

pub fn build_wheel_csg(p: &WheelParams) -> Vec<Tri> {
    let r = p.dia / 2.0;
    let apex = p.apex();
    let hw = p.mouth_deg.to_radians() / 2.0;

    let disk: Mesh<()> = Mesh::cylinder(r, p.thk, SEGMENTS, None);
    // вал протыкает насквозь с запасом по 1 мм с каждой стороны
    let shaft: Mesh<()> =
        Mesh::cylinder(p.shaft / 2.0, p.thk + 2.0, 64, None).translate(0.0, 0.0, -1.0);
    let mut wheel = disk.difference(&shaft);

    for i in 0..p.n {
        let a = std::f64::consts::TAU * f64::from(i) / f64::from(p.n);
        let (sa, ca) = a.sin_cos();
        let (sb, cb) = (a - hw).sin_cos();
        let (sc, cc) = (a + hw).sin_cos();
        // V в 2D: апекс + две точки устья на ободе...
        let apex_pt = (ca * apex, sa * apex);
        let b = (cb * r, sb * r);
        let c = (cc * r, sc * r);
        // ...стенки продлеваем за обод (k>1), чтобы срез захватил кромку
        let k = 1.6;
        let b_ext = (apex_pt.0 + (b.0 - apex_pt.0) * k, apex_pt.1 + (b.1 - apex_pt.1) * k);
        let c_ext = (apex_pt.0 + (c.0 - apex_pt.0) * k, apex_pt.1 + (c.1 - apex_pt.1) * k);
        let wedge = prism(&[apex_pt, b_ext, c_ext], -1.0, p.thk + 2.0);
        wheel = wheel.difference(&wedge);
    }

    // в систему координат своего генератора: середина толщины в z=0
    to_tris(&wheel.translate(0.0, 0.0, -p.thk / 2.0))
}

/// Треугольная призма по 2D-основанию, z от `z0` на высоту `h`.
fn prism(base: &[(f64, f64); 3], z0: f64, h: f64) -> Mesh<()> {
    let mut t = *base;
    // основание должно обходиться против часовой, иначе нормали внутрь
    let area2 = (t[1].0 - t[0].0) * (t[2].1 - t[0].1) - (t[2].0 - t[0].0) * (t[1].1 - t[0].1);
    if area2 < 0.0 {
        t.swap(1, 2);
    }
    let z1 = z0 + h;
    let points: Vec<[f64; 3]> = t
        .iter()
        .map(|&(x, y)| [x, y, z0])
        .chain(t.iter().map(|&(x, y)| [x, y, z1]))
        .collect();
    // нижняя крышка (обход по часовой снизу = наружу), верхняя, три боковины
    let faces: [&[usize]; 5] = [&[0, 2, 1], &[3, 4, 5], &[0, 1, 4, 3], &[1, 2, 5, 4], &[2, 0, 3, 5]];
    Mesh::polyhedron(&points, &faces, None).expect("валидная призма")
}

fn to_tris(mesh: &Mesh<()>) -> Vec<Tri> {
    mesh.triangulate()
        .polygons
        .iter()
        .map(|poly| {
            let v = &poly.vertices;
            [
                [v[0].pos.x as f32, v[0].pos.y as f32, v[0].pos.z as f32],
                [v[1].pos.x as f32, v[1].pos.y as f32, v[1].pos.z as f32],
                [v[2].pos.x as f32, v[2].pos.y as f32, v[2].pos.z as f32],
            ]
        })
        .collect()
}
