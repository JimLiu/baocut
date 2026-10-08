//! 系统的安全存储。macOS 钥匙串与 Windows Credential Manager 的 generic password；其他平台对每个请求回答 `unsupported`。

pub use platform::SystemKeychain;

#[cfg(target_os = "macos")]
mod platform {
    use security_framework::base::Error;
    use security_framework::item::{ItemClass, ItemSearchOptions, Limit};
    use security_framework::passwords::{delete_generic_password, get_generic_password, set_generic_password};

    use crate::{ErrorCode, HelperError, SecretBackend};

    // Security 框架的结果码（SecBase.h、MacErrors.h）。
    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
    const ERR_SEC_AUTH_FAILED: i32 = -25293;
    const ERR_SEC_USER_CANCELED: i32 = -128;
    const ERR_SEC_INTERACTION_NOT_ALLOWED: i32 = -25308;
    const ERR_SEC_INTERACTION_REQUIRED: i32 = -25315;
    const ERR_SEC_NOT_AVAILABLE: i32 = -25291;
    const ERR_SEC_NO_SUCH_KEYCHAIN: i32 = -25294;
    const ERR_SEC_READ_ONLY: i32 = -25292;
    const ERR_SEC_MISSING_ENTITLEMENT: i32 = -34018;

    /// 结果码到错误码。信息里只有结果码与系统的说明，没有 key 以外的请求内容。
    pub(crate) fn classify(code: i32) -> ErrorCode {
        match code {
            ERR_SEC_ITEM_NOT_FOUND => ErrorCode::NotFound,
            ERR_SEC_AUTH_FAILED | ERR_SEC_USER_CANCELED | ERR_SEC_INTERACTION_NOT_ALLOWED | ERR_SEC_INTERACTION_REQUIRED => {
                ErrorCode::Denied
            }
            ERR_SEC_NOT_AVAILABLE | ERR_SEC_NO_SUCH_KEYCHAIN | ERR_SEC_READ_ONLY | ERR_SEC_MISSING_ENTITLEMENT => ErrorCode::Unavailable,
            _ => ErrorCode::Internal,
        }
    }

    fn failure(error: Error) -> HelperError {
        let code = error.code();
        let detail = error.message().unwrap_or_default();
        HelperError::new(classify(code), format!("钥匙串返回 {code}：{detail}"))
    }

    /// 登录钥匙串里 service 为 [`crate::SERVICE`] 的 generic password，account 是 key。
    pub struct SystemKeychain;

    impl SecretBackend for SystemKeychain {
        fn get(&self, key: &str) -> Result<String, HelperError> {
            let bytes = get_generic_password(crate::SERVICE, key).map_err(failure)?;
            String::from_utf8(bytes).map_err(|_| HelperError::new(ErrorCode::Internal, "钥匙串里的内容不是 UTF-8"))
        }

        fn set(&self, key: &str, secret: &str) -> Result<(), HelperError> {
            set_generic_password(crate::SERVICE, key, secret.as_bytes()).map_err(failure)
        }

        fn delete(&self, key: &str) -> Result<(), HelperError> {
            delete_generic_password(crate::SERVICE, key).map_err(failure)
        }

        fn legacy_accounts(&self, service: &str) -> Result<Vec<String>, HelperError> {
            if !matches!(service, "BaoCut" | "VoiceInk") {
                return Err(HelperError::new(ErrorCode::Internal, "Unsupported legacy service"));
            }
            let items = ItemSearchOptions::new()
                .class(ItemClass::generic_password())
                .service(service)
                .load_attributes(true)
                .limit(Limit::All)
                .search();
            match items {
                Ok(items) => {
                    let mut accounts = Vec::new();
                    for item in items {
                        let attributes = item
                            .simplify_dict()
                            .ok_or_else(|| HelperError::new(ErrorCode::Internal, "Invalid legacy account attributes"))?;
                        if let Some(account) = attributes.get("acct") {
                            accounts.push(account.clone());
                        }
                    }
                    accounts.sort();
                    accounts.dedup();
                    Ok(accounts)
                }
                Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(Vec::new()),
                Err(error) => Err(failure(error)),
            }
        }

        /// 只查属性，不读出密钥。
        fn has(&self, key: &str) -> Result<bool, HelperError> {
            let found = ItemSearchOptions::new()
                .class(ItemClass::generic_password())
                .service(crate::SERVICE)
                .account(key)
                .load_attributes(true)
                .limit(1)
                .search();
            match found {
                Ok(items) => Ok(!items.is_empty()),
                Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(false),
                Err(error) => Err(failure(error)),
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn result_codes_map_to_the_closed_set() {
            assert_eq!(classify(-25300), ErrorCode::NotFound);
            assert_eq!(classify(-128), ErrorCode::Denied);
            assert_eq!(classify(-25293), ErrorCode::Denied);
            assert_eq!(classify(-25308), ErrorCode::Denied);
            assert_eq!(classify(-25291), ErrorCode::Unavailable);
            assert_eq!(classify(-34018), ErrorCode::Unavailable);
            assert_eq!(classify(-50), ErrorCode::Internal);
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use crate::{ErrorCode, HelperError, SecretBackend};

    /// 这个平台还没有安全存储的实现（架构设计 §14）。
    pub struct SystemKeychain;

    fn unsupported() -> HelperError {
        HelperError::new(ErrorCode::Unsupported, "这个平台还不支持系统的安全存储")
    }

    impl SecretBackend for SystemKeychain {
        fn get(&self, _key: &str) -> Result<String, HelperError> {
            Err(unsupported())
        }
        fn set(&self, _key: &str, _secret: &str) -> Result<(), HelperError> {
            Err(unsupported())
        }
        fn delete(&self, _key: &str) -> Result<(), HelperError> {
            Err(unsupported())
        }
        fn has(&self, _key: &str) -> Result<bool, HelperError> {
            Err(unsupported())
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use crate::{ErrorCode, HelperError, SecretBackend};

    pub struct SystemKeychain;

    fn failure(error: keyring::Error) -> HelperError {
        // Never format a keyring error: BadEncoding and Ambiguous may contain secrets.
        let code = match error {
            keyring::Error::NoEntry => ErrorCode::NotFound,
            keyring::Error::NoStorageAccess(_) => ErrorCode::Denied,
            keyring::Error::PlatformFailure(_) => ErrorCode::Unavailable,
            _ => ErrorCode::Internal,
        };
        HelperError::new(code, "Windows credential operation failed")
    }

    fn entry(service: &str, account: &str) -> Result<keyring::Entry, HelperError> {
        keyring::Entry::new(service, account).map_err(failure)
    }

    impl SecretBackend for SystemKeychain {
        fn get(&self, key: &str) -> Result<String, HelperError> {
            entry(crate::SERVICE, key)?.get_password().map_err(failure)
        }
        fn set(&self, key: &str, secret: &str) -> Result<(), HelperError> {
            entry(crate::SERVICE, key)?.set_password(secret).map_err(failure)
        }
        fn delete(&self, key: &str) -> Result<(), HelperError> {
            entry(crate::SERVICE, key)?.delete_credential().map_err(failure)
        }
        fn has(&self, key: &str) -> Result<bool, HelperError> {
            match entry(crate::SERVICE, key)?.get_attributes() {
                Ok(_) => Ok(true),
                Err(keyring::Error::NoEntry) => Ok(false),
                Err(error) => Err(failure(error)),
            }
        }
        fn legacy_get(&self, provider: &str) -> Result<String, HelperError> {
            // v2 used keyring::Entry::new("bcut", provider), target <provider>.bcut,
            // with JSON encoded by keyring as UTF-16. Keep that exact convention.
            entry("bcut", provider)?.get_password().map_err(failure)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn failures_never_include_credential_bytes() {
            let error = failure(keyring::Error::BadEncoding(b"private-key".to_vec()));
            assert_eq!(error.code, ErrorCode::Internal);
            assert!(!error.message.contains("private-key"));
            assert_eq!(failure(keyring::Error::NoEntry).code, ErrorCode::NotFound);
        }
    }
}
