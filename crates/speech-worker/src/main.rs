//! Speech Worker（架构设计 §7.9、§13.1）：字幕与翻译核心（`speech-doc`）的独立进程。固定流程的一步启动一个，
//! 跑完退出；协议见命令协议规范 §4.5。
//!
//! - stdin / stdout 是 JSON 行：`hello`、`translate`（冻结的输入与 staging 目录）、`llm.reply`、`cancel`；
//!   Worker 推 `llm.request`、`progress`、`checkpoint`、`resumed` 事件，任务以 `translate` 的结果或错误结束。
//! - 模型调用一律交回 Runtime（`llm.request` → `llm.reply`），Worker 不联网、不持有密钥，只写 staging。
//! - stdin 关闭（Runtime 退出或放弃这个进程）时：正在跑的任务停在下一次模型调用或退避之前，检查点保留，进程退出。

mod checkpoint;
mod input;
mod llm;
mod protocol;
mod translate;

use std::cell::RefCell;
use std::path::PathBuf;
use std::process::ExitCode;
use std::rc::Rc;

use serde_json::{Value, json};

use protocol::{Control, Inbound, hello, respond, respond_error};

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

    pub fn with_details(code: &str, message: impl Into<String>, details: Value) -> Failure {
        Failure {
            code: code.into(),
            message: message.into(),
            details,
        }
    }
}

fn main() -> ExitCode {
    if std::env::args().len() > 1 {
        eprintln!("用法：speech-worker（stdin / stdout 上的 JSON 行，见命令协议规范 §4.5）");
        return ExitCode::from(2);
    }
    let control = Rc::new(RefCell::new(Control::new(protocol::spawn_reader())));
    loop {
        let message = control.borrow_mut().next();
        match message {
            Inbound::Closed => return ExitCode::SUCCESS,
            Inbound::Malformed { line } => eprintln!("speech-worker: 读不懂的一行输入（{} 字节）", line.len()),
            Inbound::Request { id, method, params } => match method.as_str() {
                "hello" => respond(&id, hello()),
                // 空闲时的取消：没有要停的任务。
                "cancel" => {
                    if !id.is_null() {
                        respond(&id, json!({}));
                    }
                }
                "translate" => {
                    control.borrow_mut().reset();
                    match job_paths(&params) {
                        Ok((input, staging)) => match translate::run(&input, &staging, control.clone()) {
                            Ok(result) => respond(&id, result),
                            Err(failure) => respond_error(&id, &failure.code, &failure.message, failure.details),
                        },
                        Err(failure) => respond_error(&id, &failure.code, &failure.message, failure.details),
                    }
                    if control.borrow().closed() {
                        return ExitCode::SUCCESS;
                    }
                }
                "llm.reply" => respond_error(&id, "UNEXPECTED_REPLY", "没有在等模型调用的应答", Value::Null),
                other => respond_error(&id, "METHOD_NOT_FOUND", &format!("没有方法 {other}"), Value::Null),
            },
        }
    }
}

fn job_paths(params: &Value) -> Result<(PathBuf, PathBuf), Failure> {
    let path = |key: &str| {
        params
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| Failure::new("INVALID_PARAMS", format!("translate 缺少 {key}")))
    };
    Ok((path("input")?, path("staging")?))
}
