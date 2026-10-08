# 约定

<!-- surface: cli -->
成功时 stdout 是 `{ ok: true, result, next? }`；`next` 是建议的下一条命令。
<!-- /surface -->

## 错误码之后做什么

<!-- generated: error-codes -->
<!-- surface: cli -->
| 错误码 | 退出码 | 下一步 |
| --- | --- | --- |
| `CAPABILITY_NOT_CONFIGURED` `DUB_SEPARATION_NOT_CONFIGURED` `MODELS_DIR_MISSING` `CREDENTIAL_UNAVAILABLE` `AUTHENTICATION_REQUIRED` `OFFLINE_STRICT` `GRANT_REQUIRED` `GRANT_REVOKED` `BUDGET_EXCEEDED` `BUDGET_UNVERIFIABLE` `TASK_BUDGET_EXCEEDED` `TASK_BUDGET_UNVERIFIABLE` `TOOL_UNAVAILABLE` `TOOL_CONSENT_REQUIRED` `TOOL_UPDATE_CONFIRM_REQUIRED` `TOOL_UPDATE_MANUAL` `MEDIA_TOOL_UNAVAILABLE` `EXPORT_TOOL_MISSING` `LINK_LOGIN_REQUIRED` `LINK_COOKIES_UNAVAILABLE` `LINK_TOOL_UPDATE_REQUIRED` `VOICE_CONSENT_REQUIRED` `VOICE_CLONE_REQUIRED` | 2 | 要用户先做一件事：配置能力、授权或预算、同意或安装外部工具、登录、音色授权。把 `remedy` 原样转告用户，用户做完后照 `next` 重试；不用脚本、别的服务商或手改配置绕过 |
| `RUNTIME_UNAVAILABLE` `RUNTIME_START_FAILED` `PROTOCOL_MISMATCH` `INTERFACE_VERSION_MISMATCH` `CATALOG_UNAVAILABLE` | 3 | Runtime 不可用或版本不同。先 `baocut runtime ensure`；接口版本不同时请用户更新 BaoCut 或 CLI，不绕过 |
| `INVALID_ARGUMENTS` `UNKNOWN_COMMAND` `UNKNOWN_TOOL` `CONFIRMATION_REQUIRED` | 4 | 参数不对：对照 `baocut help <命令>` 或 `baocut spec <名字>` 改；缺 `--yes` 时先问用户，用户同意后再加 |
| `RUNTIME_NOT_OWNED` `RUNTIME_IN_USE` | 1 | Runtime 不归这个 CLI 停，或还有人在用：不停它，留着 |
| 其他错误码 | 1 | 失败或取消。看 `retryability`：`after-refresh` 先重新读再提交（版本冲突 `PROJECT_REVISION_CONFLICT` 时重新 {{tool:videos_inspect}}）；`after-user-action` 转告用户；`never` 换做法。等待超时（`WAIT_TIMEOUT`）时任务还在跑，用 {{tool:jobs_wait}} 接着等 |
<!-- /surface -->
<!-- surface: agent -->
| 错误码 | 下一步 |
| --- | --- |
| `CAPABILITY_NOT_CONFIGURED` `DUB_SEPARATION_NOT_CONFIGURED` `MODELS_DIR_MISSING` `CREDENTIAL_UNAVAILABLE` `AUTHENTICATION_REQUIRED` `OFFLINE_STRICT` `GRANT_REQUIRED` `GRANT_REVOKED` `BUDGET_EXCEEDED` `BUDGET_UNVERIFIABLE` `TASK_BUDGET_EXCEEDED` `TASK_BUDGET_UNVERIFIABLE` `TOOL_UNAVAILABLE` `TOOL_CONSENT_REQUIRED` `TOOL_UPDATE_CONFIRM_REQUIRED` `TOOL_UPDATE_MANUAL` `MEDIA_TOOL_UNAVAILABLE` `EXPORT_TOOL_MISSING` `LINK_LOGIN_REQUIRED` `LINK_COOKIES_UNAVAILABLE` `LINK_TOOL_UPDATE_REQUIRED` `VOICE_CONSENT_REQUIRED` `VOICE_CLONE_REQUIRED` | 要用户先做一件事：配置能力、授权或预算、同意或安装外部工具、登录、音色授权。把 `remedy` 原样转告用户，用户做完后照 `next` 重试；不绕过 |
| `INVALID_ARGUMENTS` `UNKNOWN_TOOL` | 参数或工具名不对：对照工具的 schema 改；`edits_apply` 的操作字段用 {{tool:edits_ops}} 取 |
| 其他错误码 | 失败或取消。看 `retryability`：`after-refresh` 先重新读再提交（版本冲突 `PROJECT_REVISION_CONFLICT` 时重新 {{tool:videos_inspect}}）；`after-user-action` 转告用户；`never` 换做法 |
<!-- /surface -->
<!-- /generated -->
