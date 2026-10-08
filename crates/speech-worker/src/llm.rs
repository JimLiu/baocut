//! 核心的 `LlmJson` 落在 stdio 上：一次调用 = 一个 `llm.request` 事件 + 阻塞等 Runtime 的 `llm.reply`。
//!
//! Worker 不联网、不持有密钥：Runtime 收到请求后经流程既有的 `generateText` 路径发出（选 Provider、授权、任务预算、
//! 账本与停止屏障都在那边），把文本或分类过的失败交回来。重试、半页、逐单元修复仍是核心自己的语义（`RetryPolicy`）。
//!
//! 请求的整形从 v2 `bcut-engine/src/llm_exec.rs` 原样移植：文件契约的 kind 把载体包进内联输入信封、按输入定标输出上限，
//! 重试原因附在信封外。这些是提示词的一部分，归 Worker（架构设计 §13.6）；Runtime 只按模型能力去掉温度、夹输出上限。

use std::cell::RefCell;
use std::rc::Rc;

use serde_json::{Value, json};
use speech_doc::filepipe::common::{max_output_chars, uses_file_contract};
use speech_doc::llm::{LlmError, LlmJson, LlmRequest};

use crate::protocol::{Control, ErrorClass, Reply, ReplyError, Waited, event};

/// 经 stdio 的模型调用。
pub struct StdioLlm {
    control: Rc<RefCell<Control>>,
    next_id: u64,
    /// 发出的调用数（含核心自己的重试）。
    pub calls: u64,
    /// 第一个终止性失败（预算、授权、停止屏障……）：任务的错误照它报。
    pub terminal: Option<ReplyError>,
}

impl StdioLlm {
    pub fn new(control: Rc<RefCell<Control>>) -> StdioLlm {
        StdioLlm {
            control,
            next_id: 1,
            calls: 0,
            terminal: None,
        }
    }
}

impl LlmJson for StdioLlm {
    fn complete(&mut self, request: &LlmRequest) -> Result<String, LlmError> {
        let mut control = self.control.borrow_mut();
        control.poll();
        if control.stopped() {
            return Err(LlmError::Cancelled);
        }
        let request_id = self.next_id;
        self.next_id += 1;
        self.calls += 1;
        event("llm.request", request_params(request_id, request));
        match control.wait_reply(request_id) {
            Waited::Stopped => Err(LlmError::Cancelled),
            Waited::Reply(Reply::Text(text)) => Ok(text),
            Waited::Reply(Reply::Error(error)) => {
                let mapped = match error.class {
                    ErrorClass::Retryable => LlmError::Http {
                        status: error.status.unwrap_or(0),
                        message: format!("{}: {}", error.code, error.message),
                    },
                    ErrorClass::Malformed => LlmError::Malformed(format!("{}: {}", error.code, error.message)),
                    ErrorClass::Terminal => LlmError::Terminal(format!("{}: {}", error.code, error.message)),
                    ErrorClass::Cancelled => LlmError::Cancelled,
                };
                if matches!(error.class, ErrorClass::Terminal | ErrorClass::Cancelled) && self.terminal.is_none() {
                    self.terminal = Some(error);
                }
                Err(mapped)
            }
        }
    }
}

/// `llm.request` 事件的参数。
pub fn request_params(request_id: u64, request: &LlmRequest) -> Value {
    let file_contract = uses_file_contract(request.kind);
    json!({
        "requestId": request_id,
        "kind": request.kind,
        "attempt": request.attempt,
        "system": request.system,
        "user": request_user_content(request, file_contract),
        "temperature": request.temperature,
        "maxOutputTokens": file_contract.then(|| file_contract_max_output_tokens(&request.user)),
    })
}

/// 文件契约下该 kind 的载体：`(逻辑文件名后缀, media-type)`（v2 `file_carrier_format_opt`）。
pub fn file_carrier_format(kind: &str) -> (&'static str, &'static str) {
    match kind {
        "translate" => ("html", "text/html"),
        "translate-lines" => ("txt", "text/plain"),
        "polish" | "segment-repair" | "seam-repair" | "punct-repair" | "speaker-repair" | "speaker-names" => ("txt", "text/plain"),
        "align" | "align-edges" | "align-rewrite" => ("html", "text/html"),
        "chapters" | "chapters-outline" => ("html", "text/html"),
        "analysis" | "translate-brief" | "brief" => ("md", "text/markdown"),
        _ => ("txt", "text/plain"),
    }
}

/// 内联输入信封的逻辑文件名：按 kind 稳定的词干，同一页在修复轮里不换名字（不打断提示词缓存）。
fn inline_input_name(kind: &str) -> String {
    format!("{kind}.src.{}", file_carrier_format(kind).0)
}

const FILE_CONTRACT_OUTPUT_CHARS_PER_TOKEN: usize = 2;
const FILE_CONTRACT_MIN_OUTPUT_TOKENS: u64 = 4_096;
const FILE_CONTRACT_MAX_OUTPUT_TOKENS: u64 = 16_384;

/// 文件契约下按输入定标的输出上限（token）。Runtime 再夹到模型的上限之内。
pub fn file_contract_max_output_tokens(input: &str) -> u64 {
    let tokens = max_output_chars(input.chars().count()).div_ceil(FILE_CONTRACT_OUTPUT_CHARS_PER_TOKEN);
    (tokens as u64).clamp(FILE_CONTRACT_MIN_OUTPUT_TOKENS, FILE_CONTRACT_MAX_OUTPUT_TOKENS)
}

/// 用户消息正文：文件契约下包进内联输入信封；重试上下文留在信封外——它是指令，不是文档内容。
pub fn request_user_content(request: &LlmRequest, file_contract: bool) -> String {
    let body = if file_contract {
        let (_, media_type) = file_carrier_format(request.kind);
        format!(
            "<BEGIN INPUT name=\"{}\" media-type=\"{media_type}\">\n{}\n<END INPUT>",
            inline_input_name(request.kind),
            request.user
        )
    } else {
        request.user.clone()
    };
    match request.retry_reason.as_deref() {
        Some(reason) => format!("{body}\n\n[retry context — the previous answer failed validation: {reason}]"),
        None => body,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(kind: &'static str, retry: Option<&str>) -> LlmRequest {
        LlmRequest {
            kind,
            system: "sys".into(),
            user: "<article></article>".into(),
            temperature: 0.2,
            attempt: 1,
            retry_reason: retry.map(str::to_owned),
        }
    }

    #[test]
    fn file_contracts_are_wrapped_and_retry_context_stays_outside() {
        let content = request_user_content(&request("translate", Some("missing p")), true);
        assert_eq!(
            content,
            "<BEGIN INPUT name=\"translate.src.html\" media-type=\"text/html\">\n<article></article>\n<END INPUT>\n\n[retry context — the previous answer failed validation: missing p]"
        );
        assert_eq!(request_user_content(&request("brief", None), false), "<article></article>");
    }

    #[test]
    fn output_limit_is_clamped() {
        assert_eq!(file_contract_max_output_tokens("short"), 4_096);
        assert_eq!(file_contract_max_output_tokens(&"x".repeat(100_000)), 16_384);
    }

    #[test]
    fn request_params_carry_no_limit_for_json_kinds() {
        let params = request_params(7, &request("brief", None));
        assert_eq!(params["requestId"], 7);
        assert!(params["maxOutputTokens"].is_null());
        let params = request_params(8, &request("align-edges", None));
        assert_eq!(params["maxOutputTokens"], 4_096);
    }
}
