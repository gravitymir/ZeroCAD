//! Мост к AI-агенту: MCP (Streamable HTTP, JSON-RPC 2.0) на `/mcp`.
//!
//! Геометрическое ядро живёт в браузере, поэтому команды агента исполняет
//! открытая вкладка ZeroCAD, а сервер только передаёт их:
//!
//!   агент --POST /mcp tools/call--> сервер --SSE event: command--> вкладка
//!   агент <--------- ответ -------- сервер <--POST /agent/result--- вкладка
//!
//! Список инструментов вкладка присылает сама (`POST /agent/hello`) из того же
//! реестра команд, по которому работает редактор, — одно приложение, не два.
//! Только std: без WebSocket и без JSON-крейтов (крошечный разбор ниже).

use std::collections::HashMap;
use std::io::Write;
use std::net::TcpStream;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

// ---------------- JSON ----------------

#[derive(Clone, Debug)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Obj(v) => v.iter().find(|(k, _)| k == key).map(|(_, x)| x),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Json::Num(n) => Some(*n),
            _ => None,
        }
    }
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Json::Bool(b) => Some(*b),
            _ => None,
        }
    }
    pub fn obj(pairs: Vec<(&str, Json)>) -> Json {
        Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }
    pub fn str(s: &str) -> Json {
        Json::Str(s.to_string())
    }

    pub fn dump(&self) -> String {
        let mut out = String::new();
        self.write(&mut out);
        out
    }
    fn write(&self, out: &mut String) {
        match self {
            Json::Null => out.push_str("null"),
            Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Json::Num(n) => {
                if n.is_finite() {
                    if n.fract() == 0.0 && n.abs() < 1e15 {
                        out.push_str(&format!("{}", *n as i64));
                    } else {
                        out.push_str(&format!("{n}"));
                    }
                } else {
                    out.push_str("null");
                }
            }
            Json::Str(s) => {
                out.push('"');
                for c in s.chars() {
                    match c {
                        '"' => out.push_str("\\\""),
                        '\\' => out.push_str("\\\\"),
                        '\n' => out.push_str("\\n"),
                        '\r' => out.push_str("\\r"),
                        '\t' => out.push_str("\\t"),
                        c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
                        c => out.push(c),
                    }
                }
                out.push('"');
            }
            Json::Arr(v) => {
                out.push('[');
                for (i, x) in v.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    x.write(out);
                }
                out.push(']');
            }
            Json::Obj(v) => {
                out.push('{');
                for (i, (k, x)) in v.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    Json::Str(k.clone()).write(out);
                    out.push(':');
                    x.write(out);
                }
                out.push('}');
            }
        }
    }

    pub fn parse(text: &str) -> Option<Json> {
        let b = text.as_bytes();
        let mut i = 0;
        let v = parse_value(b, &mut i, 0)?;
        skip_ws(b, &mut i);
        (i == b.len()).then_some(v)
    }
}

fn skip_ws(b: &[u8], i: &mut usize) {
    while *i < b.len() && matches!(b[*i], b' ' | b'\n' | b'\r' | b'\t') {
        *i += 1;
    }
}

fn parse_value(b: &[u8], i: &mut usize, depth: usize) -> Option<Json> {
    if depth > 64 {
        return None;
    }
    skip_ws(b, i);
    match *b.get(*i)? {
        b'n' => lit(b, i, "null", Json::Null),
        b't' => lit(b, i, "true", Json::Bool(true)),
        b'f' => lit(b, i, "false", Json::Bool(false)),
        b'"' => parse_str(b, i).map(Json::Str),
        b'[' => {
            *i += 1;
            let mut v = Vec::new();
            skip_ws(b, i);
            if b.get(*i) == Some(&b']') {
                *i += 1;
                return Some(Json::Arr(v));
            }
            loop {
                v.push(parse_value(b, i, depth + 1)?);
                skip_ws(b, i);
                match *b.get(*i)? {
                    b',' => *i += 1,
                    b']' => {
                        *i += 1;
                        return Some(Json::Arr(v));
                    }
                    _ => return None,
                }
            }
        }
        b'{' => {
            *i += 1;
            let mut v = Vec::new();
            skip_ws(b, i);
            if b.get(*i) == Some(&b'}') {
                *i += 1;
                return Some(Json::Obj(v));
            }
            loop {
                skip_ws(b, i);
                if b.get(*i) != Some(&b'"') {
                    return None;
                }
                let k = parse_str(b, i)?;
                skip_ws(b, i);
                if b.get(*i) != Some(&b':') {
                    return None;
                }
                *i += 1;
                v.push((k, parse_value(b, i, depth + 1)?));
                skip_ws(b, i);
                match *b.get(*i)? {
                    b',' => *i += 1,
                    b'}' => {
                        *i += 1;
                        return Some(Json::Obj(v));
                    }
                    _ => return None,
                }
            }
        }
        _ => {
            let start = *i;
            while *i < b.len() && matches!(b[*i], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9') {
                *i += 1;
            }
            std::str::from_utf8(&b[start..*i]).ok()?.parse().ok().map(Json::Num)
        }
    }
}

fn lit(b: &[u8], i: &mut usize, word: &str, v: Json) -> Option<Json> {
    if b[*i..].starts_with(word.as_bytes()) {
        *i += word.len();
        Some(v)
    } else {
        None
    }
}

fn parse_str(b: &[u8], i: &mut usize) -> Option<String> {
    *i += 1; // открывающая кавычка
    let mut out: Vec<u8> = Vec::new();
    while *i < b.len() {
        let c = b[*i];
        *i += 1;
        match c {
            b'"' => return String::from_utf8(out).ok(),
            b'\\' => {
                let e = *b.get(*i)?;
                *i += 1;
                match e {
                    b'"' => out.push(b'"'),
                    b'\\' => out.push(b'\\'),
                    b'/' => out.push(b'/'),
                    b'b' => out.push(8),
                    b'f' => out.push(12),
                    b'n' => out.push(b'\n'),
                    b'r' => out.push(b'\r'),
                    b't' => out.push(b'\t'),
                    b'u' => {
                        let mut cp = u32::from_str_radix(std::str::from_utf8(b.get(*i..*i + 4)?).ok()?, 16).ok()?;
                        *i += 4;
                        // суррогатная пара
                        if (0xD800..0xDC00).contains(&cp) && b.get(*i..*i + 2) == Some(b"\\u") {
                            let lo = u32::from_str_radix(std::str::from_utf8(b.get(*i + 2..*i + 6)?).ok()?, 16).ok()?;
                            if (0xDC00..0xE000).contains(&lo) {
                                cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                                *i += 6;
                            }
                        }
                        let ch = char::from_u32(cp).unwrap_or('\u{FFFD}');
                        let mut buf = [0u8; 4];
                        out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                    }
                    _ => return None,
                }
            }
            _ => out.push(c),
        }
    }
    None
}

// ---------------- мост к вкладке ----------------

struct Bridge {
    /// открытые вкладки ZeroCAD (SSE-потоки)
    tabs: Vec<TcpStream>,
    next_id: u64,
    /// ответы вкладок по id команды
    results: HashMap<u64, Json>,
    /// инструменты из реестра команд вкладки
    tools: Option<Json>,
    build: String,
}

fn bridge() -> &'static (Mutex<Bridge>, Condvar) {
    static B: OnceLock<(Mutex<Bridge>, Condvar)> = OnceLock::new();
    B.get_or_init(|| {
        // пинг держит SSE живым и выметает закрытые вкладки
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_secs(15));
            let (m, _) = bridge();
            let mut st = m.lock().unwrap();
            st.tabs.retain_mut(|s| s.write_all(b": ping\n\n").and_then(|_| s.flush()).is_ok());
        });
        (
            Mutex::new(Bridge { tabs: Vec::new(), next_id: 1, results: HashMap::new(), tools: None, build: String::new() }),
            Condvar::new(),
        )
    })
}

/// Запросы к мосту допустимы только со страниц этого же компьютера: защита
/// от DNS rebinding — чужой сайт в браузере не должен командовать редактором
pub fn origin_ok(origin: Option<&str>) -> bool {
    match origin {
        None => true, // агент-процесс (не браузер) Origin не шлёт
        Some(o) => {
            let o = o.trim();
            ["http://127.0.0.1", "http://localhost", "http://[::1]"]
                .iter()
                .any(|p| o == *p || o.starts_with(&format!("{p}:")))
        }
    }
}

/// GET /agent/events — вкладка подписывается на команды
pub fn open_events(mut stream: TcpStream) {
    let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nConnection: keep-alive\r\n\r\n: zerocad agent link\n\n";
    if stream.write_all(head.as_bytes()).and_then(|_| stream.flush()).is_err() {
        return;
    }
    let (m, _) = bridge();
    m.lock().unwrap().tabs.push(stream);
}

/// POST /agent/hello — вкладка прислала номер сборки и список инструментов
pub fn hello(body: &[u8]) -> bool {
    let Some(v) = std::str::from_utf8(body).ok().and_then(Json::parse) else { return false };
    let (m, cv) = bridge();
    let mut st = m.lock().unwrap();
    if let Some(t) = v.get("tools") {
        st.tools = Some(t.clone());
    }
    if let Some(b) = v.get("build").and_then(Json::as_str) {
        st.build = b.to_string();
    }
    cv.notify_all();
    true
}

/// POST /agent/result — ответ вкладки на команду
pub fn result(body: &[u8]) -> bool {
    let Some(v) = std::str::from_utf8(body).ok().and_then(Json::parse) else { return false };
    let Some(id) = v.get("id").and_then(Json::as_f64) else { return false };
    let (m, cv) = bridge();
    m.lock().unwrap().results.insert(id as u64, v);
    cv.notify_all();
    true
}

/// Отправить команду во вкладку и дождаться ответа
fn call_tab(tool: &str, args: &Json, timeout: Duration) -> Result<Json, String> {
    let (m, cv) = bridge();
    let mut st = m.lock().unwrap();
    let id = st.next_id;
    st.next_id += 1;
    let msg = Json::obj(vec![("id", Json::Num(id as f64)), ("tool", Json::str(tool)), ("args", args.clone())]).dump();
    let frame = format!("event: command\ndata: {msg}\n\n");
    st.tabs.retain_mut(|s| s.write_all(frame.as_bytes()).and_then(|_| s.flush()).is_ok());
    if st.tabs.is_empty() {
        return Err(no_tab_message());
    }
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(r) = st.results.remove(&id) {
            return Ok(r);
        }
        let now = Instant::now();
        if now >= deadline {
            return Err(format!("ZeroCAD did not answer '{tool}' in {} s", timeout.as_secs()));
        }
        st = cv.wait_timeout(st, deadline - now).unwrap().0;
    }
}

fn no_tab_message() -> String {
    format!("ZeroCAD is not open in a browser. Open http://127.0.0.1:{} and try again.", crate::port())
}

// ---------------- MCP ----------------

/// POST /mcp: один JSON-RPC запрос → (HTTP-статус, тело JSON или пусто)
pub fn mcp(body: &[u8]) -> (&'static str, String) {
    let Some(req) = std::str::from_utf8(body).ok().and_then(Json::parse) else {
        return ("400 Bad Request", rpc_error(Json::Null, -32700, "parse error"));
    };
    if matches!(req, Json::Arr(_)) {
        return ("400 Bad Request", rpc_error(Json::Null, -32600, "batch requests are not supported"));
    }
    let method = req.get("method").and_then(Json::as_str).unwrap_or("");
    let Some(id) = req.get("id").cloned() else {
        // уведомление (notifications/initialized и т. п.) — ответа нет
        return ("202 Accepted", String::new());
    };
    let params = req.get("params").cloned().unwrap_or(Json::Obj(vec![]));
    let result = match method {
        "initialize" => {
            let version = params.get("protocolVersion").and_then(Json::as_str).unwrap_or("2025-06-18");
            Json::obj(vec![
                ("protocolVersion", Json::str(version)),
                ("capabilities", Json::obj(vec![("tools", Json::obj(vec![("listChanged", Json::Bool(false))]))])),
                ("serverInfo", Json::obj(vec![("name", Json::str("zerocad")), ("version", Json::str(crate::BUILD))])),
                (
                    "instructions",
                    Json::str(
                        "ZeroCAD is a mesh CAD editor running in the user's browser; the user watches every step live. \
                         Units are millimetres, Z is up, the ground is z=0. A cube of size S spans 0..S on each axis; \
                         a gear is centred on the Z axis. Faces are addressed by a point on the face (and optionally its normal). \
                         Call get_state to check volume, bounding box and open_edges (0 means a closed solid) after each change, \
                         and screenshot to see the model.",
                    ),
                ),
            ])
        }
        "ping" => Json::obj(vec![]),
        "tools/list" => {
            let (m, cv) = bridge();
            let mut st = m.lock().unwrap();
            // вкладка могла ещё не представиться — подождём её немного
            let deadline = Instant::now() + Duration::from_secs(5);
            while st.tools.is_none() && Instant::now() < deadline {
                st = cv.wait_timeout(st, deadline - Instant::now()).unwrap().0;
            }
            Json::obj(vec![("tools", st.tools.clone().unwrap_or(Json::Arr(vec![])))])
        }
        "tools/call" => {
            let name = params.get("name").and_then(Json::as_str).unwrap_or("").to_string();
            let args = params.get("arguments").cloned().unwrap_or(Json::Obj(vec![]));
            tool_result(&name, call_tab(&name, &args, Duration::from_secs(120)))
        }
        _ => return ("200 OK", rpc_error(id, -32601, &format!("method not found: {method}"))),
    };
    (
        "200 OK",
        Json::obj(vec![("jsonrpc", Json::str("2.0")), ("id", id), ("result", result)]).dump(),
    )
}

/// ответ вкладки → результат MCP tools/call
fn tool_result(name: &str, r: Result<Json, String>) -> Json {
    let text = |s: String| Json::obj(vec![("type", Json::str("text")), ("text", Json::Str(s))]);
    match r {
        Err(e) => Json::obj(vec![("content", Json::Arr(vec![text(e)])), ("isError", Json::Bool(true))]),
        Ok(v) => {
            if v.get("ok").and_then(Json::as_bool) != Some(true) {
                let e = v.get("error").and_then(Json::as_str).unwrap_or("command failed");
                return Json::obj(vec![
                    ("content", Json::Arr(vec![text(format!("{name}: {e}"))])),
                    ("isError", Json::Bool(true)),
                ]);
            }
            let res = v.get("result").cloned().unwrap_or(Json::Null);
            if let Some(data) = res.get("stl_base64").and_then(Json::as_str) {
                return save_stl(&res, data);
            }
            let image = v.get("image").and_then(Json::as_bool) == Some(true);
            let content = match (image, res.get("image").and_then(Json::as_str)) {
                (true, Some(data)) => Json::obj(vec![
                    ("type", Json::str("image")),
                    ("data", Json::str(data)),
                    ("mimeType", Json::str(res.get("mime").and_then(Json::as_str).unwrap_or("image/png"))),
                ]),
                _ => text(res.dump()),
            };
            Json::obj(vec![("content", Json::Arr(vec![content])), ("isError", Json::Bool(false))])
        }
    }
}

/// Экспорт STL: файл пишет сервер (вкладке браузера на диск нельзя) в папку
/// `exports/` рядом с запуском; агенту — путь, размер и пригодность к печати
fn save_stl(res: &Json, b64: &str) -> Json {
    let text = |s: String| Json::obj(vec![("type", Json::str("text")), ("text", Json::Str(s))]);
    let err = |s: String| Json::obj(vec![("content", Json::Arr(vec![text(s)])), ("isError", Json::Bool(true))]);
    let Some(bytes) = base64_decode(b64) else { return err("export_stl: broken STL data from the editor".into()) };
    if bytes.len() < 84 {
        return err("export_stl: the model is empty".into());
    }
    let name = safe_file_name(res.get("name").and_then(Json::as_str).unwrap_or("zerocad"));
    let dir = std::path::Path::new("exports");
    if let Err(e) = std::fs::create_dir_all(dir) {
        return err(format!("export_stl: cannot create {}: {e}", dir.display()));
    }
    let path = dir.join(format!("{name}.stl"));
    if let Err(e) = std::fs::write(&path, &bytes) {
        return err(format!("export_stl: cannot write {}: {e}", path.display()));
    }
    let abs = std::fs::canonicalize(&path).unwrap_or(path.clone());
    // canonicalize в Windows даёт \\?\C:\... — префикс для человека лишний
    let abs_str = abs.display().to_string().trim_start_matches(r"\\?\").to_string();
    let num = |k: &str| res.get(k).and_then(Json::as_f64).unwrap_or(0.0);
    let open = num("open_edges");
    let nonmanifold = num("nonmanifold_edges");
    let printable = open == 0.0 && nonmanifold == 0.0;
    let mut info = vec![
        ("path", Json::Str(abs_str.clone())),
        ("bytes", Json::Num(bytes.len() as f64)),
        ("triangles", Json::Num(num("triangles"))),
        ("volume_mm3", Json::Num(num("volume_mm3"))),
        ("bbox_min", res.get("bbox_min").cloned().unwrap_or(Json::Null)),
        ("bbox_max", res.get("bbox_max").cloned().unwrap_or(Json::Null)),
        ("open_edges", Json::Num(open)),
        ("nonmanifold_edges", Json::Num(nonmanifold)),
        ("printable", Json::Bool(printable)),
    ];
    if !printable {
        info.push((
            "warning",
            Json::str("the mesh is not a clean solid (open or shared edges) — a slicer may refuse or misprint it"),
        ));
    }
    let uri = format!("file:///{}", abs_str.replace('\\', "/").trim_start_matches('/'));
    Json::obj(vec![
        (
            "content",
            Json::Arr(vec![
                text(Json::obj(info).dump()),
                Json::obj(vec![
                    ("type", Json::str("resource_link")),
                    ("uri", Json::Str(uri)),
                    ("name", Json::Str(format!("{name}.stl"))),
                    ("mimeType", Json::str("model/stl")),
                ]),
            ]),
        ),
        ("isError", Json::Bool(false)),
    ])
}

/// имя файла: буквы, цифры, - и _ (остальное — _), не длиннее 64
fn safe_file_name(raw: &str) -> String {
    let s: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(64)
        .collect();
    let s = s.trim_matches('_').to_string();
    if s.is_empty() { "zerocad".to_string() } else { s }
}

fn base64_decode(s: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let bytes: Vec<u8> = s.bytes().filter(|c| !c.is_ascii_whitespace()).collect();
    if bytes.len() % 4 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let pad = chunk.iter().rev().take_while(|&&c| c == b'=').count();
        if pad > 2 {
            return None;
        }
        let mut n = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            let v = if i >= 4 - pad { 0 } else { val(c)? };
            n = (n << 6) | v;
        }
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Some(out)
}

fn rpc_error(id: Json, code: i32, message: &str) -> String {
    Json::obj(vec![
        ("jsonrpc", Json::str("2.0")),
        ("id", id),
        ("error", Json::obj(vec![("code", Json::Num(code as f64)), ("message", Json::str(message))])),
    ])
    .dump()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_roundtrip() {
        let src = r#"{"a":[1,2.5,-3e2,true,null],"s":"x\"y\\z\né😀","o":{}}"#;
        let v = Json::parse(src).unwrap();
        assert_eq!(v.get("s").unwrap().as_str().unwrap(), "x\"y\\z\né😀");
        let again = Json::parse(&v.dump()).unwrap();
        assert_eq!(again.dump(), v.dump());
        assert!(Json::parse("{\"a\":}").is_none());
    }

    #[test]
    fn base64_and_names() {
        assert_eq!(base64_decode("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(base64_decode("aGVsbG8h").unwrap(), b"hello!");
        assert_eq!(base64_decode("aGk=").unwrap(), b"hi");
        assert!(base64_decode("abc").is_none());
        assert_eq!(safe_file_name("../../etc/passwd"), "etc_passwd");
        assert_eq!(safe_file_name("xyz cube"), "xyz_cube");
        assert_eq!(safe_file_name("..."), "zerocad");
    }

    #[test]
    fn origin_check() {
        assert!(origin_ok(None));
        assert!(origin_ok(Some("http://127.0.0.1:9000")));
        assert!(origin_ok(Some("http://localhost:9001")));
        assert!(!origin_ok(Some("http://localhost.evil.com")));
        assert!(!origin_ok(Some("https://example.com")));
    }

    #[test]
    fn mcp_basics() {
        let (s, b) = mcp(br#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}"#);
        assert_eq!(s, "200 OK");
        assert!(b.contains("\"protocolVersion\":\"2025-03-26\""));
        let (s, b) = mcp(br#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
        assert_eq!((s, b.as_str()), ("202 Accepted", ""));
        let (_, b) = mcp(br#"{"jsonrpc":"2.0","id":"x","method":"nope"}"#);
        assert!(b.contains("-32601"));
        // без вкладки инструмент отвечает понятной ошибкой, а не зависает
        let (_, b) = mcp(br#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_state","arguments":{}}}"#);
        assert!(b.contains("\"isError\":true") && b.contains("not open in a browser"));
    }
}
