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
        WheelParams { dia: 70.0, thk: 11.0, shaft: 5.0, n: 12, depth: 6.0, mouth_deg: 11.0 }
    }
}

impl WheelParams {
    /// Приводим параметры в физически осмысленные рамки.
    pub fn clamped(mut self) -> Self {
        self.dia = self.dia.clamp(10.0, 400.0);
        self.thk = self.thk.clamp(1.0, 100.0);
        self.n = self.n.clamp(1, 90);
        self.mouth_deg = self.mouth_deg.clamp(1.0, 360.0 / self.n as f64 - 1.0);
        self.shaft = self.shaft.clamp(0.5, self.dia - 4.0);
        self.depth = self.depth.clamp(0.0, self.dia / 2.0);
        self
    }

    /// Радиус дна кармана (апекс V). Не даём карману прорезаться к валу.
    pub fn apex(&self) -> f64 {
        (self.dia / 2.0 - self.depth).max(self.shaft / 2.0 + 1.0)
    }

    /// Шаг между карманами по ободу, мм.
    pub fn pitch(&self) -> f64 {
        std::f64::consts::TAU * (self.dia / 2.0) / self.n as f64
    }
}

pub type Tri = [[f32; 3]; 3];

/// Радиус контура на угле `a`: снаружи R, внутри устья кармана — V-провал к апексу.
fn contour_r(p: &WheelParams, a: f64) -> f64 {
    let r_out = p.dia / 2.0;
    let apex = p.apex();
    let hw = p.mouth_deg.to_radians() / 2.0; // угловой полу-размер устья
    let sector = std::f64::consts::TAU / p.n as f64;
    let mut d = a % sector;
    if d > sector / 2.0 {
        d -= sector; // -sector/2..sector/2, центр кармана = 0
    }
    if d.abs() < hw {
        r_out - (r_out - apex) * (1.0 - d.abs() / hw)
    } else {
        r_out
    }
}

/// Строит замкнутый меш колеса. Обход: две крышки (кольцевые ленты между
/// валом и контуром), внешняя стенка по контуру, внутренняя стенка отверстия.
pub fn build_wheel(p: &WheelParams) -> Vec<Tri> {
    let rs = p.shaft / 2.0;
    let hz = p.thk / 2.0;

    // Точки контура и отверстия на одинаковой угловой сетке.
    let mut outer = [(0.0f64, 0.0f64); STEPS];
    let mut inner = [(0.0f64, 0.0f64); STEPS];
    for i in 0..STEPS {
        let a = std::f64::consts::TAU * i as f64 / STEPS as f64;
        let (s, c) = a.sin_cos();
        let r = contour_r(p, a);
        outer[i] = (c * r, s * r);
        inner[i] = (c * rs, s * rs);
    }

    let v = |xy: (f64, f64), z: f64| [xy.0 as f32, xy.1 as f32, z as f32];
    let mut tris: Vec<Tri> = Vec::with_capacity(STEPS * 8);

    for i in 0..STEPS {
        let j = (i + 1) % STEPS;
        let (it, ot) = (v(inner[i], hz), v(outer[i], hz));
        let (jt, pt) = (v(inner[j], hz), v(outer[j], hz));
        let (ib, ob) = (v(inner[i], -hz), v(outer[i], -hz));
        let (jb, pb) = (v(inner[j], -hz), v(outer[j], -hz));

        // верхняя крышка (нормаль +Z, обход против часовой при взгляде сверху)
        tris.push([it, ot, pt]);
        tris.push([it, pt, jt]);
        // нижняя крышка (нормаль -Z)
        tris.push([ib, pb, ob]);
        tris.push([ib, jb, pb]);
        // внешняя стенка (нормаль наружу)
        tris.push([ob, pb, pt]);
        tris.push([ob, pt, ot]);
        // стенка отверстия (нормаль к оси)
        tris.push([ib, it, jt]);
        tris.push([ib, jt, jb]);
    }
    tris
}
