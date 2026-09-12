//! Генерация меша колеса-дозатора: 2D-контур (окружность с V-карманами
//! по периметру + отверстие под вал) -> экструзия на толщину.
//! Никаких булевых операций — только тригонометрия и треугольники.

/// Дискретизация контура: 0.5° на шаг, как в исходном вьюере.
const STEPS: usize = 720;

pub struct WheelParams {
    pub dia: f64,       // диаметр колеса, мм
    pub thk: f64,       // толщина (= ширина ореха), мм
    pub shaft: f64,     // диаметр отверстия под вал, мм
    pub n: u32,         // число карманов
    pub depth: f64,     // глубина кармана, мм
    pub mouth_deg: f64, // угловая ширина устья кармана, градусы
}

impl Default for WheelParams {
    fn default() -> Self {
        WheelParams { dia: 140.0, thk: 11.0, shaft: 5.0, n: 4, depth: 10.0, mouth_deg: 4.0 }
    }
}

impl WheelParams {
    /// Приводим параметры в физически осмысленные рамки.
    pub fn clamped(mut self) -> Self {
        self.dia = self.dia.clamp(10.0, 400.0);
        self.thk = self.thk.clamp(1.0, 100.0);
        self.n = self.n.min(90); // 0 допустим — гладкая заготовка без карманов
        if self.n > 0 {
            self.mouth_deg = self.mouth_deg.clamp(1.0, 360.0 / self.n as f64 - 1.0);
        }
        self.shaft = self.shaft.clamp(0.5, self.dia - 4.0);
        self.depth = self.depth.clamp(0.0, self.dia / 2.0);
        self
    }

    /// Радиус дна кармана (апекс V). Не даём карману прорезаться к валу.
    pub fn apex(&self) -> f64 {
        (self.dia / 2.0 - self.depth).max(self.shaft / 2.0 + 1.0)
    }

    /// Шаг между карманами по ободу, мм (0 — карманов нет).
    pub fn pitch(&self) -> f64 {
        if self.n == 0 {
            return 0.0;
        }
        std::f64::consts::TAU * (self.dia / 2.0) / self.n as f64
    }
}

pub type Tri = [[f32; 3]; 3];

/// Куб со стороной `size`, центр в начале координат. Стартовая фигура для
/// отработки выбора вершин/рёбер/граней: 8 вершин, 12 рёбер, 6 граней.
pub fn build_cube(size: f64) -> Vec<Tri> {
    // как Part Box во FreeCAD: угол в начале координат, рост в +X+Y+Z
    let s = size as f32;
    let p = [
        [0.0, 0.0, 0.0], [s, 0.0, 0.0], [s, s, 0.0], [0.0, s, 0.0],
        [0.0, 0.0,   s], [s, 0.0,   s], [s, s,   s], [0.0, s,   s],
    ];
    // грани CCW при взгляде снаружи
    let quads = [
        [0usize, 3, 2, 1], // низ  (-Z)
        [4, 5, 6, 7],      // верх (+Z)
        [0, 1, 5, 4],      // перед (-Y)
        [2, 3, 7, 6],      // зад  (+Y)
        [1, 2, 6, 5],      // право (+X)
        [3, 0, 4, 7],      // лево (-X)
    ];
    let mut tris = Vec::with_capacity(12);
    for q in quads {
        tris.push([p[q[0]], p[q[1]], p[q[2]]]);
        tris.push([p[q[0]], p[q[2]], p[q[3]]]);
    }
    tris
}

/// Радиус контура на угле `a`: снаружи R, внутри устья кармана — V-провал к апексу.
fn contour_r(p: &WheelParams, a: f64) -> f64 {
    let r_out = p.dia / 2.0;
    if p.n == 0 {
        return r_out; // без карманов — гладкий диск
    }
    let apex = p.apex();
    let hw = p.mouth_deg.to_radians() / 2.0; // угловой полу-размер устья
    let sector = std::f64::consts::TAU / p.n as f64;
    let mut d = a % sector;
    if d > sector / 2.0 {
        d -= sector; // -sector/2..sector/2, центр кармана = 0
    }
    if d.abs() < hw {
        // Стенки кармана — ПРЯМЫЕ: берём пересечение луча с отрезком
        // «точка устья -> апекс». Линейная зависимость радиуса от угла
        // (как было) даёт дугу, а нужна честная буква V, врезанная в диск.
        let (s_hw, c_hw) = hw.sin_cos();
        let (mx, my) = (r_out * c_hw, r_out * s_hw); // точка устья на ободе
        let (s_d, c_d) = d.abs().sin_cos();
        let den = c_d * my - s_d * (mx - apex);
        if den.abs() < 1e-12 {
            r_out
        } else {
            (apex * my / den).clamp(apex.min(r_out), r_out)
        }
    } else {
        r_out
    }
}

/// Кольцевых поясов в триангуляции крышек. Мелкие ячейки вместо длинных
/// «долек» от вала до обода — локальные правки меша (врезка линий,
/// выдавливание областей) работают чисто.
const CAP_RINGS: usize = 8;

/// Строит замкнутый меш колеса. Обход: две крышки (кольцевые пояса между
/// валом и контуром), внешняя стенка по контуру, внутренняя стенка отверстия.
pub fn build_wheel(p: &WheelParams) -> Vec<Tri> {
    let rs = p.shaft / 2.0;
    // деталь стоит на рабочей плоскости: z от 0 до толщины (как Pad во FreeCAD)
    let z0 = 0.0;
    let z1 = p.thk;

    // Кольцевые точки на общей угловой сетке: пояс 0 — вал, пояс CAP_RINGS — контур.
    let mut rings = vec![[(0.0f64, 0.0f64); STEPS]; CAP_RINGS + 1];
    for i in 0..STEPS {
        let a = std::f64::consts::TAU * i as f64 / STEPS as f64;
        let (s, c) = a.sin_cos();
        let r_out = contour_r(p, a);
        for (k, ring) in rings.iter_mut().enumerate() {
            let r = rs + (r_out - rs) * k as f64 / CAP_RINGS as f64;
            ring[i] = (c * r, s * r);
        }
    }

    let v = |xy: (f64, f64), z: f64| [xy.0 as f32, xy.1 as f32, z as f32];
    let mut tris: Vec<Tri> = Vec::with_capacity(STEPS * (CAP_RINGS * 4 + 4));

    // крышки: квады между соседними поясами
    for k in 0..CAP_RINGS {
        let (rin, rout) = (&rings[k], &rings[k + 1]);
        for i in 0..STEPS {
            let j = (i + 1) % STEPS;
            let (it, ot) = (v(rin[i], z1), v(rout[i], z1));
            let (jt, pt) = (v(rin[j], z1), v(rout[j], z1));
            let (ib, ob) = (v(rin[i], z0), v(rout[i], z0));
            let (jb, pb) = (v(rin[j], z0), v(rout[j], z0));
            // верхняя (нормаль +Z), нижняя (нормаль -Z)
            tris.push([it, ot, pt]);
            tris.push([it, pt, jt]);
            tris.push([ib, pb, ob]);
            tris.push([ib, jb, pb]);
        }
    }
    // стенки
    let (inner, outer) = (&rings[0], &rings[CAP_RINGS]);
    for i in 0..STEPS {
        let j = (i + 1) % STEPS;
        let (it, ot) = (v(inner[i], z1), v(outer[i], z1));
        let (jt, pt) = (v(inner[j], z1), v(outer[j], z1));
        let (ib, ob) = (v(inner[i], z0), v(outer[i], z0));
        let (jb, pb) = (v(inner[j], z0), v(outer[j], z0));
        // внешняя стенка (нормаль наружу)
        tris.push([ob, pb, pt]);
        tris.push([ob, pt, ot]);
        // стенка отверстия (нормаль к оси)
        tris.push([ib, it, jt]);
        tris.push([ib, jt, jb]);
    }
    tris
}
