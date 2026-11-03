//! `matte <model.onnx> <边长> <均值 r,g,b> <方差 r,g,b>`：stdio 的 JSON 行，与 `face-detect` 同一套形状（`process-host` 的 `JsonLineWorker`）。
//!
//! - 载入模型后推送 `{"event":"ready","params":{"loadMs":…}}`；载入失败时在 stderr 写原因、以 1 退出（在途请求随之失败）。
//! - 请求 `{"id":1,"method":"matte","params":{"input":"<PNG 或 JPEG 的绝对路径>","output":"<PNG 的绝对路径>","temporal":0.3,"reset":false}}`，
//!   响应 `{"id":1,"result":{"width":…,"height":…,"coverage":…,"ms":…}}`；读不了的图或推理失败是 `{"id":1,"error":{"code":"MATTE_FAILED","message":…}}`，
//!   不认识的方法 `UNKNOWN_METHOD`，形状不对 `INVALID_REQUEST`。
//! - stdin 关闭即退出。
//!
//! 错误说明是给 Runtime 日志看的开发者文字，不是给人看的界面文字。

use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::time::Instant;

use matte::{Matte, MatteOptions};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
struct Request {
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Deserialize)]
struct MatteParams {
    input: PathBuf,
    output: PathBuf,
    #[serde(default)]
    temporal: f32,
    #[serde(default)]
    reset: bool,
}

fn triple(text: &str) -> Option<[f32; 3]> {
    let parts: Vec<f32> = text.split(',').map(|part| part.trim().parse().ok()).collect::<Option<_>>()?;
    <[f32; 3]>::try_from(parts).ok()
}

fn parse_args() -> Option<(PathBuf, MatteOptions)> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [model, side, mean, std] = args.as_slice() else { return None };
    let options = MatteOptions {
        side: side.parse().ok().filter(|side| *side > 0)?,
        mean: triple(mean)?,
        std: triple(std)?,
    };
    Some((PathBuf::from(model), options))
}

fn main() {
    let Some((model, options)) = parse_args() else {
        eprintln!("usage: matte <model.onnx> <side> <mean r,g,b> <std r,g,b>");
        std::process::exit(2);
    };
    let started = Instant::now();
    let mut matte = match Matte::load(&model, options) {
        Ok(matte) => matte,
        Err(error) => {
            eprintln!("cannot load model {}: {error:#}", model.display());
            std::process::exit(1);
        }
    };
    let stdout = io::stdout();
    let mut out = stdout.lock();
    emit(
        &mut out,
        json!({ "event": "ready", "params": { "loadMs": started.elapsed().as_millis() as u64 } }),
    );
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let request = match serde_json::from_str::<Request>(&line) {
            Ok(request) => request,
            Err(error) => {
                eprintln!("bad request line: {error}");
                continue;
            }
        };
        let reply = match handle(&mut matte, &request) {
            Ok(result) => json!({ "id": request.id, "result": result }),
            Err((code, message)) => json!({ "id": request.id, "error": { "code": code, "message": message } }),
        };
        emit(&mut out, reply);
    }
}

fn handle(matte: &mut Matte, request: &Request) -> Result<Value, (&'static str, String)> {
    if request.method != "matte" {
        return Err(("UNKNOWN_METHOD", format!("unknown method {}", request.method)));
    }
    let params: MatteParams = serde_json::from_value(request.params.clone()).map_err(|error| ("INVALID_REQUEST", error.to_string()))?;
    let started = Instant::now();
    let outcome = matte
        .matte_file(&params.input, &params.output, params.temporal, params.reset)
        .map_err(|error| ("MATTE_FAILED", format!("{error:#}")))?;
    Ok(json!({
        "width": outcome.width,
        "height": outcome.height,
        "coverage": outcome.coverage,
        "ms": started.elapsed().as_millis() as u64,
    }))
}

fn emit(out: &mut impl Write, value: Value) {
    // stdout 关了（父进程走了）就没什么可做的了。
    if writeln!(out, "{value}").and_then(|()| out.flush()).is_err() {
        std::process::exit(0);
    }
}
