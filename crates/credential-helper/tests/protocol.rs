//! 协议层的行为：用内存里的存放代替钥匙串，不访问系统的安全存储。

use std::cell::RefCell;
use std::collections::HashMap;

use credential_helper::{ErrorCode, HelperError, SecretBackend, handle_line};
use serde_json::{Value, json};

#[derive(Default)]
struct Memory {
    items: RefCell<HashMap<String, String>>,
    /// 设了的话，每个操作都以这个错误失败。
    fail: Option<ErrorCode>,
}

impl Memory {
    fn check(&self) -> Result<(), HelperError> {
        match self.fail {
            Some(code) => Err(HelperError::new(code, "模拟的失败")),
            None => Ok(()),
        }
    }
}

impl SecretBackend for Memory {
    fn get(&self, key: &str) -> Result<String, HelperError> {
        self.check()?;
        self.items
            .borrow()
            .get(key)
            .cloned()
            .ok_or_else(|| HelperError::new(ErrorCode::NotFound, "没有这个条目"))
    }
    fn set(&self, key: &str, secret: &str) -> Result<(), HelperError> {
        self.check()?;
        self.items.borrow_mut().insert(key.to_owned(), secret.to_owned());
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<(), HelperError> {
        self.check()?;
        self.items
            .borrow_mut()
            .remove(key)
            .map(|_| ())
            .ok_or_else(|| HelperError::new(ErrorCode::NotFound, "没有这个条目"))
    }
    fn legacy_get(&self, provider: &str) -> Result<String, HelperError> {
        self.get(&format!("legacy:{provider}"))
    }
    fn has(&self, key: &str) -> Result<bool, HelperError> {
        self.check()?;
        Ok(self.items.borrow().contains_key(key))
    }
}

fn call(backend: &Memory, request: Value) -> Value {
    serde_json::from_str(&handle_line(&request.to_string(), backend)).expect("响应是一行 JSON")
}

#[test]
fn four_operations_round_trip() {
    let memory = Memory::default();
    assert_eq!(
        call(&memory, json!({ "op": "has", "key": "provider:openai" })),
        json!({ "ok": true, "exists": false })
    );
    assert_eq!(
        call(&memory, json!({ "op": "set", "key": "provider:openai", "secret": "sk-1" })),
        json!({ "ok": true })
    );
    assert_eq!(
        call(&memory, json!({ "op": "has", "key": "provider:openai" })),
        json!({ "ok": true, "exists": true })
    );
    assert_eq!(
        call(&memory, json!({ "op": "get", "key": "provider:openai" })),
        json!({ "ok": true, "secret": "sk-1" })
    );
    assert_eq!(
        call(&memory, json!({ "op": "delete", "key": "provider:openai" })),
        json!({ "ok": true })
    );
    let missing = call(&memory, json!({ "op": "get", "key": "provider:openai" }));
    assert_eq!(missing["ok"], false);
    assert_eq!(missing["error"], "not-found");
    assert_eq!(
        call(&memory, json!({ "op": "delete", "key": "provider:openai" }))["error"],
        "not-found"
    );
}

#[test]
fn backend_errors_use_the_closed_set() {
    for (code, wire) in [
        (ErrorCode::Denied, "denied"),
        (ErrorCode::Unavailable, "unavailable"),
        (ErrorCode::Unsupported, "unsupported"),
        (ErrorCode::Internal, "internal"),
    ] {
        let memory = Memory {
            fail: Some(code),
            ..Memory::default()
        };
        let response = call(&memory, json!({ "op": "set", "key": "node:n1", "secret": "tok-secret" }));
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"], wire);
        assert!(!response.to_string().contains("tok-secret"), "错误响应不带密钥");
    }
}

#[test]
fn malformed_requests_are_internal_and_never_echo_the_secret() {
    let memory = Memory::default();
    for line in [
        "not json sk-leak".to_owned(),
        json!({ "op": "set", "key": "", "secret": "sk-leak" }).to_string(),
        json!({ "op": "set", "key": "a\nb", "secret": "sk-leak" }).to_string(),
        json!({ "op": "set", "key": "provider:x", "secret": "" }).to_string(),
        json!({ "op": "get", "key": "provider:x", "secret": "sk-leak" }).to_string(),
        json!({ "op": "list", "key": "provider:x" }).to_string(),
        json!({ "op": "set", "key": "provider:x", "secret": "sk-leak", "extra": 1 }).to_string(),
        format!(
            "{{\"op\":\"set\",\"key\":\"provider:x\",\"secret\":\"sk-leak{}",
            "x".repeat(300 * 1024)
        ),
    ] {
        let response: Value = serde_json::from_str(&handle_line(&line, &memory)).unwrap();
        assert_eq!(response["ok"], false, "{line:.60}");
        assert_eq!(response["error"], "internal");
        assert!(!response.to_string().contains("sk-leak"));
    }
    assert!(memory.items.borrow().is_empty());
}

/// 真实钥匙串的往返。会在登录钥匙串里写入并删除一个测试条目，可能弹出授权提示，所以默认不跑。
///
/// 手动运行（macOS 钥匙串或 Windows Credential Manager）：
///
/// ```sh
/// CARGO_TARGET_DIR=/Volumes/ExtremeSSD/cargo-target/credential-store \
///   cargo test -p credential-helper --test protocol -- --ignored real_keychain_round_trip
/// ```
#[test]
#[ignore = "访问真实的登录钥匙串；手动运行"]
fn real_keychain_round_trip() {
    use credential_helper::keychain::SystemKeychain;
    let key = format!("test:credential-helper:{}", std::process::id());
    let keychain = SystemKeychain;
    let run = |request: Value| -> Value { serde_json::from_str(&handle_line(&request.to_string(), &keychain)).unwrap() };
    assert_eq!(run(json!({ "op": "has", "key": key })), json!({ "ok": true, "exists": false }));
    assert_eq!(run(json!({ "op": "set", "key": key, "secret": "s3cret" })), json!({ "ok": true }));
    assert_eq!(run(json!({ "op": "has", "key": key })), json!({ "ok": true, "exists": true }));
    assert_eq!(run(json!({ "op": "get", "key": key })), json!({ "ok": true, "secret": "s3cret" }));
    assert_eq!(run(json!({ "op": "set", "key": key, "secret": "s3cret-2" })), json!({ "ok": true }));
    assert_eq!(run(json!({ "op": "get", "key": key }))["secret"], "s3cret-2");
    assert_eq!(run(json!({ "op": "delete", "key": key })), json!({ "ok": true }));
    assert_eq!(run(json!({ "op": "get", "key": key }))["error"], "not-found");
}

#[test]
fn legacy_discovery_is_read_only_and_restricted_to_baocut_services() {
    let memory = Memory::default();
    for service in ["BaoCut", "VoiceInk"] {
        assert_eq!(
            call(&memory, json!({ "op": "legacy-accounts", "key": service }))["error"],
            "unsupported"
        );
    }
    for service in ["com.other.app", "com.baocut.runtime"] {
        assert_eq!(
            call(&memory, json!({ "op": "legacy-accounts", "key": service }))["error"],
            "internal"
        );
    }
    assert_eq!(
        call(&memory, json!({ "op": "legacy-accounts", "key": "BaoCut", "secret": "private" }))["error"],
        "internal"
    );
    assert!(memory.items.borrow().is_empty());
}

#[test]
fn legacy_provider_reads_are_scoped_and_never_remove_the_old_entry() {
    let memory = Memory::default();
    memory.items.borrow_mut().insert("legacy:openai".into(), "old-json-secret".into());
    assert_eq!(
        call(&memory, json!({"op":"legacy-get", "key":"openai"})),
        json!({"ok":true,"secret":"old-json-secret"})
    );
    assert!(memory.items.borrow().contains_key("legacy:openai"));
    assert_eq!(call(&memory, json!({"op":"legacy-get", "key":"missing"}))["error"], "not-found");
    assert_eq!(
        call(&memory, json!({"op":"legacy-get", "key":"provider:openai"}))["error"],
        "internal"
    );
    assert_eq!(
        call(&memory, json!({"op":"legacy-get", "key":"openai", "secret":"do-not-write"}))["error"],
        "internal"
    );
}
