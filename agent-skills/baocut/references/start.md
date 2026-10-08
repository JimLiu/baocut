# 启动：找到 CLI、版本门与预检

<!-- surface: agent -->
会话内不需要这一页：工具已经连好，Runtime 由 BaoCut 管。能做什么用 {{tool:models_capabilities}} 与 {{tool:models_list}} 查，见 [models](catalog/models.md)。
<!-- /surface -->
<!-- surface: cli -->
## 1. 找到 CLI

1. `command -v baocut`（Windows 上 `where baocut`）。找到就用它。
2. 找不到时看环境变量 `BAOCUT_CLI`：它给出可执行文件的完整路径。
3. 还没有：请用户安装 BaoCut（桌面端自带 CLI），或告诉你 `baocut` 在哪。不要自己下载安装包、不要去别的目录里翻找。

下文统一写 `baocut`，按找到的实际路径替换。

## 2. 版本门

```text
baocut version
```

输出裸 JSON：CLI 与（正在跑时）Runtime 的版本、两边的工具接口版本，以及是否一致。它不会拉起 Runtime。

- 一致，或 Runtime 还没在跑：继续。
- 不一致：之后任何要连 Runtime 的命令都会以退出码 3（`INTERFACE_VERSION_MISMATCH` / `PROTOCOL_MISMATCH`）拒绝。告诉用户哪一边要更新（通常是把 BaoCut 更新到同一版本），停在这里。不要换旧参数、不要绕过。

## 3. 预检：这台机器能做什么

```text
baocut status
```

一次看清：

| 字段 | 看什么 |
| --- | --- |
| Runtime | 在不在跑、版本；没在跑时会自动拉起（`--no-start` 时只回答 `running: false`） |
| 能力 | 转写、语音合成、图片生成、文本生成、人声分离各自此刻用哪个服务、哪些服务能用；不可用的带原因与补救命令。这是摘要：要看各服务的模型、音色与限制，用 `baocut status --full` 或 `baocut models capabilities --capability <能力>` |
| 本地模型包 | 装了哪些、状态如何 |
| 外部工具 | yt-dlp（下载链接）与 ffmpeg（导出、转码）在不在 |

缺的东西照补救命令告诉用户怎么补。补救命令属于「本机管理」（模型服务、外部工具的安装与同意）时，先征得用户同意，有密钥的步骤只让用户自己做。本地模型包缺失可以按 [models](catalog/models.md) 的做法安装（要先报大小、得到同意）。

只读帮助与目录不需要 Runtime：`baocut --help`、`baocut help <命令>`、`baocut spec` 在没有 Runtime 时用随 CLI 带的离线快照回答。先看帮助、再决定要不要开工是可以的。

## 4. Runtime 归自己管

- **不手动起。** 每条要连 Runtime 的命令先找 `BAOCUT_HOME`（默认 `~/.baocut`）里正在跑的 Runtime；找不到就在后台拉起一个，结果信封里带 `runtime: { started: true }`。桌面端开着时直接用桌面端的那个。
- `baocut runtime ensure`：显式做同一件事，打印 `started` 或 `reused`。想在长流程开头先把 Runtime 拉起来时用。
- `baocut runtime status`：进程、端口、版本、谁拉起的、有哪些连接与进行中的任务、多久后空闲退出；从不拉起。
- `baocut runtime stop`：只停 CLI 自己拉起的那个。桌面端或别人拉起的拒绝（`RUNTIME_NOT_OWNED`），有人在用或有任务没完时拒绝（`RUNTIME_IN_USE`），退出码都是 1，不要强停。
- CLI 拉起的 Runtime 在没有连接、没有任务、没有开着的服务满设置 `runtime.idleExitMinutes`（默认 10 分钟）后自己退出。所以任务做完**不用**专门停；只在用户要求时 `stop`。
- `--no-start`：不自动拉起，找不到就以退出码 3 返回（`RUNTIME_UNAVAILABLE`）。只想看状态、或用户不希望起后台进程时用。

## 5. Runtime 起不来时

| 现象 | 处理 |
| --- | --- |
| 退出码 3，`RUNTIME_START_FAILED` | 把 `error.message` 原样告诉用户；请用户打开一次 BaoCut 桌面端看是否正常，不要自己去改 `BAOCUT_HOME` 里的文件 |
| 退出码 3，`RUNTIME_UNAVAILABLE` | 没带 `--no-start` 时重试一次；仍不行按上一行处理 |
| 退出码 3，`CATALOG_UNAVAILABLE` | 离线时既没有快照也没有 Runtime：CLI 安装不完整，请用户重新安装 |
| 退出码 3，版本不一致 | 见第 2 节 |

## 6. 开工

按任务读一页目录（SKILL.md 第 3 节），再按 [conventions](conventions.md) 的约定调用命令。
<!-- /surface -->
