//! Render Worker（架构设计 §9.13）：成片导出的独立进程。Runtime 写好冻结的导出输入（JSON 文件），按两步调用：
//!
//! - `export-worker preflight <input.json>`：预检，结果是 stdout 上的一个 JSON 对象（帧数、画不出来的项、警告、缺的编码器，
//!   以及要用到的本机字体 face，Runtime 按它冻结字体）；
//! - `export-worker render <input.json>`：逐帧求计划（`render-graph`）、画成一帧（`frame-render`）、写进编码器（`media-core`）。
//!   stdout 是 JSON 行：`progress`（已画完、交给编码队列的帧数与总帧数）、最后一行 `done`、`error` 或 `cancelled`；
//! - `export-worker census <input.json>`：只排一遍字，清点视频用到的字体（`fonts.usage`）：stdout 上一个 JSON 对象，
//!   点了名的全部 face（`bundled` 标出随内核发布的）与内核的回退族（`fallback`）；
//! - `export-worker master <input.json>`：开了响度标准化时，把混好的声音做成目标响度（[`master`]），stdout 同样是 JSON 行，
//!   最后一行是 `mastered`。
//!
//! 标准输入收到 `cancel` 一行或被关闭（Runtime 退出）时取消：停下合成，杀掉解码与编码的子进程，删掉没写完的输出。
//! 独立进程让合成的崩溃与内存不影响 Runtime 与引擎；引擎宿主照常处理编辑请求，导出读的是启动时冻结的输入。

mod input;
mod master;
mod preflight;
mod render;
mod sources;

use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;

use serde_json::{Value, json};

/// 失败：协议的错误码与说明。
#[derive(Debug)]
pub struct Failure {
    pub code: String,
    pub message: String,
    pub details: Value,
}

impl Failure {
    pub fn new(code: &str, message: impl Into<String>) -> Failure {
        Failure {
            code: code.into(),
            message: message.into(),
            details: Value::Null,
        }
    }
}

/// stdout 的一行 JSON。
pub fn emit(value: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (command, path) = match args.as_slice() {
        [command, path] if matches!(command.as_str(), "preflight" | "census" | "render" | "master") => {
            (command.as_str(), PathBuf::from(path))
        }
        _ => {
            eprintln!("用法：export-worker preflight|census|render|master <input.json>");
            return ExitCode::from(2);
        }
    };
    let result = match command {
        "preflight" => preflight_command(&path),
        "census" => census_command(&path),
        "master" => master::run(&path),
        _ => render::run(&path),
    };
    match result {
        Ok(code) => code,
        Err(failure) => {
            emit(&json!({
                "event": "error",
                "code": failure.code,
                "message": failure.message,
                "details": failure.details,
            }));
            ExitCode::from(1)
        }
    }
}

fn census_command(path: &std::path::Path) -> Result<ExitCode, Failure> {
    let input = input::Input::load(path)?;
    let usage = preflight::font_usage(&input)?;
    let faces: Vec<Value> = usage
        .faces
        .iter()
        .map(|(family, weight, italic)| {
            json!({ "family": family, "weight": weight, "italic": italic, "bundled": !usage.missing.contains(family) })
        })
        .collect();
    emit(&json!({ "event": "census", "faces": faces, "fallback": frame_render::FALLBACK_FAMILY }));
    Ok(ExitCode::SUCCESS)
}

fn preflight_command(path: &std::path::Path) -> Result<ExitCode, Failure> {
    let input = input::Input::load(path)?;
    let tools = input.tools();
    let report = preflight::run(&input, &tools)?;
    let faces: Vec<Value> = preflight::font_faces(&input)?
        .into_iter()
        .map(|(family, weight, italic)| json!({ "family": family, "weight": weight, "italic": italic }))
        .collect();
    emit(&json!({
        "event": "preflight",
        "frames": report.frames,
        "items": report.items,
        "warnings": report.warnings,
        "missingEncoders": report.missing_encoders,
        "faces": faces,
    }));
    Ok(ExitCode::SUCCESS)
}
