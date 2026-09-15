//! ZeroCAD — параметрический CAD-сервер на чистом Rust (ноль зависимостей).
//! Редактор целиком живёт в браузере (web/: те же файлы — и расширение
//! браузера); сервер отдаёт его и держит резервный движок csgrs.
//!
//!   GET /                    -> страница (web/index.html, вшита в бинарник)
//!   GET /app.js              -> редактор: ядро, команды, интерфейс
//!   GET /vendor/three.min.js -> three.js r128 (локально: расширениям CDN нельзя)
//!   GET /api/wheel.stl?...   -> бинарный STL с параметрами из query
//!
//! Параметры query: dia, thk, shaft, n, depth, mouth (дефолты — в geometry.rs).

mod csg;
mod geometry;
mod stl;

use geometry::WheelParams;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};

const INDEX_HTML: &str = include_str!("../web/index.html");
const APP_JS: &str = include_str!("../web/app.js");
const THREE_JS: &str = include_str!("../web/vendor/three.min.js");
const BUILD: &str = env!("ZEROCAD_BUILD");

fn main() {
    // порт из переменной окружения PORT (например, для параллельного
    // дебаг-запуска), по умолчанию 9000
    let port = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(9000);
    let addr = format!("127.0.0.1:{port}");
    let listener = TcpListener::bind(&addr).unwrap_or_else(|e| {
        eprintln!("не удалось занять {addr}: {e}");
        std::process::exit(1);
    });
    println!("ZeroCAD {BUILD}: http://{addr}");
    for stream in listener.incoming().flatten() {
        std::thread::spawn(|| handle(stream));
    }
}

fn handle(stream: TcpStream) {
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    // дочитываем заголовки; у POST запоминаем длину тела
    let mut line = String::new();
    let mut content_length = 0usize;
    while reader.read_line(&mut line).is_ok() && line.trim() != "" {
        if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            content_length = v.trim().parse().unwrap_or(0);
        }
        line.clear();
    }
    // тело (для /api/bool): бинарный формат, читаем ровно content_length байт
    let mut body = vec![0u8; content_length.min(64 * 1024 * 1024)];
    if content_length > 0 {
        use std::io::Read;
        if reader.read_exact(&mut body).is_err() {
            return;
        }
    }
    let mut stream = reader.into_inner();

    let target = request_line.split_whitespace().nth(1).unwrap_or("/");
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p, q),
        None => (target, ""),
    };

    match path {
        "/" | "/index.html" => {
            let page = INDEX_HTML.replace("__BUILD__", BUILD);
            respond(
                &mut stream,
                "200 OK",
                "text/html; charset=utf-8",
                &[],
                page.as_bytes(),
            );
        }
        "/app.js" => respond(
            &mut stream,
            "200 OK",
            "text/javascript; charset=utf-8",
            &[],
            APP_JS.as_bytes(),
        ),
        "/vendor/three.min.js" => respond(
            &mut stream,
            "200 OK",
            "text/javascript; charset=utf-8",
            &[],
            THREE_JS.as_bytes(),
        ),
        "/api/wheel.stl" => {
            let p = params_from_query(query);
            let use_csg = query.split('&').any(|kv| kv == "engine=csg");
            let cube = query.split('&').any(|kv| kv == "shape=cube");
            let mut size = 40.0f64;
            for pair in query.split('&') {
                if let Some(v) = pair.strip_prefix("size=") {
                    if let Ok(x) = v.parse::<f64>() {
                        size = x.clamp(2.0, 400.0);
                    }
                }
            }
            let started = std::time::Instant::now();
            let tris = if cube {
                geometry::build_cube(size)
            } else if use_csg {
                csg::build_wheel_csg(&p)
            } else {
                geometry::build_wheel(&p)
            };
            let body = stl::to_binary("zerocad_wheel", &tris);
            let extra = [
                format!("X-Apex-Mm: {:.2}", p.apex()),
                format!("X-Pitch-Mm: {:.2}", p.pitch()),
                format!("X-Gen-Us: {}", started.elapsed().as_micros()),
                "Content-Disposition: inline; filename=\"wheel.stl\"".to_string(),
            ];
            respond(&mut stream, "200 OK", "model/stl", &extra, &body);
        }
        // булева операция ядром csgrs: тело A минус (или плюс) тело B.
        // Формат бинарный: [u32 nA][nA*9 f32][u32 nB][nB*9 f32] -> [u32 n][n*9 f32]
        "/api/bool" => {
            let union = query.split('&').any(|kv| kv == "op=union");
            let started = std::time::Instant::now();
            match parse_two_meshes(&body) {
                Some((a, b)) => {
                    let out = csg::boolean(&a, &b, union);
                    let mut resp = Vec::with_capacity(4 + out.len() * 36);
                    resp.extend_from_slice(&(out.len() as u32).to_le_bytes());
                    for t in &out {
                        for v in t {
                            for c in v {
                                resp.extend_from_slice(&c.to_le_bytes());
                            }
                        }
                    }
                    let extra = [format!("X-Gen-Us: {}", started.elapsed().as_micros())];
                    respond(&mut stream, "200 OK", "application/octet-stream", &extra, &resp);
                }
                None => respond(
                    &mut stream,
                    "400 Bad Request",
                    "text/plain; charset=utf-8",
                    &[],
                    b"bad mesh payload",
                ),
            }
        }
        _ => respond(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            &[],
            b"404",
        ),
    }
}

/// Разбор тела /api/bool: два меша подряд, каждый — u32-счётчик и треугольники.
fn parse_two_meshes(body: &[u8]) -> Option<(Vec<geometry::Tri>, Vec<geometry::Tri>)> {
    fn read_mesh(b: &[u8], off: &mut usize) -> Option<Vec<geometry::Tri>> {
        if *off + 4 > b.len() {
            return None;
        }
        let n = u32::from_le_bytes(b[*off..*off + 4].try_into().ok()?) as usize;
        *off += 4;
        if n > 2_000_000 || *off + n * 36 > b.len() {
            return None;
        }
        let mut tris = Vec::with_capacity(n);
        for _ in 0..n {
            let mut t = [[0f32; 3]; 3];
            for v in &mut t {
                for c in v.iter_mut() {
                    *c = f32::from_le_bytes(b[*off..*off + 4].try_into().ok()?);
                    *off += 4;
                }
            }
            tris.push(t);
        }
        Some(tris)
    }
    let mut off = 0usize;
    let a = read_mesh(body, &mut off)?;
    let b = read_mesh(body, &mut off)?;
    Some((a, b))
}

fn params_from_query(query: &str) -> WheelParams {
    let mut p = WheelParams::default();
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else { continue };
        let Ok(v) = value.parse::<f64>() else { continue };
        match key {
            "dia" => p.dia = v,
            "thk" => p.thk = v,
            "shaft" => p.shaft = v,
            "n" => p.n = v as u32,
            "depth" => p.depth = v,
            "mouth" => p.mouth_deg = v,
            _ => {}
        }
    }
    p.clamped()
}

fn respond(stream: &mut TcpStream, status: &str, ctype: &str, extra: &[String], body: &[u8]) {
    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n",
        body.len()
    );
    for h in extra {
        head += h;
        head += "\r\n";
    }
    head += "\r\n";
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}
