//! ZeroCAD — параметрический CAD-сервер на чистом Rust (ноль зависимостей).
//! Редактор целиком живёт в браузере (web/: те же файлы — и расширение
//! браузера); сервер отдаёт его и держит резервный движок csgrs.
//!
//!   GET /                    -> страница (web/index.html, вшита в бинарник)
//!   GET /app.js              -> редактор: команды, интерфейс
//!   GET /geom.js             -> ядро геометрии: булевы, починка сетки
//!   GET /geom-worker.js      -> фоновый поток с тем же ядром
//!   GET /tools.js            -> схема команд для агента (её же вшивает сервер)
//!   GET /vendor/three.min.js -> three.js r128 (локально: расширениям CDN нельзя)
//!   GET /vendor/manifold.js, /vendor/manifold.wasm -> Manifold 3.5.4 (Apache-2.0):
//!                               второй движок булевых, грузится по требованию
//!   GET /api/wheel.stl?...   -> бинарный STL с параметрами из query
//!   POST /mcp                -> MCP для AI-агента (agent.rs); команды исполняет
//!                               открытая вкладка: GET /agent/events (SSE),
//!                               POST /agent/hello, /agent/result, /agent/lead,
//!                               /agent/ack (команду получила), /agent/bye
//!   GET  /api/role           -> "test" у тестового сервера (ZEROCAD_TEST=1), иначе "main"
//!   GET/POST /api/session    -> общий рабочий сеанс: последний проект любой
//!                               вкладки; ?seq=1 — только «номер вкладка»
//!
//! Параметры query: dia, thk, shaft, n, depth, mouth (дефолты — в geometry.rs).

mod agent;
mod csg;
mod geometry;
mod stl;

use geometry::WheelParams;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};

const INDEX_HTML: &str = include_str!("../web/index.html");
const APP_JS: &str = include_str!("../web/app.js");
const GEOM_JS: &str = include_str!("../web/geom.js");
const GEOM_WORKER_JS: &str = include_str!("../web/geom-worker.js");
/// Схема команд для агента: тот же файл, что грузит вкладка. Сервер разбирает
/// его в `agent::embedded_tools()`, чтобы отвечать на `tools/list` без вкладки.
pub const TOOLS_JS: &str = include_str!("../web/tools.js");
const THREE_JS: &str = include_str!("../web/vendor/three.min.js");
const MANIFOLD_JS: &str = include_str!("../web/vendor/manifold.js");
const MANIFOLD_WASM: &[u8] = include_bytes!("../web/vendor/manifold.wasm");
pub const BUILD: &str = env!("ZEROCAD_BUILD");
static PORT: std::sync::OnceLock<u16> = std::sync::OnceLock::new();

/// Общий рабочий сеанс: проект, который вкладки пишут при автосохранении.
/// Новая вкладка открывается сразу на нём, остальные подхватывают правки по
/// номеру версии. Хранится и на диске (exports/_session.zcad) — переживает
/// перезапуск сервера.
struct Session {
    seq: u64,
    tab: String,
    data: Vec<u8>,
}
static SESSION: std::sync::Mutex<Option<Session>> = std::sync::Mutex::new(None);
/// Тестовый сервер (ZEROCAD_TEST=1): свой файл сеанса, и /api/role отвечает
/// "test". Прогон тестов шёл через основной сервер и общую вкладку —
/// тесты заменяли модель пользователя тестовым кубом. Теперь tests/mcp/run.py
/// требует тестовый сервер, сеанс пользователя тесты не видят
fn test_mode() -> bool {
    std::env::var("ZEROCAD_TEST").map_or(false, |v| !v.is_empty() && v != "0")
}
fn session_file() -> &'static str {
    if test_mode() { "exports/_session_test.zcad" } else { "exports/_session.zcad" }
}

fn session_load() {
    if let Ok(data) = std::fs::read(session_file()) {
        if !data.is_empty() {
            *SESSION.lock().unwrap() = Some(Session { seq: 1, tab: String::new(), data });
        }
    }
}

fn session_route(stream: &mut TcpStream, post: bool, query: &str, body: Vec<u8>) {
    let tab: String = query
        .split('&')
        .find_map(|kv| kv.strip_prefix("tab="))
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(32)
        .collect();
    let mut s = SESSION.lock().unwrap();
    if post {
        if body.is_empty() || body[0] != b'{' {
            respond(stream, "400 Bad Request", "text/plain; charset=utf-8", &[], b"");
            return;
        }
        let seq = s.as_ref().map_or(0, |x| x.seq) + 1;
        let _ = std::fs::create_dir_all("exports");
        let _ = std::fs::write(session_file(), &body);
        *s = Some(Session { seq, tab, data: body });
        respond(stream, "200 OK", "text/plain; charset=utf-8", &[], seq.to_string().as_bytes());
        return;
    }
    match s.as_ref() {
        None => respond(stream, "204 No Content", "text/plain; charset=utf-8", &[], b""),
        Some(x) if query.split('&').any(|kv| kv == "seq=1") => {
            let line = format!("{} {}", x.seq, x.tab);
            respond(stream, "200 OK", "text/plain; charset=utf-8", &[], line.as_bytes())
        }
        Some(x) => respond(
            stream,
            "200 OK",
            "application/json; charset=utf-8",
            &[format!("X-Session-Seq: {}", x.seq), format!("X-Session-Tab: {}", x.tab)],
            &x.data,
        ),
    }
}

fn port() -> u16 {
    *PORT.get().unwrap_or(&9000)
}

fn main() {
    // порт из переменной окружения PORT (например, для параллельного
    // дебаг-запуска), по умолчанию 9000
    let port = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(9000);
    let _ = PORT.set(port);
    session_load();
    let addr = format!("127.0.0.1:{port}");
    let listener = TcpListener::bind(&addr).unwrap_or_else(|e| {
        eprintln!("не удалось занять {addr}: {e}");
        std::process::exit(1);
    });
    println!("ZeroCAD {BUILD}: http://{addr}");
    println!("MCP for AI agents: http://{addr}/mcp (keep the editor tab open)");
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
    let mut origin: Option<String> = None;
    while reader.read_line(&mut line).is_ok() && line.trim() != "" {
        let lower = line.to_ascii_lowercase();
        if let Some(v) = lower.strip_prefix("content-length:") {
            content_length = v.trim().parse().unwrap_or(0);
        } else if lower.starts_with("origin:") {
            origin = Some(line["origin:".len()..].trim().to_string());
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

    // мост к агенту: только со страниц этого компьютера (DNS rebinding)
    if (path == "/mcp" || path.starts_with("/agent/") || path == "/api/session") && !agent::origin_ok(origin.as_deref()) {
        respond(&mut stream, "403 Forbidden", "text/plain; charset=utf-8", &[], b"forbidden origin");
        return;
    }
    match path {
        "/agent/events" => {
            let tab = query
                .split('&')
                .find_map(|kv| kv.strip_prefix("tab="))
                .and_then(|v| v.parse::<u64>().ok());
            agent::open_events(stream, tab);
        }
        "/agent/hello" | "/agent/result" | "/agent/lead" | "/agent/ack" | "/agent/bye" => {
            let ok = match path {
                "/agent/hello" => agent::hello(&body),
                "/agent/result" => agent::result(&body),
                "/agent/ack" => agent::ack(&body),
                "/agent/bye" => agent::bye(&body),
                _ => agent::lead(&body),
            };
            let status = if ok { "204 No Content" } else { "400 Bad Request" };
            respond(&mut stream, status, "text/plain; charset=utf-8", &[], b"");
        }
        "/mcp" => {
            if request_line.starts_with("POST ") {
                let (status, json) = agent::mcp(&body);
                // charset обязателен не по RFC 8259 (JSON и так UTF-8), а ради
                // наивных клиентов: без него PowerShell 5.1 читал ответ как
                // latin-1 и показывал «â» вместо «−» прямо в описаниях команд
                respond(&mut stream, status, "application/json; charset=utf-8", &[], json.as_bytes());
            } else {
                // SSE-поток сервер→агент не нужен: все ответы — в теле POST
                respond(&mut stream, "405 Method Not Allowed", "text/plain; charset=utf-8", &["Allow: POST".to_string()], b"");
            }
        }
        "/api/session" => session_route(&mut stream, request_line.starts_with("POST "), query, body),
        "/api/role" => respond(
            &mut stream,
            "200 OK",
            "text/plain; charset=utf-8",
            &[],
            if test_mode() { b"test" } else { b"main" },
        ),
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
        "/geom.js" => respond(
            &mut stream,
            "200 OK",
            "text/javascript; charset=utf-8",
            &[],
            GEOM_JS.as_bytes(),
        ),
        "/geom-worker.js" => respond(
            &mut stream,
            "200 OK",
            "text/javascript; charset=utf-8",
            &[],
            GEOM_WORKER_JS.as_bytes(),
        ),
        "/tools.js" => respond(
            &mut stream,
            "200 OK",
            "text/javascript; charset=utf-8",
            &[],
            TOOLS_JS.as_bytes(),
        ),
        "/vendor/manifold.js" => respond(
            &mut stream,
            "200 OK",
            "text/javascript; charset=utf-8",
            &[],
            MANIFOLD_JS.as_bytes(),
        ),
        "/vendor/manifold.wasm" => respond(&mut stream, "200 OK", "application/wasm", &[], MANIFOLD_WASM),
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
