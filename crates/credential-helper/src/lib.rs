//! 凭据助手的协议（架构设计 §6.8）：一个进程处理一个请求。
//!
//! stdin 一行 JSON 请求 `{"op": "get" | "set" | "delete" | "has", "key": string, "secret"?: string}`，
//! stdout 一行 JSON 响应：成功是 `{"ok": true}`，`get` 另带 `"secret"`，`has` 另带 `"exists"`；
//! 失败是 `{"ok": false, "error": <错误码>, "message": string}`，错误码是封闭集合（见 [`ErrorCode`]）。
//!
//! 升级专用的只读操作：`legacy-accounts` 仅枚举 BaoCut / VoiceInk 的账号属性，
//! `legacy-get` 仅按 provider 读取 Windows v2 的 bcut 服务条目；
//! `legacy-read` 静默读取 macOS BaoCut / VoiceInk / bcut 的指定账号，不删除或改写旧凭据。
//!
//! 密钥只经 stdin 与 stdout 传递：不进命令行参数、环境变量、stderr 与错误信息。

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub mod keychain;

/// 钥匙串条目的 service；account 是请求里的 key（如 `provider:openai`、`node:<nodeId>`）。
pub const SERVICE: &str = "com.baocut.runtime";

/// 一行请求的上限：key 与密钥都很短，超过的按不合规处理。
pub const MAX_REQUEST_BYTES: usize = 256 * 1024;
const MAX_KEY_BYTES: usize = 512;

/// 失败的种类（封闭集合）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorCode {
    /// 没有这个条目（`get` 与 `delete`）。
    NotFound,
    /// 用户或系统拒绝了访问（取消授权提示、认证失败、不允许交互）。
    Denied,
    /// 钥匙串此刻不可用（被锁且不能解锁、没有默认钥匙串、缺少权限声明）。
    Unavailable,
    /// 这个平台没有实现。
    Unsupported,
    /// 其他错误，包括不合规的请求。
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelperError {
    pub code: ErrorCode,
    pub message: String,
}

impl HelperError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// 存放密钥的地方。macOS 上是钥匙串、Windows 上是 Credential Manager（[`keychain::SystemKeychain`]），测试里是内存。
pub trait SecretBackend {
    fn get(&self, key: &str) -> Result<String, HelperError>;
    fn set(&self, key: &str, secret: &str) -> Result<(), HelperError>;
    fn delete(&self, key: &str) -> Result<(), HelperError>;
    fn has(&self, key: &str) -> Result<bool, HelperError>;
    /// Read one v2 Windows provider from its original bcut service, without deleting it.
    fn legacy_get(&self, _provider: &str) -> Result<String, HelperError> {
        Err(HelperError::new(ErrorCode::Unsupported, "Legacy provider access is unavailable"))
    }
    /// Background macOS migration must never request keychain authorization.
    fn legacy_read(&self, _service: &str, _account: &str) -> Result<String, HelperError> {
        Err(HelperError::new(ErrorCode::Unsupported, "Legacy credential access is unavailable"))
    }
    /// Only historical BaoCut services; returns account names, never secret values.
    fn legacy_accounts(&self, _service: &str) -> Result<Vec<String>, HelperError> {
        Err(HelperError::new(ErrorCode::Unsupported, "Legacy account discovery is unavailable"))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    op: String,
    key: String,
    #[serde(default)]
    secret: Option<String>,
    #[serde(default)]
    service: Option<String>,
}

/// 处理一行请求，返回一行响应（不含换行）。只有密码读取操作成功时带密钥。
pub fn handle_line(line: &str, backend: &dyn SecretBackend) -> String {
    let response = match parse(line) {
        Ok(request) => dispatch(&request, backend),
        Err(error) => Err(error),
    };
    let value = match response {
        Ok(value) => value,
        Err(error) => json!({ "ok": false, "error": error.code, "message": error.message }),
    };
    value.to_string()
}

fn parse(line: &str) -> Result<Request, HelperError> {
    if line.len() > MAX_REQUEST_BYTES {
        return Err(HelperError::new(ErrorCode::Internal, "请求过长"));
    }
    // 解析错误的细节可能引用请求的片段（其中可能有密钥）：不放进响应。
    let request: Request = serde_json::from_str(line).map_err(|_| HelperError::new(ErrorCode::Internal, "请求不是合规的 JSON"))?;
    if request.key.is_empty() || request.key.len() > MAX_KEY_BYTES || request.key.chars().any(char::is_control) {
        return Err(HelperError::new(ErrorCode::Internal, "key 不合规"));
    }
    Ok(request)
}

fn dispatch(request: &Request, backend: &dyn SecretBackend) -> Result<Value, HelperError> {
    let key = request.key.as_str();
    if request.op == "legacy-read" {
        return match (request.service.as_deref(), request.secret.as_deref()) {
            (Some(service @ ("BaoCut" | "VoiceInk" | "bcut")), None) => backend
                .legacy_read(service, key)
                .map(|secret| json!({ "ok": true, "secret": secret })),
            _ => Err(HelperError::new(ErrorCode::Internal, "Invalid legacy credential request")),
        };
    }
    if request.service.is_some() {
        return Err(HelperError::new(ErrorCode::Internal, "Only legacy-read accepts service"));
    }
    match (request.op.as_str(), request.secret.as_deref()) {
        ("legacy-accounts", None) if matches!(key, "BaoCut" | "VoiceInk") => backend
            .legacy_accounts(key)
            .map(|accounts| json!({ "ok": true, "accounts": accounts })),
        ("legacy-get", None) if key.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') => {
            backend.legacy_get(key).map(|secret| json!({ "ok": true, "secret": secret }))
        }
        ("get", None) => backend.get(key).map(|secret| json!({ "ok": true, "secret": secret })),
        ("set", Some(secret)) if !secret.is_empty() => backend.set(key, secret).map(|()| json!({ "ok": true })),
        ("set", _) => Err(HelperError::new(ErrorCode::Internal, "set 要给出非空的 secret")),
        ("delete", None) => backend.delete(key).map(|()| json!({ "ok": true })),
        ("has", None) => backend.has(key).map(|exists| json!({ "ok": true, "exists": exists })),
        ("get" | "delete" | "has", Some(_)) => Err(HelperError::new(ErrorCode::Internal, "只有 set 带 secret")),
        _ => Err(HelperError::new(ErrorCode::Internal, "不认识的操作")),
    }
}
