//! stdio 上的 JSON 行（Speech Worker 协议，命令协议规范 §4.5）。
//!
//! 形状与 Model Worker、Engine Host 相同：Runtime 发 `{id, method, params}`，Worker 回 `{id, result}` / `{id, error}`，
//! Worker 主动推 `{event, params}`。stdin 由一个读线程读，按行解析后放进通道；主线程在等模型应答、退避与两页之间
//! 从通道里取。stdin 关闭（Runtime 退出或放弃这个进程）是 `Closed`：正在跑的任务当作取消，处理完就退出。

use std::collections::VecDeque;
use std::io::{BufRead, Write};
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

/// 协议的名字与版本；`hello` 的结果里给出，Runtime 不认得就不用这个 Worker。
pub const PROTOCOL: &str = "speech-worker/1";

/// 读线程交来的一条输入。
#[derive(Debug)]
pub enum Inbound {
    Request {
        id: Value,
        method: String,
        params: Value,
    },
    /// 一行不是 JSON 对象，或缺 `method`。
    Malformed {
        line: String,
    },
    Closed,
}

/// stdout 的一行 JSON。写失败（Runtime 已经不在）不报错：读线程随后会看到 stdin 关闭。
pub fn emit(value: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

pub fn event(name: &str, params: Value) {
    emit(&json!({ "event": name, "params": params }));
}

pub fn respond(id: &Value, result: Value) {
    emit(&json!({ "id": id, "result": result }));
}

pub fn respond_error(id: &Value, code: &str, message: &str, details: Value) {
    let mut error = json!({ "code": code, "message": message });
    if !details.is_null() {
        error["details"] = details;
    }
    emit(&json!({ "id": id, "error": error }));
}

/// 起读线程：一行一条，读完或出错时交一个 `Closed`。
pub fn spawn_reader() -> Receiver<Inbound> {
    let (tx, rx) = channel();
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            let Ok(line) = line else { break };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            // 与 export-worker 一样认得一行裸的 `cancel`。
            let message = if trimmed == "cancel" {
                Inbound::Request {
                    id: Value::Null,
                    method: "cancel".into(),
                    params: Value::Null,
                }
            } else {
                match serde_json::from_str::<Value>(trimmed) {
                    Ok(Value::Object(mut object)) => match object.remove("method") {
                        Some(Value::String(method)) => Inbound::Request {
                            id: object.remove("id").unwrap_or(Value::Null),
                            method,
                            params: object.remove("params").unwrap_or(Value::Null),
                        },
                        _ => Inbound::Malformed { line: trimmed.to_owned() },
                    },
                    _ => Inbound::Malformed { line: trimmed.to_owned() },
                }
            };
            if tx.send(message).is_err() {
                return;
            }
        }
        let _ = tx.send(Inbound::Closed);
    });
    rx
}

/// 一次模型调用的应答（`llm.reply` 的参数）。
#[derive(Debug, Clone, PartialEq)]
pub enum Reply {
    Text(String),
    Error(ReplyError),
}

/// Runtime 给的失败：`class` 决定核心怎么处理（可重试、答案不可用、终止、取消）。
#[derive(Debug, Clone, PartialEq)]
pub struct ReplyError {
    pub code: String,
    pub message: String,
    pub class: ErrorClass,
    /// 可重试的失败带的 HTTP 状态；没有时按传输失败（0）。
    pub status: Option<u16>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorClass {
    Retryable,
    Malformed,
    Terminal,
    Cancelled,
}

impl ErrorClass {
    fn parse(value: &str) -> Option<ErrorClass> {
        match value {
            "retryable" => Some(ErrorClass::Retryable),
            "malformed" => Some(ErrorClass::Malformed),
            "terminal" => Some(ErrorClass::Terminal),
            "cancelled" => Some(ErrorClass::Cancelled),
            _ => None,
        }
    }
}

/// 等应答时的结局。
#[derive(Debug)]
pub enum Waited {
    Reply(Reply),
    /// 收到 `cancel`，或 stdin 关闭。
    Stopped,
}

/// 任务进行中的通道：取消与关闭的状态、等应答、可被取消的退避。
pub struct Control {
    rx: Receiver<Inbound>,
    /// 等应答时先到的、与这次等待无关的请求（例如下一条 `translate`）：任务结束后由主循环处理。
    deferred: VecDeque<Inbound>,
    cancelled: bool,
    closed: bool,
}

impl Control {
    pub fn new(rx: Receiver<Inbound>) -> Control {
        Control {
            rx,
            deferred: VecDeque::new(),
            cancelled: false,
            closed: false,
        }
    }

    /// 已经收到 `cancel` 或 stdin 已关闭。
    pub fn stopped(&self) -> bool {
        self.cancelled || self.closed
    }

    pub fn closed(&self) -> bool {
        self.closed
    }

    /// 新任务开始：清掉上一个任务的取消。
    pub fn reset(&mut self) {
        self.cancelled = false;
    }

    /// 主循环取下一条输入（先取任务期间攒下的）。
    pub fn next(&mut self) -> Inbound {
        if let Some(message) = self.deferred.pop_front() {
            return message;
        }
        self.rx.recv().unwrap_or(Inbound::Closed)
    }

    /// 不阻塞地处理已经到了的输入。
    pub fn poll(&mut self) {
        while let Ok(message) = self.rx.try_recv() {
            self.handle_busy(message, None);
        }
    }

    /// 阻塞到 `request_id` 的应答、取消或 stdin 关闭。
    pub fn wait_reply(&mut self, request_id: u64) -> Waited {
        loop {
            if self.stopped() {
                return Waited::Stopped;
            }
            let message = self.rx.recv().unwrap_or(Inbound::Closed);
            if let Some(reply) = self.handle_busy(message, Some(request_id)) {
                return Waited::Reply(reply);
            }
        }
    }

    /// 退避：最多等 `seconds` 秒；期间照常处理输入，取消或关闭时立即返回。
    pub fn sleep(&mut self, seconds: f64) {
        if seconds.is_nan() || seconds <= 0.0 {
            self.poll();
            return;
        }
        let deadline = Instant::now() + Duration::from_secs_f64(seconds.min(600.0));
        while !self.stopped() {
            let now = Instant::now();
            if now >= deadline {
                return;
            }
            match self.rx.recv_timeout(deadline - now) {
                Ok(message) => {
                    self.handle_busy(message, None);
                }
                Err(RecvTimeoutError::Timeout) => return,
                Err(RecvTimeoutError::Disconnected) => self.closed = true,
            }
        }
    }

    /// 任务进行中收到的一条输入。返回等着的那次调用的应答。
    fn handle_busy(&mut self, message: Inbound, waiting: Option<u64>) -> Option<Reply> {
        match message {
            Inbound::Closed => {
                self.closed = true;
                None
            }
            Inbound::Malformed { line } => {
                eprintln!("speech-worker: 读不懂的一行输入（{} 字节）", line.len());
                None
            }
            Inbound::Request { id, method, params } => match method.as_str() {
                "cancel" => {
                    self.cancelled = true;
                    if !id.is_null() {
                        respond(&id, json!({}));
                    }
                    None
                }
                "hello" => {
                    respond(&id, hello());
                    None
                }
                "llm.reply" => match parse_reply(&params) {
                    Ok((request_id, reply)) if Some(request_id) == waiting => {
                        respond(&id, json!({}));
                        Some(reply)
                    }
                    Ok((request_id, _)) => {
                        respond_error(
                            &id,
                            "UNEXPECTED_REPLY",
                            "没有在等这次模型调用的应答",
                            json!({ "requestId": request_id }),
                        );
                        None
                    }
                    Err(problem) => {
                        respond_error(&id, "INVALID_PARAMS", &problem, Value::Null);
                        None
                    }
                },
                _ => {
                    // 一次只跑一个任务：别的请求等这个任务结束后由主循环处理。
                    self.deferred.push_back(Inbound::Request { id, method, params });
                    None
                }
            },
        }
    }
}

/// `hello` 的结果。
pub fn hello() -> Value {
    json!({
        "protocol": PROTOCOL,
        "version": env!("CARGO_PKG_VERSION"),
        "methods": ["translate"],
    })
}

fn parse_reply(params: &Value) -> Result<(u64, Reply), String> {
    let request_id = params.get("requestId").and_then(Value::as_u64).ok_or("llm.reply 缺少 requestId")?;
    if let Some(text) = params.get("text").and_then(Value::as_str) {
        return Ok((request_id, Reply::Text(text.to_owned())));
    }
    let error = params.get("error").ok_or("llm.reply 既没有 text 也没有 error")?;
    let class = error
        .get("class")
        .and_then(Value::as_str)
        .and_then(ErrorClass::parse)
        .ok_or("llm.reply 的 error.class 应为 retryable、malformed、terminal 或 cancelled")?;
    let text = |key: &str| error.get(key).and_then(Value::as_str).unwrap_or_default().to_owned();
    Ok((
        request_id,
        Reply::Error(ReplyError {
            code: text("code"),
            message: text("message"),
            class,
            status: error
                .get("status")
                .and_then(Value::as_u64)
                .and_then(|status| u16::try_from(status).ok()),
        }),
    ))
}
