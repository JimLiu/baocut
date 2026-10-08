//! LLM 调用抽象（对拍 voice-ink `LLMJson.swift` 的错误分类与解析纪律）。
//!
//! 引擎只依赖 [`LlmJson`] trait；宿主提供 provider 直连或 agent 应答循环
//! 两种执行器。约束靠三层叠加：json_object（宿主负责）、fence-strip 解析、
//! 引擎侧确定性语义校验——失败走统一重试。

use serde::de::DeserializeOwned;

/// `--llm` 参数：`agent` 或 `provider:<vendor>/<model>`。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LlmMode {
    Agent,
    Provider { vendor: String, model: String },
}

impl LlmMode {
    pub fn parse(text: &str) -> Result<Self, String> {
        // 历史上 App 曾把 UI 装饰标签（"… · → 简体中文"）连同模型名写进
        // llm.default；模型 id 不含空白，截到首个空白即得机器 token。
        let text = text.trim();
        let text = text.split_whitespace().next().unwrap_or(text);
        if text == "agent" {
            return Ok(Self::Agent);
        }
        if let Some(rest) = text.strip_prefix("provider:") {
            let (vendor, model) = rest.split_once('/').ok_or_else(|| {
                format!("--llm provider 需形如 provider:<vendor>/<model>：{text}")
            })?;
            if vendor.is_empty() || model.is_empty() {
                return Err(format!(
                    "--llm provider 需形如 provider:<vendor>/<model>：{text}"
                ));
            }
            return Ok(Self::Provider {
                vendor: vendor.to_owned(),
                model: model.to_owned(),
            });
        }
        Err(format!(
            "未知 --llm 模式：{text}（agent | provider:<vendor>/<model>）"
        ))
    }
}

/// `--llm-effort`：provider 推理强度。`auto` 交给 provider 自己的缺省。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReasoningEffort {
    Auto,
    Low,
    Medium,
    High,
}

impl ReasoningEffort {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "auto" => Ok(Self::Auto),
            "low" => Ok(Self::Low),
            "medium" => Ok(Self::Medium),
            "high" => Ok(Self::High),
            other => Err(format!(
                "未知 --llm-effort {other}（可用：auto|low|medium|high）"
            )),
        }
    }
}

/// 一次 JSON-mode 调用请求。
#[derive(Debug, Clone)]
pub struct LlmRequest {
    /// "analysis" | "polish" | "polish-retry" | "segment-repair" | "seam-repair" | "punct-repair"
    /// | "speaker-repair" | "speaker-names"
    /// | "segment" | "segment-index" | "repunct" | "chapters" | "brief"
    /// | "translate-brief" | "translate" | "align" | "cleanup" | "broll"
    pub kind: &'static str,
    pub system: String,
    pub user: String,
    pub temperature: f32,
    /// One-based attempt number. Hosts use it for retry telemetry while the
    /// retry reason remains reserved for semantic prompt feedback.
    pub attempt: u32,
    /// 语义校验失败重试时注入的结构化原因（宿主转给 provider prompt 或
    /// agent problems）。
    pub retry_reason: Option<String>,
}

#[derive(Debug)]
pub enum LlmError {
    /// status=0 表示 DNS、连接、TLS 或超时等无 HTTP 响应的传输失败；它与
    /// 408/429/5xx 一样可重试。401/403/404 及其他 4xx 终止。
    Http {
        status: u16,
        message: String,
    },
    /// 响应不可用（无 JSON、解码失败、语义校验失败）——可重试。
    Malformed(String),
    /// provider 终止性错误（鉴权/模型不存在等），直接离开管线——
    /// 绝不拿降级结果掩盖配置问题。
    Terminal(String),
    Cancelled,
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Http { status, message } => write!(f, "HTTP {status}: {message}"),
            Self::Malformed(detail) => {
                write!(f, "The model returned unusable JSON — {detail}")
            }
            Self::Terminal(detail) => write!(f, "terminal: {detail}"),
            Self::Cancelled => write!(f, "cancelled"),
        }
    }
}

impl std::error::Error for LlmError {}

impl LlmError {
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Http { status, .. } => {
                *status == 0 || *status == 408 || *status == 429 || *status >= 500
            }
            Self::Malformed(_) => true,
            Self::Terminal(_) | Self::Cancelled => false,
        }
    }
}

/// 一次 JSON-mode 调用：system + user → 原始响应文本。
/// 解析、fence-strip、语义校验都在引擎侧。
pub trait LlmJson {
    fn complete(&mut self, request: &LlmRequest) -> Result<String, LlmError>;

    /// 一组互相独立的调用。默认逐个串行；agent 执行器覆盖为同时挂出全部
    /// 请求，让多个 worker 并行认领（每个请求仍是独立 call/租约）。每个
    /// 结果一就绪便回调，`index` 对应 `requests` 下标。默认实现保持 provider /
    /// FakeLlm 的逐个串行行为。
    fn complete_batch_with(
        &mut self,
        requests: &[LlmRequest],
        on_ready: &mut dyn FnMut(usize, Result<String, LlmError>),
    ) {
        for (index, request) in requests.iter().enumerate() {
            on_ready(index, self.complete(request));
        }
    }

    /// 兼容需要按请求顺序统一消费结果的引擎。底层仍经
    /// [`LlmJson::complete_batch_with`] 派发，因此 agent 可以并行执行。
    fn complete_batch(&mut self, requests: &[LlmRequest]) -> Vec<Result<String, LlmError>> {
        let mut slots: Vec<Option<Result<String, LlmError>>> =
            (0..requests.len()).map(|_| None).collect();
        self.complete_batch_with(requests, &mut |index, result| {
            if let Some(slot) = slots.get_mut(index) {
                *slot = Some(result);
            }
        });
        slots
            .into_iter()
            .enumerate()
            .map(|(index, slot)| {
                slot.unwrap_or_else(|| {
                    Err(LlmError::Terminal(format!(
                        "batch executor omitted result at index {index}"
                    )))
                })
            })
            .collect()
    }
}

/// fence-strip 解析：取响应中最外层 `{…}`，容忍 markdown 围栏与前后闲话。
pub fn decode<T: DeserializeOwned>(raw: &str) -> Result<T, LlmError> {
    let left = raw
        .find('{')
        .ok_or_else(|| LlmError::Malformed("no JSON object in the response".to_owned()))?;
    let right = raw
        .rfind('}')
        .filter(|&right| right > left)
        .ok_or_else(|| LlmError::Malformed("no JSON object in the response".to_owned()))?;
    serde_json::from_str(&raw[left..=right]).map_err(|error| LlmError::Malformed(error.to_string()))
}

/// 重试判定：terminal/cancelled 不重试；其余按分类；引擎抛出的语义错误
/// （映射失败 = attempt 失败）默认可重试。
pub fn should_retry(error: &LlmError) -> bool {
    error.is_retryable()
}

pub const MAX_RETRIES: u32 = 3;
pub const RETRY_BACKOFF_SECONDS: f64 = 2.0;

/// 全局重试策略（重试策略重设计 §2.6）：page-fatal 只允许整页重试
/// [`RetryPolicy::MAX_PAGE_ATTEMPTS`] 次，之后按各 kind 自己的分页器**对半缩窄**
/// （[`RetryPolicy::SPLIT_THEN`]）再各试一次；单元级补做波次最多
/// [`RetryPolicy::UNIT_ROUNDS`] 轮。总调用量与旧的 [`MAX_RETRIES`] 同量级，但
/// 兜底粒度减半。
///
/// [`MAX_RETRIES`] 保留给尚未迁移到本策略的调用点。
pub struct RetryPolicy;

impl RetryPolicy {
    /// page-fatal 的整页尝试次数（第 1 次首发、第 2 次带意见重发）。
    pub const MAX_PAGE_ATTEMPTS: u32 = 2;
    /// 整页尝试耗尽后是否对半分页再各试一次。
    pub const SPLIT_THEN: bool = true;
    /// 单元级补做波次的轮数上限。
    pub const UNIT_ROUNDS: u32 = 2;
}

/// [`complete_batch_retry_report`] 的结账：轮次耗尽后**每个**仍失败的请求。
///
/// 空 `failed` 即全部成功。非重试错误（Terminal/Cancelled/协议违规）不会进这里，
/// 它们照旧立即 `Err` 上抛。
#[derive(Debug, Default)]
pub struct BatchOutcome {
    /// `(requests` 下标, 最后一次失败原因)`，按下标升序。
    pub failed: Vec<(usize, LlmError)>,
}

impl BatchOutcome {
    /// 是否所有请求都成功。
    pub fn is_complete(&self) -> bool {
        self.failed.is_empty()
    }
}

/// 批量派发一组独立请求，并按页独立重试。成功项在底层结果就绪时立即交给
/// `on_ready`；失败项才进入下一轮，每轮只退避一次。completion 错误不会改写
/// 请求，只有引擎语义校验失败才通过 `validation_retry_reason` 注入重试原因。
/// 请求自带的 `retry_reason`（调用方在补做波次里说明「为什么重问」）原样随
/// 每一轮发出，直到被校验原因取代。
///
/// 与 [`complete_batch_retry_with`] 的差别只在结账：轮次耗尽时把**每个**失败页
/// 与原因交还调用方（[`BatchOutcome`]），而不是只报第一条。调用方因此可以只对
/// 失败页缩窄重试或确定性收口，其余页照常落库。
pub fn complete_batch_retry_report<T>(
    llm: &mut dyn LlmJson,
    requests: &[LlmRequest],
    attempts: u32,
    sleep: &mut dyn FnMut(f64),
    validate: &mut dyn FnMut(usize, &str) -> Result<T, LlmError>,
    validation_retry_reason: &mut dyn FnMut(usize, &LlmError) -> String,
    on_ready: &mut dyn FnMut(usize, T),
) -> Result<BatchOutcome, LlmError> {
    let attempts = attempts.max(1);
    let mut pending = (0..requests.len()).collect::<Vec<_>>();
    let mut retry_reasons = vec![None; requests.len()];

    for round in 0..attempts {
        if pending.is_empty() {
            return Ok(BatchOutcome::default());
        }
        if round > 0 {
            sleep(RETRY_BACKOFF_SECONDS);
        }
        let round_requests = pending
            .iter()
            .map(|&index| {
                let mut request = requests[index].clone();
                request.attempt = round + 1;
                request.retry_reason = retry_reasons[index]
                    .take()
                    .or_else(|| requests[index].retry_reason.clone());
                request
            })
            .collect::<Vec<_>>();
        let mut seen = vec![false; round_requests.len()];
        let mut failures: Vec<(usize, LlmError)> = Vec::new();
        let mut protocol_error = None;
        llm.complete_batch_with(&round_requests, &mut |slot, result| {
            let Some(&index) = pending.get(slot) else {
                protocol_error = Some(LlmError::Terminal(format!(
                    "batch executor returned out-of-range index {slot}"
                )));
                return;
            };
            if seen[slot] {
                protocol_error = Some(LlmError::Terminal(format!(
                    "batch executor returned index {slot} more than once"
                )));
                return;
            }
            seen[slot] = true;
            match result {
                Ok(raw) => match validate(index, &raw) {
                    Ok(value) => on_ready(index, value),
                    Err(error) => {
                        retry_reasons[index] = Some(validation_retry_reason(index, &error));
                        failures.push((index, error));
                    }
                },
                Err(error) => failures.push((index, error)),
            }
        });
        if let Some(error) = protocol_error {
            return Err(error);
        }
        for (slot, was_seen) in seen.into_iter().enumerate() {
            if !was_seen {
                failures.push((
                    pending[slot],
                    LlmError::Terminal(format!("batch executor omitted result at index {slot}")),
                ));
            }
        }
        failures.sort_by_key(|(index, _)| *index);
        if failures.is_empty() {
            return Ok(BatchOutcome::default());
        }
        if let Some(position) = failures.iter().position(|(_, error)| !should_retry(error)) {
            return Err(failures.remove(position).1);
        }
        if round + 1 == attempts {
            return Ok(BatchOutcome { failed: failures });
        }
        pending = failures.into_iter().map(|(index, _)| index).collect();
    }
    Ok(BatchOutcome::default())
}

/// [`complete_batch_retry_report`] 的薄封装：耗尽时只上抛**第一个**失败原因。
///
/// 尚未迁移到「拒绝即缩窄」的调用点继续用它；新代码应改用报告式变体，才能
/// 对每个失败单元分别缩窄或收口。
pub fn complete_batch_retry_with<T>(
    llm: &mut dyn LlmJson,
    requests: &[LlmRequest],
    attempts: u32,
    sleep: &mut dyn FnMut(f64),
    validate: &mut dyn FnMut(usize, &str) -> Result<T, LlmError>,
    validation_retry_reason: &mut dyn FnMut(usize, &LlmError) -> String,
    on_ready: &mut dyn FnMut(usize, T),
) -> Result<(), LlmError> {
    let outcome = complete_batch_retry_report(
        llm,
        requests,
        attempts,
        sleep,
        validate,
        validation_retry_reason,
        on_ready,
    )?;
    match outcome.failed.into_iter().next() {
        Some((_, error)) => Err(error),
        None => Ok(()),
    }
}

/// 带重试执行一个 attempt 闭包。退避 sleep 由宿主注入（core 零 I/O、零时钟）。
pub fn with_retry<T>(
    attempts: u32,
    mut sleep: impl FnMut(f64),
    mut attempt: impl FnMut(u32) -> Result<T, LlmError>,
) -> Result<T, LlmError> {
    let mut last = None;
    for index in 0..attempts.max(1) {
        if index > 0 {
            sleep(RETRY_BACKOFF_SECONDS);
        }
        match attempt(index) {
            Ok(value) => return Ok(value),
            Err(error) => {
                if !should_retry(&error) {
                    return Err(error);
                }
                last = Some(error);
            }
        }
    }
    Err(last.unwrap_or_else(|| LlmError::Malformed("no attempts executed".to_owned())))
}

/// 脚本化假实现（对拍 voice-ink `FakeLLMJSON`）：离线测试全部引擎逻辑。
pub struct FakeLlm {
    script: std::collections::VecDeque<Result<String, LlmError>>,
    /// 记录每次调用的 (kind, system, user, retry_reason)。
    pub calls: Vec<(String, String, String, Option<String>)>,
    pub attempts: Vec<u32>,
}

impl FakeLlm {
    pub fn new<I: IntoIterator<Item = Result<String, LlmError>>>(script: I) -> Self {
        Self {
            script: script.into_iter().collect(),
            calls: Vec::new(),
            attempts: Vec::new(),
        }
    }

    pub fn ok<I: IntoIterator<Item = &'static str>>(script: I) -> Self {
        Self::new(script.into_iter().map(|raw| Ok(raw.to_owned())))
    }
}

impl LlmJson for FakeLlm {
    fn complete(&mut self, request: &LlmRequest) -> Result<String, LlmError> {
        self.attempts.push(request.attempt);
        self.calls.push((
            request.kind.to_owned(),
            request.system.clone(),
            request.user.clone(),
            request.retry_reason.clone(),
        ));
        self.script
            .pop_front()
            .unwrap_or_else(|| Err(LlmError::Terminal("FakeLlm: script exhausted".to_owned())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize, PartialEq)]
    struct Shape {
        value: i32,
    }

    #[test]
    fn decode_strips_fences_and_prose() {
        let raw = "Sure! Here is the JSON:\n```json\n{\"value\": 42}\n```\nHope it helps.";
        assert_eq!(decode::<Shape>(raw).unwrap(), Shape { value: 42 });
        assert!(decode::<Shape>("no json here").is_err());
    }

    #[test]
    fn complete_batch_defaults_to_sequential_order() {
        let mut fake = FakeLlm::new([
            Ok("{\"value\": 1}".to_owned()),
            Err(LlmError::Malformed("bad".to_owned())),
            Ok("{\"value\": 3}".to_owned()),
        ]);
        let request = |kind| LlmRequest {
            kind,
            system: String::new(),
            user: String::new(),
            temperature: 0.1,
            attempt: 1,
            retry_reason: None,
        };
        let results = fake.complete_batch(&[request("align"), request("align"), request("align")]);
        assert_eq!(results.len(), 3);
        assert!(results[0].is_ok());
        assert!(results[1].is_err());
        assert_eq!(results[2].as_deref().unwrap(), "{\"value\": 3}");
        assert_eq!(fake.calls.len(), 3);
    }

    #[test]
    fn retry_classification_matches_voiceink() {
        assert!(
            LlmError::Http {
                status: 0,
                message: "connection reset".to_owned()
            }
            .is_retryable(),
            "无 HTTP 响应的短暂传输错误必须进入有界重试"
        );
        assert!(
            LlmError::Http {
                status: 429,
                message: String::new()
            }
            .is_retryable()
        );
        assert!(
            LlmError::Http {
                status: 503,
                message: String::new()
            }
            .is_retryable()
        );
        assert!(
            !LlmError::Http {
                status: 401,
                message: String::new()
            }
            .is_retryable()
        );
        assert!(
            !LlmError::Http {
                status: 404,
                message: String::new()
            }
            .is_retryable()
        );
        assert!(LlmError::Malformed("x".to_owned()).is_retryable());
        assert!(!LlmError::Terminal("x".to_owned()).is_retryable());
    }

    #[test]
    fn with_retry_stops_on_terminal_and_retries_malformed() {
        let mut sleeps = Vec::new();
        let mut fake = FakeLlm::new([
            Err(LlmError::Malformed("bad".to_owned())),
            Ok("{\"value\": 7}".to_owned()),
        ]);
        let request = LlmRequest {
            kind: "polish",
            system: String::new(),
            user: String::new(),
            temperature: 0.2,
            attempt: 1,
            retry_reason: None,
        };
        let value: Shape = with_retry(
            3,
            |s| sleeps.push(s),
            |_| {
                let raw = fake.complete(&request)?;
                decode(&raw)
            },
        )
        .unwrap();
        assert_eq!(value, Shape { value: 7 });
        assert_eq!(sleeps, vec![RETRY_BACKOFF_SECONDS]);

        let mut fake = FakeLlm::new([Err(LlmError::Terminal("401".to_owned()))]);
        let result: Result<Shape, _> = with_retry(
            3,
            |_| {},
            |_| {
                let raw = fake.complete(&request)?;
                decode(&raw)
            },
        );
        assert!(matches!(result, Err(LlmError::Terminal(_))));
        assert_eq!(fake.calls.len(), 1);
    }

    #[test]
    fn batch_retry_increments_attempt_even_without_validation_feedback() {
        let mut fake = FakeLlm::new([
            Err(LlmError::Http {
                status: 503,
                message: "busy".to_owned(),
            }),
            Ok("{\"value\": 9}".to_owned()),
        ]);
        let request = LlmRequest {
            kind: "translate",
            system: String::new(),
            user: String::new(),
            temperature: 0.2,
            attempt: 1,
            retry_reason: None,
        };
        let mut completed = Vec::new();
        complete_batch_retry_with(
            &mut fake,
            &[request],
            3,
            &mut |_| {},
            &mut |_, raw| decode::<Shape>(raw),
            &mut |_, error| error.to_string(),
            &mut |_, value| completed.push(value),
        )
        .unwrap();
        assert_eq!(fake.attempts, [1, 2]);
        assert_eq!(fake.calls[1].3, None);
        assert_eq!(completed, [Shape { value: 9 }]);
    }

    /// 报告式变体的结账：耗尽后每个失败页都要交还调用方（旧变体只报第一条），
    /// 成功页照常落库、不受失败页牵连。
    #[test]
    fn batch_retry_report_returns_every_exhausted_failure() {
        let request = |kind| LlmRequest {
            kind,
            system: String::new(),
            user: String::new(),
            temperature: 0.1,
            attempt: 1,
            retry_reason: None,
        };
        // 3 页 × 2 轮：页 0 首轮就成功，页 1/2 两轮都坏。
        let mut fake = FakeLlm::new([
            Ok("{\"value\": 1}".to_owned()),
            Err(LlmError::Malformed("p1".to_owned())),
            Err(LlmError::Malformed("p2".to_owned())),
            Err(LlmError::Malformed("p1 again".to_owned())),
            Err(LlmError::Malformed("p2 again".to_owned())),
        ]);
        let mut completed = Vec::new();
        let outcome = complete_batch_retry_report(
            &mut fake,
            &[request("polish"), request("polish"), request("polish")],
            2,
            &mut |_| {},
            &mut |_, raw| decode::<Shape>(raw),
            &mut |_, error| error.to_string(),
            &mut |index, value: Shape| completed.push((index, value)),
        )
        .expect("retryable failures must not abort the batch");
        assert_eq!(completed, [(0, Shape { value: 1 })]);
        assert_eq!(
            outcome
                .failed
                .iter()
                .map(|(index, _)| *index)
                .collect::<Vec<_>>(),
            [1, 2]
        );
        assert!(!outcome.is_complete());

        // 薄封装保持旧语义：只上抛第一条。
        let mut fake = FakeLlm::new([
            Err(LlmError::Malformed("a".to_owned())),
            Err(LlmError::Malformed("b".to_owned())),
        ]);
        let error = complete_batch_retry_with(
            &mut fake,
            &[request("polish")],
            2,
            &mut |_| {},
            &mut |_, raw| decode::<Shape>(raw),
            &mut |_, error| error.to_string(),
            &mut |_, _: Shape| {},
        )
        .expect_err("wrapper still surfaces the first failure");
        assert!(matches!(error, LlmError::Malformed(_)), "{error:?}");
    }

    /// 请求自带的重试原因随第一轮发出，传输失败后的下一轮仍然带着；校验失败
    /// 给出的原因取代它。
    #[test]
    fn batch_retry_report_keeps_the_requests_own_retry_reason() {
        let request = LlmRequest {
            kind: "polish",
            system: String::new(),
            user: String::new(),
            temperature: 0.1,
            attempt: 1,
            retry_reason: Some("asked again".to_owned()),
        };
        let mut fake = FakeLlm::new([
            Err(LlmError::Http {
                status: 0,
                message: "timeout".to_owned(),
            }),
            Ok("not json".to_owned()),
            Ok("{\"value\": 3}".to_owned()),
        ]);
        let mut completed = Vec::new();
        let outcome = complete_batch_retry_report(
            &mut fake,
            &[request],
            3,
            &mut |_| {},
            &mut |_, raw| decode::<Shape>(raw),
            &mut |_, _| "bad shape".to_owned(),
            &mut |_, value: Shape| completed.push(value),
        )
        .expect("third round succeeds");
        assert!(outcome.is_complete());
        assert_eq!(completed, [Shape { value: 3 }]);
        let reasons = fake
            .calls
            .iter()
            .map(|call| call.3.as_deref())
            .collect::<Vec<_>>();
        assert_eq!(
            reasons,
            [Some("asked again"), Some("asked again"), Some("bad shape")]
        );
    }

    /// Terminal 仍然立即上抛，不进 [`BatchOutcome::failed`]。
    #[test]
    fn batch_retry_report_still_aborts_on_terminal() {
        let mut fake = FakeLlm::new([Err(LlmError::Terminal("401".to_owned()))]);
        let request = LlmRequest {
            kind: "polish",
            system: String::new(),
            user: String::new(),
            temperature: 0.1,
            attempt: 1,
            retry_reason: None,
        };
        let error = complete_batch_retry_report(
            &mut fake,
            &[request],
            RetryPolicy::MAX_PAGE_ATTEMPTS,
            &mut |_| {},
            &mut |_, raw| decode::<Shape>(raw),
            &mut |_, error| error.to_string(),
            &mut |_, _: Shape| {},
        )
        .expect_err("terminal aborts");
        assert!(matches!(error, LlmError::Terminal(_)), "{error:?}");
        assert_eq!(fake.calls.len(), 1);
    }

    #[test]
    fn llm_mode_parses_agent_and_provider() {
        assert_eq!(LlmMode::parse("agent").unwrap(), LlmMode::Agent);
        assert_eq!(
            LlmMode::parse("provider:anthropic/claude-sonnet-5").unwrap(),
            LlmMode::Provider {
                vendor: "anthropic".to_owned(),
                model: "claude-sonnet-5".to_owned()
            }
        );
        assert!(LlmMode::parse("provider:x").is_err());
        assert!(LlmMode::parse("magic").is_err());
    }
}
