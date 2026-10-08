# macOS 签名材料、备份与跨机器发布

此文档管理 BaoCut 的 Developer ID 签名身份与 Apple 公证凭据。应用打包布局见[桌面端 README](../apps/desktop/README.md)，提交与发布产物规则见[开发流程 §5](development-workflow.md#5-工作区与产物)。

## 目录

- [1. 应用与签名身份](#1-应用与签名身份)
- [2. 备份材料与保存位置](#2-备份材料与保存位置)
- [3. 新证书签发与恢复演练](#3-新证书签发与恢复演练)
- [4. 在另一台 Mac 发布](#4-在另一台-mac-发布)
- [5. GitHub Actions 配置](#5-github-actions-配置)
- [6. 发布与备份完成条件](#6-发布与备份完成条件)
- [7. 官方参考](#7-官方参考)

## 1. 应用与签名身份

| 项目 | 值与规则 |
| --- | --- |
| 产品名 | `BaoCut` |
| 新应用 Bundle ID | `com.baocut.app`；Apple Developer 中的描述为 `BaoCut Desktop` |
| 首次目标版本 | `3.0.0`；应用版本与证书有效期独立 |
| Apple Developer Team ID | `22FY8U8BF9` |
| 签名证书类型 | `Developer ID Application`，供 Mac App Store 外分发 |
| 公证钥匙串 profile | `${BAOCUT_NOTARY_PROFILE:-baocut-notary}`；名字可迁移，里面的凭据需在新机器重新配置 |

Bundle ID 不是证书名称。不同证书可拥有相同的显示名称；要求复用**同一张证书**时，签名前必须比对完整指纹，不能仅凭 `Developer ID Application: Chunli XIe (22FY8U8BF9)` 选中其中任意一张。新证书签发后将其 SHA-1、SHA-256、序列号、有效期与保存文件名写入仓库外的 `signing-inventory.json`。

新 ID 与旧 `com.jimliu.baocut` 是两个应用身份。旧版更新器的 Bundle ID 校验会拒绝新 ID，不能直接把旧版更新源指向新包。换包、钥匙串访问与旧项目迁移必须分别演练；不能以“签名属于同一 Team”为迁移已通过的证据。

## 2. 备份材料与保存位置

默认本机目录为 `~/.baocut-release/signing/com.baocut.app/`，目录权限 `700`，文件权限 `600`。这是本机保存位置，**只有复制到另一处安全存储并保存解密密码后，才算完成灾备**。

| 材料 | 保存方式 | 用途 |
| --- | --- | --- |
| `developer-id-<SHA1>.p12` | 密码保护的 PKCS#12，包含目标证书和匹配的私钥；仓库外与加密离线备份各一份 | 另一台 Mac 或 CI 使用相同签名身份 |
| `developer-id-<SHA1>.cer` 或 `.pem` | 公共证书，与 `.p12` 一起保存 | 核对证书身份；单独不能签名 |
| CSR `.certSigningRequest` | 保存申请所用请求 | 申请追溯；不包含私钥 |
| `.p12` 密码 | 密码管理器单独保存，与备份文件分开 | 解密签名身份 |
| 公证凭据 | App Store Connect API 私钥 `.p8` + Key ID + Issuer ID，或 Apple ID + Team ID + app-specific password | `notarytool` 提交与查询 |
| `signing-inventory.json` | 不含密码与私钥，记录 Bundle ID、Team、证书两种指纹、序列号、有效期、备份文件摘要和恢复验证状态 | 防止拿错证书或把待备份误报为已备份 |
| 每次发布的报告 | 版本、build、完整源 commit、文件大小与 SHA-256、签名指纹、公证 submission ID、验证结果 | 追溯与恢复发布 |

密码、私钥、`.p12`、`.p8`、Keychain 数据库及其 Base64 内容不得进入 git、应用资源、发布附件、测试日志或 Actions artifacts。Base64 只用于把文件装进 GitHub Secret，不提供加密。不要整库导出 login keychain：只导出本次选中的签名身份，避免夹带其他产品的私钥。

Apple 只提供公共证书下载，不保存可重新下载的签名私钥。丢失私钥后，重新下载 `.cer` 无法恢复同一签名身份。

## 3. 新证书签发与恢复演练

1. 在本机生成 CSR 与对应私钥。在 Apple Developer 选择 `Developer ID Application` 并提交 CSR，下载签发后的 `.cer`。保留旧证书，不能为申请新证书而撤销正在出货的身份。
2. 将 `.cer` 导入生成私钥的同一台 Mac。在 Xcode › Settings › Accounts › Manage Certificates，选择**新签发且指纹匹配**的证书，使用 Export Certificate 导出加密 `.p12`；也可在 Keychain Access 的 My Certificates 中导出对应身份。密码由持有人在系统安全输入框输入，不发送到聊天。
3. 保存公共证书、CSR、加密 `.p12` 和清单。清单先把 `privateKeyBackupVerified` 设为 `false`；公共证书备份不能把此值改成 `true`。
4. 将 `.p12` 导入一个临时钥匙串，用其中的身份签一个临时二进制并验证。确认 SHA-1 与 SHA-256 对上目标证书，才将 `privateKeyBackupVerified` 设为 `true`。演练不能只检查 `.p12` 文件存在或能读到证书。
5. 将加密备份复制到第二处安全存储，解密密码单独保存。记录恢复演练结果与备份位置的提示，不把真实秘密写入清单。

查看本机可用身份（只显示公共名称和 SHA-1）：

```bash
security find-identity -v -p codesigning
```

核对某份公共证书，PEM 文件去掉 `-inform DER`：

```bash
openssl x509 -inform DER -in developer-id.cer \
  -noout -subject -issuer -serial -dates -fingerprint -sha256
```

## 4. 在另一台 Mac 发布

通过安全渠道搬运加密 `.p12`，再在 Keychain Access 中导入，安全输入密码；核对 `security find-identity -v -p codesigning` 的指纹。签名身份没有匹配私钥时不得继续构建正式包。

公证与签名是两套凭据。复制 `.p12` 不会复制 `baocut-notary` profile，也不应通过导出整个钥匙串来搬迁公证密码。

使用 Apple ID 的方式，在终端交互式创建 profile；不传 `--password`，让 `notarytool` 安全提示输入 app-specific password：

```bash
xcrun notarytool store-credentials baocut-notary \
  --apple-id '<发布用 Apple ID>' --team-id 22FY8U8BF9
xcrun notarytool history --keychain-profile baocut-notary
```

使用团队 App Store Connect API key 的方式：

```bash
xcrun notarytool store-credentials baocut-notary \
  --key '/安全路径/AuthKey_<KEY_ID>.p8' \
  --key-id '<KEY_ID>' --issuer '<ISSUER_UUID>'
xcrun notarytool history --keychain-profile baocut-notary
```

个人 API key 不传 `--issuer`。选择哪一种凭据以 Apple 账号实际可用权限和 `notarytool` 校验成功为准。`.p8` 下载后立即加密保存；不为了 CI 新建比公证所需范围更广的账号权限。

通过 `notarytool history` 验证 profile 访问；通用钥匙串查询找不到条目不能证明 profile 不存在，也不需要读取或打印其中的密码。

然后安装相同 Node / Rust / Xcode 工具链，检出发布报告中的源 commit，按发布流程重新构建、签名、公证。身份相同不意味着重新构建的 ZIP 字节相同；已经公开的版本/build 文件保持不可变，重建不同字节必须使用新的 build。

## 5. GitHub Actions 配置

### 5.1 Secrets 与变量

后续在发布 Environment（建议命名 `macos-release`）配置以下值；本地备份不自动上传到 GitHub。

| 名称 | 类型 | 内容 |
| --- | --- | --- |
| `BAOCUT_MAC_CERTIFICATE_BASE64` | Secret | 目标 `.p12` 的 Base64 |
| `BAOCUT_MAC_CERTIFICATE_PASSWORD` | Secret | `.p12` 密码 |
| `BAOCUT_MAC_KEYCHAIN_PASSWORD` | Secret | CI 临时钥匙串的随机密码，不是本机登录密码 |
| `BAOCUT_MAC_SIGNING_SHA1` | Variable | 目标证书完整 SHA-1，40 位 hex |
| `BAOCUT_APPLE_TEAM_ID` | Variable | `22FY8U8BF9` |
| `BAOCUT_NOTARY_API_KEY_BASE64` | Secret，API key 方式 | `.p8` 的 Base64 |
| `BAOCUT_NOTARY_KEY_ID` | Secret，API key 方式 | Key ID |
| `BAOCUT_NOTARY_ISSUER_ID` | Secret，团队 API key 方式 | Issuer ID |
| `BAOCUT_NOTARY_APPLE_ID` | Secret，Apple ID 方式 | 发布用 Apple ID |
| `BAOCUT_NOTARY_APP_PASSWORD` | Secret，Apple ID 方式 | app-specific password |

二选一配置公证凭据。正式构建只在 macOS 原生 runner 上运行；当前 Apple Silicon Worker 用 arm64 runner。使用 `workflow_dispatch` 手动触发，固定源 commit，不让 PR、普通 push 或不可信 fork 获得签名凭据。workflow 仅在发布阶段引入 Secrets。

### 5.2 临时钥匙串

以下是签名前的准备步骤，**不是当前仓库已执行的 Actions 发布流水线**。在 step 的 `env` 中将上表对应 Secret / Variable 映射为同名环境变量；不要开启 shell tracing 或打印环境。

```bash
set -euo pipefail
set +x
umask 077
BAOCUT_CI_KEYCHAIN="$RUNNER_TEMP/baocut-signing.keychain-db"
BAOCUT_CI_P12="$RUNNER_TEMP/baocut-signing.p12"
security list-keychains -d user > "$RUNNER_TEMP/baocut-keychains-before.txt"
printf '%s' "$BAOCUT_MAC_CERTIFICATE_BASE64" | base64 --decode > "$BAOCUT_CI_P12"
security create-keychain -p "$BAOCUT_MAC_KEYCHAIN_PASSWORD" "$BAOCUT_CI_KEYCHAIN"
security set-keychain-settings -lut 21600 "$BAOCUT_CI_KEYCHAIN"
security unlock-keychain -p "$BAOCUT_MAC_KEYCHAIN_PASSWORD" "$BAOCUT_CI_KEYCHAIN"
security import "$BAOCUT_CI_P12" -k "$BAOCUT_CI_KEYCHAIN" \
  -P "$BAOCUT_MAC_CERTIFICATE_PASSWORD" -f pkcs12 -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: \
  -s -k "$BAOCUT_MAC_KEYCHAIN_PASSWORD" "$BAOCUT_CI_KEYCHAIN"
python3 - "$BAOCUT_CI_KEYCHAIN" "$RUNNER_TEMP/baocut-keychains-before.txt" <<'PY'
import shlex
import subprocess
import sys
from pathlib import Path

previous = shlex.split(Path(sys.argv[2]).read_text())
subprocess.run(['security', 'list-keychains', '-d', 'user', '-s',
                sys.argv[1], *previous], check=True)
PY
security find-identity -v -p codesigning "$BAOCUT_CI_KEYCHAIN" \
  | grep -F -- "$BAOCUT_MAC_SIGNING_SHA1"
```

只在 CI 专用临时钥匙串调整 `set-key-partition-list`，不改开发机 login keychain 的所有私钥授权。指纹应在配置时校验为 40 位 hex，构建配置要使用这个指定身份；身份名称不能替代指纹检查。

### 5.3 公证与清理

API key 方式将 `.p8` 解码到 `$RUNNER_TEMP`，权限 `600`，用 §4 的命令创建 profile，并加 `--keychain "$BAOCUT_CI_KEYCHAIN"`。后续 `submit`、`history` 和 `log` 也传同一个 `--keychain`。Apple ID 方式用同样的临时钥匙串存 profile；CI 从 Secret 传 `--password`，必须保持 `set +x`，不能输出命令参数。

签名后提交 Apple 公证，只有 `Accepted` 才 staple 并生成最终 ZIP / DMG；最终解压包再次跑签名、票据、Gatekeeper 与 Runtime 自检。凭据准备成功不等于应用已经打包、公证或发布。

无论成功失败，都用独立的 `if: ${{ always() }}` step 恢复搜索列表并清理 CI 材料；不要在清理 step 重新解码 Secrets：

```bash
set -euo pipefail
set +x
BAOCUT_CI_KEYCHAIN="$RUNNER_TEMP/baocut-signing.keychain-db"
if [ -f "$RUNNER_TEMP/baocut-keychains-before.txt" ]; then
  python3 - "$RUNNER_TEMP/baocut-keychains-before.txt" <<'PY'
import shlex
import subprocess
import sys
from pathlib import Path

previous = shlex.split(Path(sys.argv[1]).read_text())
subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', *previous], check=True)
PY
fi
if [ -f "$BAOCUT_CI_KEYCHAIN" ]; then
  security delete-keychain "$BAOCUT_CI_KEYCHAIN"
fi
rm -f "$RUNNER_TEMP/baocut-signing.p12" "$RUNNER_TEMP/baocut-notary.p8" \
  "$RUNNER_TEMP/baocut-keychains-before.txt"
```

自托管 runner 还要保证取消任务后会运行清理或由宿主清理任务遗留的材料。上传 artifacts 使用明确的发布文件列表，不能上传整个 `$RUNNER_TEMP` 或签名备份目录。

## 6. 发布与备份完成条件

- 新 App ID 已登记，构建的 `CFBundleIdentifier` 与更新校验用同一个 ID。
- 新证书已签发；清单的指纹、序列号、有效期与实际签名一致。
- 加密 `.p12` 的私钥恢复与真实签名演练成功；备份摘要记录正确。
- 第二处备份与密码管理器里的解密密码都已确认存在。
- 新机器或 CI 的公证凭据通过访问校验；不能仅保存 profile 名。
- 当次产物签名、公证、staple、Gatekeeper 和所需功能验收通过，报告已保存。
- CI 已实际执行后才宣称 Actions 发布可用；未签发、未导出、未恢复演练或未上传 Secrets 的状态分别注明。

## 7. 官方参考

- [Apple：创建 Developer ID 证书](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)
- [Apple：导出与共享签名身份](https://developer.apple.com/documentation/xcode/sharing-your-teams-signing-certificates)
- [Apple：定制公证流程](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
- [GitHub：在 macOS runner 安装签名证书](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)
