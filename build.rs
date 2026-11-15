// Версия сборки: bНОМЕР-ХЕШ.СУФФИКС (номер = число коммитов, суффикс —
// секунды сборки, чтобы различать пересборки без коммита).
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn main() {
    // Пересобирать метку, когда меняются исходники ИЛИ коммит: без этих строк
    // Cargo брал прежний ZEROCAD_BUILD, и страница показывала старый номер,
    // хотя код внутри был новый (b217 вместо b220 — не понять, что запущено)
    for p in ["web", "src", "Cargo.toml", ".git/HEAD", ".git/index"] {
        println!("cargo:rerun-if-changed={p}");
    }
    let count = git(&["rev-list", "--count", "HEAD"]).unwrap_or_else(|| "0".into());
    let hash = git(&["rev-parse", "--short", "HEAD"]).unwrap_or_else(|| "dev".into());
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() % 100000)
        .unwrap_or(0);
    println!("cargo:rustc-env=ZEROCAD_BUILD=b{count}-{hash}.{secs}");
    embed_icon(&format!("b{count}-{hash}"));
}

// Иконка и сведения о файле в exe (Windows, MSVC): .rc → rc.exe из Windows
// SDK → .res, который линкер вшивает в бинарник. Без новых зависимостей.
// Нет SDK — сборка не падает, exe просто без иконки (предупреждение cargo)
fn embed_icon(build: &str) {
    println!("cargo:rerun-if-changed=assets/zerocad.ico");
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if os != "windows" || env != "msvc" {
        return;
    }
    let root = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let ico = root.join("assets").join("zerocad.ico");
    if !ico.exists() {
        println!("cargo:warning=assets/zerocad.ico not found - exe without an icon");
        return;
    }
    let Some(rc) = find_rc() else {
        println!("cargo:warning=rc.exe (Windows SDK) not found - exe without an icon; set RC=path\\to\\rc.exe");
        return;
    };
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let ver = std::env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.1.0".into());
    let mut n: Vec<u32> = ver.split('.').map(|p| p.parse().unwrap_or(0)).collect();
    n.resize(4, 0);
    let esc = |p: &std::path::Path| p.display().to_string().replace('\\', "\\\\");
    let script = format!(
        "1 ICON \"{ico}\"\n\
         1 VERSIONINFO\n FILEVERSION {a},{b},{c},{d}\n PRODUCTVERSION {a},{b},{c},{d}\n\
         BEGIN\n BLOCK \"StringFileInfo\"\n BEGIN\n  BLOCK \"040904B0\"\n  BEGIN\n\
           VALUE \"CompanyName\", \"ZeroCAD\"\n\
           VALUE \"FileDescription\", \"ZeroCAD - parametric CAD in the browser\"\n\
           VALUE \"FileVersion\", \"{ver} ({build})\"\n\
           VALUE \"ProductName\", \"ZeroCAD\"\n\
           VALUE \"ProductVersion\", \"{ver}\"\n\
           VALUE \"OriginalFilename\", \"zerocad.exe\"\n\
         END\n END\n BLOCK \"VarFileInfo\"\n BEGIN\n  VALUE \"Translation\", 0x409, 1200\n END\nEND\n",
        ico = esc(&ico), a = n[0], b = n[1], c = n[2], d = n[3]);
    let rc_path = out.join("zerocad.rc");
    let res_path = out.join("zerocad.res");
    std::fs::write(&rc_path, script).unwrap();
    let ok = Command::new(&rc)
        .args(["/nologo", "/fo"]).arg(&res_path).arg(&rc_path)
        .status().map(|s| s.success()).unwrap_or(false);
    if !ok {
        println!("cargo:warning=rc.exe failed - exe without an icon");
        return;
    }
    println!("cargo:rustc-link-arg-bins={}", res_path.display());
}

// rc.exe: переменная RC, иначе самая новая версия Windows SDK (x64)
fn find_rc() -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("RC") {
        let p = std::path::PathBuf::from(p);
        if p.exists() {
            return Some(p);
        }
    }
    let base = std::path::Path::new(r"C:\Program Files (x86)\Windows Kits\10\bin");
    let mut vers: Vec<std::path::PathBuf> = std::fs::read_dir(base).ok()?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.join("x64").join("rc.exe").exists())
        .collect();
    vers.sort_by_key(|p| {
        p.file_name().and_then(|n| n.to_str()).unwrap_or("")
            .split('.').map(|x| x.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>()
    });
    vers.pop().map(|p| p.join("x64").join("rc.exe"))
}
