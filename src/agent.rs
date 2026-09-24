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
//! Без вкладки его отдаёт `embedded_tools()` из вшитого `web/tools.js` — того
//! же файла, что грузит вкладка: агент, подключившийся раньше пользователя,
//! должен видеть команды, а не пустой список.
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

/// Открытая вкладка ZeroCAD: SSE-поток и её метка (её вкладка придумывает
/// себе сама и повторяет в `hello` / `lead`, чтобы сервер мог их связать)
struct Tab {
    id: u64,
    stream: TcpStream,
}

/// Вкладка не ответила за `timeout`, но считает дальше — JS однопоточный, и
/// прервать булеву посреди счёта нельзя. Раньше следующая команда уходила
/// поверх незаконченной; теперь мост говорит «занято», пока вкладка не
/// пришлёт запоздавший ответ. Если не пришла и за это время — вкладка
/// зависла, и мост разблокируется сам.
const STUCK_AFTER: Duration = Duration::from_secs(600);

struct Bridge {
    /// открытые вкладки ZeroCAD (SSE-потоки)
    tabs: Vec<Tab>,
    /// кому уходят команды агента: последняя открытая вкладка или та, в
    /// которую пользователь переключился. Раньше команда уходила во все
    /// сразу — две вкладки выполняли её обе, а агент видел один ответ
    leader: Option<u64>,
    next_id: u64,
    next_tab: u64,
    /// ответы вкладок по id команды
    results: HashMap<u64, Json>,
    /// id команд, которых ещё кто-то ждёт: ответ на всё остальное —
    /// опоздавший или от лишней вкладки, его надо выбросить, а не копить
    pending: std::collections::HashSet<u64>,
    /// команда, которую вкладка считает прямо сейчас: id, имя, когда начали
    inflight: Option<(u64, String, Instant)>,
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
            st.tabs.retain_mut(|t| t.stream.write_all(b": ping\n\n").and_then(|_| t.stream.flush()).is_ok());
            // ведущая вкладка закрылась — ведёт следующая (последняя открытая)
            if st.leader.map_or(false, |id| !st.tabs.iter().any(|t| t.id == id)) {
                st.leader = st.tabs.last().map(|t| t.id);
            }
        });
        (
            Mutex::new(Bridge {
                tabs: Vec::new(),
                leader: None,
                next_id: 1,
                next_tab: 1,
                results: HashMap::new(),
                pending: std::collections::HashSet::new(),
                inflight: None,
                tools: None,
                build: String::new(),
            }),
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

/// GET /agent/events?tab=N — вкладка подписывается на команды. Метку вкладка
/// придумывает себе сама; без неё (старая страница из кеша) метку выдаёт
/// сервер — вести такая вкладка сможет, а перехватывать по фокусу нет.
pub fn open_events(mut stream: TcpStream, tab: Option<u64>) {
    let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nConnection: keep-alive\r\n\r\n: zerocad agent link\n\n";
    if stream.write_all(head.as_bytes()).and_then(|_| stream.flush()).is_err() {
        return;
    }
    let (m, _) = bridge();
    let mut st = m.lock().unwrap();
    let id = tab.unwrap_or_else(|| {
        st.next_tab += 1;
        st.next_tab
    });
    // та же вкладка после F5 — не вторая копия
    st.tabs.retain(|t| t.id != id);
    st.tabs.push(Tab { id, stream });
    // только что открытая вкладка и есть та, на которую смотрит пользователь
    st.leader = Some(id);
}

/// POST /agent/lead — вкладка получила фокус и просит команды себе. Так агент
/// всегда рисует в той вкладке, на которую пользователь смотрит.
pub fn lead(body: &[u8]) -> bool {
    let Some(v) = std::str::from_utf8(body).ok().and_then(Json::parse) else { return false };
    let Some(id) = v.get("tab").and_then(Json::as_f64) else { return false };
    let (m, _) = bridge();
    let mut st = m.lock().unwrap();
    let id = id as u64;
    if st.tabs.iter().any(|t| t.id == id) {
        st.leader = Some(id);
    }
    true
}

/// Схема команд, вшитая в бинарник (`web/tools.js` — тот же файл, что грузит
/// вкладка). Нужна, чтобы `tools/list` был полным ещё до того, как пользователь
/// откроет вкладку. Файл — чистые данные: берём массив от `const ZC_TOOLS` до
/// последней `]`, комментарии сверху разбору не мешают.
pub fn embedded_tools() -> Json {
    static CACHE: OnceLock<Json> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            let src = crate::TOOLS_JS;
            src.find("const ZC_TOOLS")
                .and_then(|i| src[i..].find('[').map(|j| i + j))
                .zip(src.rfind(']'))
                .filter(|(a, b)| a < b)
                .and_then(|(a, b)| Json::parse(&src[a..=b]))
                .unwrap_or(Json::Arr(vec![]))
        })
        .clone()
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
    let mut st = m.lock().unwrap();
    let id = id as u64;
    // вкладка досчитала и свободна — даже если этого ответа уже никто не ждёт
    if st.inflight.as_ref().map(|(i, _, _)| *i) == Some(id) {
        st.inflight = None;
    }
    // ответ, которого никто не ждёт (опоздал после таймаута), раньше оседал
    // в results навсегда — неограниченная утечка
    if st.pending.contains(&id) {
        st.results.insert(id, v);
    }
    cv.notify_all();
    true
}

/// Отправить команду во вкладку и дождаться ответа
fn call_tab(tool: &str, args: &Json, timeout: Duration) -> Result<Json, String> {
    let (m, cv) = bridge();
    let mut st = m.lock().unwrap();
    // предыдущая команда ещё считается: слать вторую поверх нельзя — вкладка
    // однопоточная, и агент получил бы ответы вперемешку
    if let Some((_, busy, since)) = st.inflight.clone() {
        if since.elapsed() < STUCK_AFTER {
            return Err(format!(
                "ZeroCAD is still running '{busy}' ({} s so far). Wait for it to finish before sending another command.",
                since.elapsed().as_secs()
            ));
        }
        st.inflight = None; // вкладка зависла — освобождаем мост
    }
    let id = st.next_id;
    st.next_id += 1;
    let msg = Json::obj(vec![("id", Json::Num(id as f64)), ("tool", Json::str(tool)), ("args", args.clone())]).dump();
    let frame = format!("event: command\ndata: {msg}\n\n");
    // Команда уходит ОДНОЙ вкладке — ведущей. Раньше кадр писался всем сразу,
    // и две открытые вкладки выполняли одну команду обе: агент видел первый
    // ответ, а вторая модель менялась молча.
    loop {
        let Some(&Tab { id: lead_id, .. }) = st
            .leader
            .and_then(|l| st.tabs.iter().find(|t| t.id == l))
            .or_else(|| st.tabs.last())
        else {
            st.leader = None;
            return Err(no_tab_message());
        };
        st.leader = Some(lead_id);
        let tab = st.tabs.iter_mut().find(|t| t.id == lead_id).expect("вкладка только что найдена");
        if tab.stream.write_all(frame.as_bytes()).and_then(|_| tab.stream.flush()).is_ok() {
            break;
        }
        st.tabs.retain(|t| t.id != lead_id); // закрылась между проверкой и отправкой
        st.leader = None;
    }
    st.pending.insert(id);
    st.inflight = Some((id, tool.to_string(), Instant::now()));
    let deadline = Instant::now() + timeout;
    let out = loop {
        if let Some(r) = st.results.remove(&id) {
            st.inflight = None;
            break Ok(r);
        }
        let now = Instant::now();
        if now >= deadline {
            // inflight НЕ снимаем: вкладка всё ещё считает, и следующая
            // команда должна получить внятное «занято», а не уйти поверх
            break Err(format!("ZeroCAD did not answer '{tool}' in {} s", timeout.as_secs()));
        }
        st = cv.wait_timeout(st, deadline - now).unwrap().0;
    };
    st.pending.remove(&id);
    st.results.remove(&id);
    out
}

fn no_tab_message() -> String {
    format!("ZeroCAD is not open in a browser. Open http://127.0.0.1:{} and try again.", crate::port())
}

// ---------------- MCP ----------------

/// Версии протокола MCP, которые мы понимаем; первая — предпочтительная.
/// Разница для нас невелика (инструменты и `initialize` не менялись), но
/// подтверждать версию, о которой мы ничего не знаем, нельзя.
const PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

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
            // Договариваемся о версии, а не поддакиваем: раньше возвращали то,
            // что прислал клиент, включая несуществующую версию, и он считал,
            // что сервер её понимает. Незнакомую заменяем на свою новейшую —
            // дальше решает клиент.
            let asked = params.get("protocolVersion").and_then(Json::as_str).unwrap_or(PROTOCOL_VERSIONS[0]);
            let version = if PROTOCOL_VERSIONS.contains(&asked) { asked } else { PROTOCOL_VERSIONS[0] };
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
                         \n\nUsual route: start from new_shape, draw a closed outline on a face with draw_circle / \
                         draw_line / add_text, then give it depth with extrude_face (a distance, + outward and − into the \
                         body) or cut_through (all the way through the body). add_frustum, add_revolve and add_sweep add \
                         whole solids instead and need no outline. bevel_edges and bevel_outline round or chamfer what \
                         exists; undo steps back. \
                         \n\nAfter every change call get_state and check open_edges == 0 — that is what makes the mesh a \
                         closed solid and printable, and export_stl warns when it is not. Call screenshot to see the model \
                         rather than assuming it looks right; pass fit to frame it. \
                         \n\nThe model is the user's document: every command replaces or reshapes what is on their screen, \
                         and new_shape throws the current model away. Say what you are about to change before you change it.",
                    ),
                ),
            ])
        }
        "ping" => Json::obj(vec![]),
        "tools/list" => {
            let (m, _) = bridge();
            let st = m.lock().unwrap();
            // Список живой вкладки важнее: она могла быть собрана иначе
            // (расширение, старая сборка). Без вкладки — вшитый `web/tools.js`,
            // тот же файл, что грузит вкладка.
            //
            // Раньше здесь ждали вкладку 5 с и отдавали пустой массив, если не
            // дождались. Агент, запущенный раньше, чем пользователь открыл
            // вкладку, видел ноль инструментов, кешировал это на сессию и
            // считал, что ZeroCAD ничего не умеет; listChanged = false обещает,
            // что список больше не поменяется, так что узнать правду было
            // неоткуда. Теперь ответ всегда полный и мгновенный.
            Json::obj(vec![("tools", st.tools.clone().unwrap_or_else(embedded_tools))])
        }
        "tools/call" => {
            let name = params.get("name").and_then(Json::as_str).unwrap_or("").to_string();
            let args = params.get("arguments").cloned().unwrap_or(Json::Obj(vec![]));
            // import_3mf: файл читает сервер (вкладке диск недоступен) и отдаёт
            // вкладке содержимое — тот же разбор, что у Open… в редакторе
            let args = if name == "import_3mf" || name == "trace_reference" {
                match read_file_arg(&args, &name) {
                    Ok(a) => a,
                    Err(e) => return ("200 OK", Json::obj(vec![("jsonrpc", Json::str("2.0")), ("id", id), ("result",
                        Json::obj(vec![("content", Json::Arr(vec![Json::obj(vec![("type", Json::str("text")), ("text", Json::Str(format!("{name}: {e}")))])])),
                                       ("isError", Json::Bool(true))]))]).dump()),
                }
            } else { args };
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
                return save_export(&res, data, "stl");
            }
            if let (Some(data), Some(ext @ ("3mf" | "glb"))) =
                (res.get("file_base64").and_then(Json::as_str), res.get("ext").and_then(Json::as_str))
            {
                return save_export(&res, data, ext);
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

/// Файл с диска для вкладки (ей диск недоступен): 3MF для import_3mf,
/// фотография для trace_reference. Путь абсолютный или имя в `exports/`;
/// не больше 64 МБ. Остальные поля команды остаются как есть
fn read_file_arg(args: &Json, tool: &str) -> Result<Json, String> {
    let photo = tool == "trace_reference";
    let raw = match args.get("path").and_then(Json::as_str) {
        Some(p) => p,
        // фото можно и не давать: команда тогда только правит уже загруженное
        None if photo => return Ok(args.clone()),
        None => return Err("path is required".into()),
    };
    let mut path = std::path::PathBuf::from(raw);
    if path.components().count() == 1 {
        path = std::path::Path::new("exports").join(&path);
    }
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let mime = match (photo, ext.as_str()) {
        (false, "3mf") => "model/3mf",
        (true, "png") => "image/png",
        (true, "jpg" | "jpeg") => "image/jpeg",
        (true, "webp") => "image/webp",
        (true, _) => return Err(format!("{} is not a png/jpg/webp image", path.display())),
        (false, _) => return Err(format!("{} is not a .3mf file", path.display())),
    };
    let bytes = std::fs::read(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("the file is larger than 64 MB".into());
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();
    let mut out = match args {
        Json::Obj(kv) => kv.iter().filter(|(k, _)| k != "path").cloned().collect::<Vec<_>>(),
        _ => vec![],
    };
    out.push(("data_base64".into(), Json::Str(base64_encode(&bytes))));
    out.push(("mime".into(), Json::str(mime)));
    out.push(("name".into(), Json::Str(name)));
    Ok(Json::Obj(out))
}

fn base64_encode(b: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((b.len() + 2) / 3 * 4);
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Экспорт STL и 3MF: файл пишет сервер (вкладке браузера на диск нельзя) в
/// папку `exports/` рядом с запуском; агенту — путь, размер и пригодность к печати
fn save_export(res: &Json, b64: &str, ext: &str) -> Json {
    let text = |s: String| Json::obj(vec![("type", Json::str("text")), ("text", Json::Str(s))]);
    let err = |s: String| Json::obj(vec![("content", Json::Arr(vec![text(s)])), ("isError", Json::Bool(true))]);
    let Some(bytes) = base64_decode(b64) else { return err(format!("export_{ext}: broken data from the editor")) };
    if bytes.len() < if ext == "stl" { 84 } else if ext == "glb" { 20 } else { 22 } {
        return err(format!("export_{ext}: the model is empty"));
    }
    let name = safe_file_name(res.get("name").and_then(Json::as_str).unwrap_or("zerocad"));
    let dir = std::path::Path::new("exports");
    if let Err(e) = std::fs::create_dir_all(dir) {
        return err(format!("export_{ext}: cannot create {}: {e}", dir.display()));
    }
    let path = dir.join(format!("{name}.{ext}"));
    if let Err(e) = std::fs::write(&path, &bytes) {
        return err(format!("export_{ext}: cannot write {}: {e}", path.display()));
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
    // у GLB свои поля: какие узлы получились (имена — контракт с IEGarage)
    for k in ["parts", "hotspots"] {
        if let Some(v) = res.get(k) {
            info.push((k, v.clone()));
        }
    }
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
                    ("name", Json::Str(format!("{name}.{ext}"))),
                    ("mimeType", Json::Str(format!("model/{ext}"))),
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

    /// Вшитый `web/tools.js` разбирается, и `tools/list` без вкладки не пуст:
    /// пустой список агент кеширует и решает, что ZeroCAD ничего не умеет.
    #[test]
    fn tools_list_without_tab() {
        let Json::Arr(tools) = embedded_tools() else { panic!("tools.js не разобрался в массив") };
        assert!(tools.len() >= 16, "инструментов всего {}", tools.len());
        for t in &tools {
            let name = t.get("name").and_then(Json::as_str).unwrap_or("");
            assert!(!name.is_empty(), "инструмент без имени: {}", t.dump());
            let desc = t.get("description").and_then(Json::as_str).unwrap_or("");
            assert!(desc.len() > 20, "{name}: описание слишком короткое");
            assert!(
                t.get("inputSchema").and_then(|s| s.get("type")).and_then(Json::as_str) == Some("object"),
                "{name}: нет inputSchema типа object"
            );
        }
        // те же данные приходят и по MCP, пока вкладка не представилась
        let (s, b) = mcp(br#"{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}"#);
        assert_eq!(s, "200 OK");
        assert!(!b.contains("\"tools\":[]"), "tools/list без вкладки пуст: {b}");
        for name in ["get_state", "new_shape", "extrude_face", "screenshot"] {
            assert!(b.contains(&format!("\"{name}\"")), "в tools/list нет {name}");
        }
        // «gear» — колесо-дозатор: без этой оговорки агент строит «шестерню»
        assert!(b.contains("NOT a toothed gear"), "new_shape не предупреждает про gear");
    }
}
