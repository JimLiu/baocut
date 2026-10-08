//! 凭据助手进程入口（架构设计 §6.8）。读 stdin 的第一行请求，向 stdout 写一行响应后退出。
//!
//! 不读命令行参数与环境变量里的任何密钥；不往 stderr 写请求或响应的内容。

use std::io::{self, BufRead, Read, Write};

use credential_helper::keychain::SystemKeychain;
use credential_helper::{MAX_REQUEST_BYTES, handle_line};

fn main() {
    let stdin = io::stdin();
    // 多读一个字节：超过上限的请求由协议层按不合规回答。
    let mut reader = stdin.lock().take(MAX_REQUEST_BYTES as u64 + 1);
    let mut line = String::new();
    let response = match reader.read_line(&mut line) {
        Ok(_) => handle_line(line.trim_end_matches(['\r', '\n']), &SystemKeychain),
        Err(_) => r#"{"ok":false,"error":"internal","message":"读不到请求"}"#.to_owned(),
    };
    let mut out = io::stdout().lock();
    let written = out.write_all(response.as_bytes()).is_ok() && out.write_all(b"\n").is_ok() && out.flush().is_ok();
    std::process::exit(if written { 0 } else { 1 });
}
