//! ZeroCAD — параметрический CAD-сервер на чистом Rust (ноль зависимостей).
//! Отдаёт браузерный вьюер и генерирует STL колеса-дозатора на лету.
//!
//!   GET /                  -> вьюер (web/index.html, вшит в бинарник)
//!   GET /api/wheel.stl?... -> бинарный STL с параметрами из query
//!
//! Параметры query: dia, thk, shaft, n, depth, mouth (дефолты — в geometry.rs).

mod csg;
mod geometry;
mod stl;

use geometry::WheelParams;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};

const ADDR: &str = "127.0.0.1:8777";
const INDEX_HTML: &str = include_str!("../web/index.html");
const BUILD: &str = env!("ZEROCAD_BUILD");

fn main() {
    let listener = TcpListener::bind(ADDR).unwrap_or_else(|e| {
        eprintln!("не удалось занять {ADDR}: {e}");
        std::process::exit(1);
    });
    println!("ZeroCAD: http://{ADDR}");
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
    // дочитываем заголовки до пустой строки, тело у GET не ждём
    let mut line = String::new();
    while reader.read_line(&mut line).is_ok() && line.trim() != "" {
        line.clear();
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
        "/api/wheel.stl" => {
            let p = params_from_query(query);
            let use_csg = query.split('&').any(|kv| kv == "engine=csg");
            let started = std::time::Instant::now();
            let tris = if use_csg {
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
        _ => respond(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            &[],
            b"404",
        ),
    }
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
