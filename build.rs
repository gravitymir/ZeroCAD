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
}
