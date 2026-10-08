//! Engine Host 进程入口（架构设计 §2.3）。
//!
//! stdin 每行一个请求 `{"id", "method", "params"}`；stdout 每行一个响应 `{"id", "result"}` / `{"id", "error"}`，
//! 或一条推送 `{"event": "video.event", "params": VideoEvent}`。推送总在触发它的响应之前写出。
//! stdout 只写协议；日志写 stderr。stdin 关闭（Runtime 退出）或 stdout 写不进去时退出，锁随进程释放。
//!
//! 请求按到达的顺序处理，只有 `fonts.*`（解析、列族名、检查字体文件）例外：它们交给字体线程（[`fonts::FontWorker`]），第一次要扫一遍本机字体，
//! 期间别的请求照常处理，它的响应晚一些写出（Runtime 按 `id` 配对，不要求按顺序）。stdin 关闭时等已收下的字体请求答完再退出。

#![allow(clippy::result_large_err)]

mod barrier;
mod content;
mod exports;
mod fonts;
mod host;
mod package;

use std::io::{self, BufRead, BufWriter, Write};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use message_ref::msg;
use serde_json::{Value, json};
use video_engine::{ErrorBody, Retryability};

/// stdout：主循环与字体线程共用，一行在锁里整行写完。
#[derive(Clone)]
pub struct Output(Arc<Mutex<Box<dyn Write + Send>>>);

impl Output {
    fn stdout() -> Output {
        Output::new(Box::new(BufWriter::new(io::stdout())))
    }

    pub fn new(writer: Box<dyn Write + Send>) -> Output {
        Output(Arc::new(Mutex::new(writer)))
    }

    /// 写一行并刷出去。写不进去时退出：Runtime 不再读，没有人能收到回执，继续运行只会持有锁。
    pub fn write_line(&self, value: &Value) {
        let mut out = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let ok = serde_json::to_writer(&mut **out, value).is_ok() && out.write_all(b"\n").is_ok() && out.flush().is_ok();
        if !ok {
            std::process::exit(0);
        }
    }
}

/// 处理请求时崩溃的回执。
pub fn panic_response(id: Value, method: &str) -> Value {
    eprintln!("engine-host: 处理 {method} 时崩溃");
    let error = ErrorBody::new(
        "ENGINE_PANIC",
        msg!(
            "engineHost.enginePanic",
            "The engine failed while handling the request, and the change was not committed"
        ),
        Retryability::SameCommand,
    );
    json!({ "id": id, "error": error })
}

fn main() {
    let ffprobe = PathBuf::from(std::env::var("BAOCUT_FFPROBE").unwrap_or_else(|_| "ffprobe".into()));
    let mut host = host::Host::new(ffprobe);
    let out = Output::stdout();
    let mut fonts = fonts::FontWorker::new(out.clone());
    let stdin = io::stdin();

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("engine-host: 无法解析请求：{e}");
                continue;
            }
        };
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let method = request.get("method").and_then(Value::as_str).unwrap_or("").to_string();
        let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
        if method.starts_with("fonts.") {
            fonts.submit(id, &method, params);
            continue;
        }

        let mut events = Vec::new();
        let outcome = catch_unwind(AssertUnwindSafe(|| host.handle(&method, params, &mut |e| events.push(e.clone()))));
        for event in events {
            out.write_line(&json!({ "event": "video.event", "params": event }));
        }
        let response = match outcome {
            Ok(Ok(result)) => json!({ "id": id, "result": result }),
            Ok(Err(error)) => json!({ "id": id, "error": error }),
            Err(_) => panic_response(id, &method),
        };
        out.write_line(&response);
    }
    fonts.finish();
}
