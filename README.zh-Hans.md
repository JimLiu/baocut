<p align="center">
  <img src="apps/desktop/build/icon.png" alt="BaoCut" width="128">
</p>

<h1 align="center">BaoCut</h1>

<p align="center">
  <strong>以可编辑视频为中心的 AI 视频智能体。</strong><br>
  告诉它你想做什么，它会转写、制作字幕、翻译、配音、剪辑和制作动画。结果保存在时间线里，你可以继续修改。
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-Hans.md">简体中文</a>
</p>

---

开发维护、问题反馈和贡献统一在 [jimliu/baocut](https://github.com/jimliu/baocut) 进行。此前独立的 BaoCut skill 保存在[旧版归档分支](https://github.com/jimliu/baocut/tree/archive/legacy-2026-10-07)及 `legacy-2026-10-07` tag。

## 下载与安装

[BaoCut 3.0.1（Build 61）](https://github.com/JimLiu/baocut/releases/tag/baocut-v3.0.1-build.61) 已提供 macOS 与 Windows 安装包。包内包含 Runtime 和原生 Worker；只有开发时才需要 Node.js 和 Rust。

| 平台 | 安装包 | ZIP | 适用范围 |
| --- | --- | --- | --- |
| macOS 14+ · Apple Silicon | [DMG](https://github.com/JimLiu/baocut/releases/download/baocut-v3.0.1-build.61/BaoCut-3.0.1-build.61-aarch64-apple-darwin.dmg) | [ZIP](https://github.com/JimLiu/baocut/releases/download/baocut-v3.0.1-build.61/BaoCut-3.0.1-build.61-aarch64-apple-darwin.zip) | Apple Silicon Mac，已通过 Developer ID 签名与 Apple 公证 |
| Windows x64 · CPU | [安装 EXE](https://github.com/JimLiu/baocut/releases/download/baocut-v3.0.1-build.61/BaoCut-3.0.1-build.61-win-x64-setup.exe) | [ZIP](https://github.com/JimLiu/baocut/releases/download/baocut-v3.0.1-build.61/BaoCut-3.0.1-build.61-win-x64.zip) | 使用 CPU 推理 |
| Windows x64 · CUDA | [安装 EXE](https://github.com/JimLiu/baocut/releases/download/baocut-v3.0.1-build.61/BaoCut-3.0.1-build.61-win-x64-cuda-setup.exe) | [ZIP](https://github.com/JimLiu/baocut/releases/download/baocut-v3.0.1-build.61/BaoCut-3.0.1-build.61-win-x64-cuda.zip) | CUDA 13 支持的 NVIDIA 显卡，从 RTX 30 / Ampere 起 |
| Windows x64 · Vulkan | [安装 EXE](https://github.com/JimLiu/baocut/releases/download/baocut-v3.0.1-build.61/BaoCut-3.0.1-build.61-win-x64-vulkan-setup.exe) | [ZIP](https://github.com/JimLiu/baocut/releases/download/baocut-v3.0.1-build.61/BaoCut-3.0.1-build.61-win-x64-vulkan.zip) | 支持 Vulkan 的 AMD / Intel 显卡或较旧的 NVIDIA 显卡；Whisper 使用 GPU，candle 使用 CPU |

macOS 打开 DMG 后，将 BaoCut 拖入“应用程序”。Windows 先安装 [Microsoft Visual C++ v14 x64 Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist/)，再运行安装器或解压 ZIP。Windows 包未签名，GPU 版需要兼容的显卡驱动。校验文件与验证说明见发布页；应用通过各平台的更新源检查 GitHub Releases 中的新版本。

智能体功能需要已登录的智能体引擎，例如 Codex CLI 或 Claude Code。媒体分析、转写音频准备与导出还需要 `ffmpeg` 和 `ffprobe`；安装包不包含这些外部工具。

## 为什么选择 BaoCut

视频制作往往需要反复修改：译文里的第二句话不准确、某个镜头需要替换、配音的语气还要调整。BaoCut 把这些修改保留在同一个可编辑视频里：

- **视频是权威的编辑对象。** 文稿、译文、字幕层、章节、配音和动态图形都属于同一个视频。SRT、MP4、音频和文稿文件是它的导出结果。
- **可以只修改指定内容。** 改一条字幕、换一个镜头，或重做一句配音，智能体按指定范围编辑，并返回变更回执。渲染缓存按实际依赖失效；局部编辑有时仍需要重新渲染相关合成。
- **你与智能体使用同一个编辑器。** 你拖动片段，智能体改写字幕，双方都通过同一套命令入口、事务与撤销机制提交修改。你随时可以接手。
- **自主执行有明确边界。** 智能体在指定范围、访问模式和预算内工作，破坏性操作受审批规则约束。下载的网页、转写文稿等外部材料作为数据处理。
- **如实交付。** 智能体说明测量了什么、实际查看了哪些内容，以及哪些部分还需要人工试听。检查失败会明确报告。

## 能做什么

**处理已有素材**

- **转写。** 使用本地模型（Whisper large-v3 / v3-turbo、Qwen3-ASR、支持说话人区分的 MOSS）或在线 API。支持逐词时间信息，其精度取决于模型与对齐能力；转写片段可在任务进行时逐步进入时间线。
- **制作字幕。** 原文字幕、译文字幕或双语字幕。智能体按句翻译；界面记住新字幕的属性偏好，视频保存自己的字幕样式。
- **跨语言配音。** 翻译后用 HTDemucs 分离人声与背景声，再使用克隆音色或预设音色逐句合成，将新音轨放进时间线。
- **剪辑口播。** 在时间线上去掉口头语、长停顿、重录和说到一半重新开始的内容，原始媒体文件保持完整。
- **生成衍生内容。** 根据带时间信息的文稿制作章节、摘要、标题、博客文章和短视频，并用时间戳定位来源。

**从创作简报开始**

- **从提示词制作视频。** 内置 24 个创作模板，提供场景方向与示例提示词，涵盖知识讲解、产品发布、预告片、教程、数据故事、文字动画等。
- **先配音，再剪画面。** 规划脚本，合成旁白，再按旁白安排画面与节奏。
- **用代码制作动态图形。** 智能体编写自包含的 HTML 合成，例如下三分之一字幕条、醒目数字、标注和品牌短动画，将其作为代码包导入，烘焙帧并放到时间线上。支持 BaoCut 的 `baocut/1` 合同和 `hyperframes/1`。
- **生成图片。** 需要静态画面时，可使用本地 Qwen-Image 或在线服务。

**交付结果**

- 导出 MP4 成片（可烧录字幕，或另导出字幕文件）、SRT / WebVTT、文稿和音频；也可以导出便携的 `.baocut` 包，在另一台机器上打开并继续编辑。便携包包含视频快照、全部文档版本与素材版本，不包含原视频的完整事务与撤销历史。

## 四种入口，共用一个 Runtime

各个入口通过同一套协议连接本地 Runtime，编辑同一个视频。

| 入口 | 用途 |
| --- | --- |
| **桌面应用**（Electron） | 在 Home 与智能体协作，在 Space 浏览项目产物；在时间线编辑器中预览、修改、撤销和查看字幕。 |
| **CLI** `baocut` | 面向脚本与终端的轻量客户端。输出被管道接收时使用 JSON，退出码说明是否需要用户处理。 |
| **MCP 服务 + BaoCut skill** | 让你自己的智能体（Claude Code、Codex、Cursor、Gemini CLI 等）通过同一份工具目录操作 BaoCut。`baocut skill install` 安装使用说明，`baocut mcp install` 配置 MCP 接入。 |
| **Web 客户端** | 用 `baocut web open --video <id>` 获取一次性链接，在浏览器打开视频的编辑器，查看远端智能体的工作结果。 |

**选择自己的智能体引擎。** Claude Code 与 Codex CLI 已有端到端验证；GitHub Copilot CLI、Pi 和 OpenCode 已内置接入。支持 Agent Client Protocol 的智能体（如 Gemini CLI、Cursor Agent、Grok、Kimi Code，或自行添加的引擎）通过统一驱动接入。各引擎的验证状态见下文。

**选择自己的模型。** 转写、语音合成、图片生成、文本生成、音频分离等能力与服务提供方解耦。Apple Silicon 使用 MLX、Core ML 本地后端，Windows 使用 whisper.cpp、candle，并提供 CUDA 与 Vulkan 打包配置。在线接入包括 OpenAI、Anthropic、Google、ElevenLabs、DeepSeek、Moonshot、Qwen、Zhipu、MiniMax、Volcengine、xAI、Mistral、Groq、OpenRouter、SiliconFlow 及其他 OpenAI 兼容端点。各服务支持的能力不同；用量账本记录任务消耗与可获得的费用信息。一台机器也可以向局域网里的其他机器共享本地模型能力。Windows 当前的凭据与硬件验证限制见下文。

## 从源码运行

普通使用可直接下载上面的[安装包](#下载与安装)：它包含 Rust Worker 与 WASM，无需安装 Node.js、Rust 或编译器。从源码运行有两条路径：

| 目标 | `npm ci` 后的命令 | 依赖与限制 |
| --- | --- | --- |
| 完整桌面开发 | `npm run dev` | Node.js 22.18+、Rust、CMake 与下方平台构建工具；启动前构建原生 Worker 与 WASM。 |
| 无 Rust 的外壳／界面开发 | `npm run dev:lite` | Node.js 22.18+；跳过原生与 WASM 构建。全新检出中，视频编辑、预览、导出、本地推理与语音处理不可用；已有构建产物仍可能被使用。 |

智能体对话还需要安装并登录智能体引擎。媒体分析、转写音频准备与成片导出需要 PATH 中可用的 `ffmpeg` 和 `ffprobe`，两者不随应用分发。只打开应用无需登录智能体。

### 1. 按操作系统安装工具

先安装 [Git](https://git-scm.com/downloads) 与 [Node.js](https://nodejs.org/en/download) 22.18+。重新打开终端，检查 `git --version`、`node --version`、`npm --version`。选择 lite 模式时，可以跳过以下 Rust／编译器步骤，直接进入第 2 步。

**macOS**

安装命令行工具：`xcode-select --install`。使用 [Homebrew](https://brew.sh) 时，执行 `brew install cmake ffmpeg` 安装 CMake 与 FFmpeg。按 [Rust 官方安装说明](https://rust-lang.org/tools/install/)安装 rustup：

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
. "$HOME/.cargo/env"
rustup default stable
rustup target add wasm32-unknown-unknown
```

macOS 14+ 上 Apple Silicon 的本地模型 Worker 使用 MLX／Core ML，还需要**完整 Xcode 与 Metal 编译器**。安装 Xcode，先打开一次完成初始化，再选择它（路径按实际安装位置调整）：

```sh
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
xcrun --find metal
# 所选 Xcode 缺少 Metal 时：
xcodebuild -downloadComponent MetalToolchain
```

Intel Mac 改用 candle／whisper.cpp，需要 CMake 与 C++ 编译器。发布的 macOS 安装包面向 Apple Silicon；Intel 源码构建尚未纳入发布验证。

**Windows x64**

安装 [Visual Studio／Build Tools](https://visualstudio.microsoft.com/downloads/)，勾选 **Desktop development with C++（使用 C++ 的桌面开发）**，包含 MSVC x64 工具与 Windows SDK；见 [Rust 的 MSVC 安装说明](https://rust-lang.github.io/rustup/installation/windows-msvc.html)。安装 [CMake](https://cmake.org/download/) 时启用加入 PATH 的选项；安装 [LLVM](https://releases.llvm.org/download.html) 提供 Rust 绑定使用的 libclang。绑定找不到 libclang 时，将 `LIBCLANG_PATH` 设为 LLVM 的 `bin` 目录。安装 FFmpeg，并把含 `ffmpeg.exe` 与 `ffprobe.exe` 的目录加入 PATH。

下载并运行 [rustup-init.exe](https://rust-lang.org/tools/install/)，保留默认的 `x86_64-pc-windows-msvc` 宿主。随后重新打开 **x64 Native Tools Command Prompt** 或**配置为 x64 的 Developer PowerShell**，再执行源码构建；普通终端可能找得到 Rust，却没有 `cl.exe` 与 SDK 环境。

```powershell
rustup default stable
rustup target add wasm32-unknown-unknown
cargo --version
cmake --version
cl /?
```

默认 Windows 构建使用 CPU 推理，无需 CUDA／Vulkan SDK。GPU 构建的额外依赖见[桌面端说明](apps/desktop/README.md#windows-打包)。

**Linux（源码开发）**

使用与 macOS 相同的 rustup 命令安装 Rust。Debian／Ubuntu 可执行 `sudo apt install build-essential cmake clang libclang-dev pkg-config ffmpeg`；其他发行版使用对应软件包。Linux 源码开发使用 candle／whisper.cpp，目前不提供 Linux 安装包与原生发布验证。

### 2. 克隆、检查并运行

从仓库根目录执行；以下命令适用于 macOS／Linux 终端与 Windows 开发者终端：

```sh
git clone https://github.com/jimliu/baocut.git
cd baocut
npm ci
npm run doctor
npm run dev
```

`doctor` 列出缺失工具与修复提示，缺少源码构建的必需工具时返回非零退出码。FFmpeg 只给警告，因为它是媒体流程依赖。检查不会安装系统工具，也不能证明所有 SDK 与 Rust 依赖都能编译。`npm run setup` 检查环境并构建原生 Worker 与 WASM，不打开 Electron；`npm run dev` 自动执行它，任一构建失败便停止启动。使用 rustup 时，WASM 构建会自动补装目标。首次构建需要下载依赖，耗时与磁盘占用可能较大；后续复用 Cargo 缓存。PATH 中没有 Cargo 时，脚本也会检查 `CARGO_HOME/bin` 与 rustup 所在目录。

没有 Rust 时，用以下命令**替代** `doctor` 与 `dev`：

```sh
npm run dev:lite
```

补齐完整工具链后运行 `npm run dev` 即可构建原生能力。开发模式启动 Electron 与 Vite，按需拉起 Runtime，退出时停止它启动的 Runtime；数据默认位于 `.dev/baocut-home`。Electron 44 会在 `dev`、`dev:lite` 或 `start` 启动前下载二进制，首次启动需要网络。Ctrl+C 或关闭终端时，开发监管脚本请求 Electron、Vite 与 Runtime 退出，12 秒后强制结束仍未退出的进程。

### 常见问题

- **找不到 Cargo／没有默认工具链**：安装 Rust 后重新打开终端，执行 `rustup default stable`，再运行 `npm run doctor`。
- **Windows 找不到 `cl.exe`、链接器或 SDK**：使用 x64 开发者终端，检查 C++ 工作负载与 Windows SDK；libclang 报错时检查 LLVM 与 `LIBCLANG_PATH`。
- **macOS 找不到 `metal`**：选择完整 Xcode 并安装 MetalToolchain；仅安装命令行工具不足以提供 MLX 构建环境。
- **缺少 WASM 目标**：运行 `rustup target add wasm32-unknown-unknown`。`wasm-opt` 为可选优化工具，未安装时直接使用 Cargo 产物。
- **Electron 下载失败**：检查下载服务器的网络访问后重试启动；只执行 `npm ci` 不会下载 Electron 44 二进制。
- **全新检出直接 `npm start`**：该命令预览已有构建产物，需先执行 `npm run setup` 与 `npm run build`。

从 CLI 连接开发态桌面应用的 Runtime，macOS／Linux 使用：

```sh
BAOCUT_HOME=.dev/baocut-home npm run cli -- status
```

Windows PowerShell 使用：

```powershell
$env:BAOCUT_HOME = '.dev/baocut-home'
npm run cli -- status
```

Windows Command Prompt 中，先执行 `set "BAOCUT_HOME=.dev/baocut-home"`，再运行 CLI 命令。

### 其他命令

| 命令 | 作用 |
| --- | --- |
| `npm run doctor` / `npm run setup` | 检查源码构建依赖／检查并构建原生 Worker 与 WASM。 |
| `npm run dev:lite` | 跳过 Rust 构建启动桌面外壳；功能限制见上方。 |
| `npm run dev:designs` | 用 Vite 启动可交互原型，起始地址为 `http://127.0.0.1:4331/#/home`，源码变化后自动构建并刷新。首次运行前执行 `npm --prefix designs/baocut ci`；见[原型 README](designs/baocut/README.md)。 |
| `npm run build` | 构建 WASM、工具目录、外部智能体 skill，以及主进程、preload、Runtime 与界面；桌面产物位于 `apps/desktop/out`。 |
| `npm start` | 预览已构建的桌面端，界面从文件加载；首次先运行 `npm run setup` 与 `npm run build`。 |
| `npm run package:mac -- --build <n> --sign-sha1 <SHA1> --out <新目录>` | Apple Silicon 的签名、公证 ZIP 与 DMG，见[桌面端打包说明](apps/desktop/README.md#macos-打包)。 |
| `npm run package:win` / `npm run package:win:cuda` / `npm run package:win:vulkan` | Windows x64 的 NSIS 安装包（按用户安装）与 zip，不签名；分别使用 CPU、CUDA（NVIDIA）或 Vulkan（Whisper 使用 GPU，candle 仍使用 CPU）配置。见[桌面端 README](apps/desktop/README.md#windows-打包)。 |
| `npm run runtime` | 单独启动 Runtime，默认主目录为 `~/.baocut`。 |
| `npm run cli -- --help` | 查看 `baocut` 命令一览。工具命令从 Runtime 的工具目录派生，与 MCP 共用；`baocut help <command>` 查看参数，`baocut spec` 输出机器可读目录。没有 Runtime 时自动在后台启动，空闲后退出；可用 `baocut runtime status\|ensure\|stop` 管理。退出码：0 成功、1 失败、2 需要用户处理、3 Runtime 不可用、4 参数错误。见 [Agent 面设计 §5](docs/design/agent-surface/agent-surface-design.md#5-cli-约定)。 |
| `npm run build:engine` | 构建视频引擎 `engine-host`、成片渲染器 `export-worker`、`speech-worker` 与本地推理进程 `model-worker`。Apple Silicon 使用 MLX 与 Core ML，其他平台使用 candle 与 whisper.cpp；额外参数原样交给 cargo，例如 `npm run build:engine -- --release`。 |
| `npm test` | 单元测试与使用假 Driver 的 Runtime 端到端测试，无需 Codex。 |
| `npm run check:file-fonts` | 构建桌面应用，在 Electron 隐藏窗口中通过 `file://` 检查预览渲染器加载全部字体。 |
| `npm run typecheck` | 类型检查。 |

## 当前状态

BaoCut 正在积极开发，macOS Apple Silicon 与 Windows x64 安装包见上方，验证覆盖仍在完善：

- Codex CLI 与 Claude Code 已有端到端验证。外部智能体的 CLI 链路已通过；MCP 链路在修复后通过脚本客户端复核，仍待 Claude Code 复跑。详见[验收记录](docs/acceptance/agent-surface-e2e.md)。其他内置引擎尚未在 BaoCut 中逐一验证。
- 已实现 Apple Silicon（MLX、Core ML）和 Windows（whisper.cpp、candle）的本地推理后端。Mac arm64 包已通过 Developer ID 签名与 Apple 公证。Windows CPU、CUDA、Vulkan 包已通过原生构建、安装、同版覆盖升级与 ZIP 自检，但未签名，GPU 推理尚未在实际显卡上验证。Windows 已包含 Credential Manager 存储与 v2 凭据迁移；CI 尚未实测真实凭据迁移。见[桌面端说明](apps/desktop/README.md)。
- 部分本地模型权重（例如 OmniVoice、Qwen-Image）带有非商业许可，应用会在选择前提示。
- 完整产品范围、发布阶段与当前进度见[产品设计 §11](docs/product/product-design.md#11-发布路线与成功指标)。

## 进一步了解

| 文档 | 内容 |
| --- | --- |
| [docs/](docs/README.md) | 产品、架构、格式与协议规范、验收标准；从阅读路线开始。 |
| [designs/baocut/](designs/baocut/README.md) | 可交互的界面原型，UI 变化先在这里确认。 |
| [skills/](skills/README.md) | 内置创作 skill，包括字幕、翻译、口播剪辑、旁白和动态图形。 |
| [agent-skills/](agent-skills/README.md) | 指导外部智能体通过 CLI 或 MCP 使用 BaoCut 的 skill。 |
| [templates/](templates/README.md) | 内置创作模板。 |
| [AGENTS.md](AGENTS.md) | 在本仓库工作的编码代理规则。 |

<a id="environment-variables"></a>
<details>
<summary><strong>环境变量</strong></summary>

| 变量 | 用途 |
| --- | --- |
| `BAOCUT_LEGACY_ROOT` | 显式指定启动时迁移的 v1/v2 数据目录，开发态独立 Home 也可使用。旧数据不改写，完成状态记在 `<home>/store/legacy-upgrade.json`；默认桌面启动（开发态或安装版）都会自动检测平台历史目录；显式配置的沙盒 Home 保持隔离 |
| `BAOCUT_HOME` | Runtime 主目录，保存发现文件、实例锁、会话与日志。默认 `~/.baocut`；桌面开发模式默认 `.dev/baocut-home`。 |
| `BAOCUT_PROJECTS_DIR` | 新建项目的目录。默认 `~/BaoCut`；设置 `BAOCUT_HOME` 时默认 `<home>/projects`。 |
| `BAOCUT_<ID>_PATH` | 指定智能体引擎的可执行文件，`<ID>` 为 `CLAUDE`、`CODEX`、`GEMINI`、`CURSOR`、`GROK` 或 `KIMI`（如 `BAOCUT_CODEX_PATH`）。否则从登录 shell 的 PATH 与已知安装位置选择最新版本。 |
| `BAOCUT_LOCALE` | 界面、Runtime 与 CLI 文字的语言，优先于设置。支持 `en`、`zh-Hans` 等出货语言，也接受 `zh-CN`、`en_US.UTF-8` 等区域写法；完整列表见 `packages/protocol/src/i18n.ts` 的 `LOCALES`。测试套件默认使用 `zh-Hans`。 |
| `BAOCUT_SYSTEM_LANGUAGES` | Runtime 使用的系统首选语言，逗号分隔。桌面端传入操作系统设置；否则读取 `LC_ALL` / `LC_MESSAGES` / `LANG`。 |
| `BAOCUT_ALLOWED_ORIGINS` | 额外允许连接 Runtime 的来源，逗号分隔。桌面开发模式会加入 Vite 地址。 |
| `BAOCUT_BIN_DIR` | 随应用分发的原生程序（Worker 与凭据助手）目录。设置后不再搜索 cargo 产物；打包后的桌面应用使用 `<resources>/bin`。 |
| `BAOCUT_ENGINE_HOST` / `BAOCUT_MODEL_WORKER` | 指定 `engine-host` / `model-worker` 路径。否则先查 `BAOCUT_BIN_DIR`，再查 cargo 产物目录（`CARGO_TARGET_DIR`、`.cargo/config*.toml` 的 `build.target-dir`、仓库 `target/`）中的 `{release,debug}/`。没有 `model-worker` 时本地转写不可用。 |
| `BAOCUT_EXPORT_WORKER` | 指定 `export-worker` 路径。否则先查 `engine-host` 旁边，再查 cargo 产物目录；缺失时导出返回 `EXPORT_TOOL_MISSING`。 |
| `BAOCUT_RUNTIME_ENTRY` | CLI 启动 Runtime 的入口：`.ts` / `.js` 使用当前 Node，其他路径作为可执行文件。否则依次查找已安装的 BaoCut 应用、仓库内的 `apps/runtime`。 |
| `BAOCUT_MODELS_DIR` | 本地模型目录，默认 `<BAOCUT_HOME>/models`。 |
| `BAOCUT_TEMPLATES_DIR` | 内置创作模板目录，见[模板包规范 §6](docs/spec/template-spec.md#6-目录来源与加载)。否则查找打包资源中的 `templates/`，再查仓库模板。用户模板放在 `<BAOCUT_HOME>/templates`；ID 冲突时内置模板优先。 |
| `BAOCUT_SKILLS_DIR` | 内置智能体 skill 目录，见[架构设计 §3.8](docs/architecture/architecture-design.md#38-分层渐进加载的创作指导)。否则查找打包资源中的 `skills/`，再查仓库 skill。用户 skill 放在 `<BAOCUT_HOME>/skills`；ID 冲突时内置优先。 |
| `BAOCUT_AGENT_SKILLS_DIR` | 外部智能体使用的 BaoCut skill 源目录，由 `baocut skill install` 渲染，见 [Agent 面设计 §8](docs/design/agent-surface/agent-surface-design.md)。否则依次查找打包的 `agent-skills/` 与仓库目录。 |
| `BAOCUT_MODEL_ASSETS_DIR` | 随应用分发的模型数据（自检样本、内置音色参考录音，即 `packages/models/assets`）。否则查找打包的 `model-assets/`，再查仓库数据；打包后的桌面端使用 `<resources>/model-assets`。 |
| `BAOCUT_WORKER_FEATURES` | `npm run build:engine` 为 `model-worker` 追加的 cargo feature，逗号分隔。Windows / Linux 的 NVIDIA CUDA 配置使用 `cuda,whisper-ggml-cuda`，需要 CUDA 工具链；Whisper 的 Vulkan 配置使用 `whisper-ggml-vulkan`，需要 Vulkan SDK。硬件验证状态见上文。 |
| `BAOCUT_GPU` | `off`、`0`、`false`、`cpu` 或 `no` 让 `model-worker` 的 candle 与 whisper.cpp 都在 CPU 上运行，见 [Model Worker 协议 §2.1](docs/spec/model-worker-protocol-spec.md)。 |
| `BAOCUT_FFMPEG` | 媒体分析、WebM 兼容播放缓存与转写音频准备使用的 `ffmpeg` 路径；否则从登录 shell 的 PATH 查找。 |

</details>

<details>
<summary><strong>仓库结构</strong></summary>

```text
apps/
  desktop/          Electron 主进程、preload 与界面入口
  runtime/          Runtime 进程入口
  cli/              命令行客户端
  web/              Web 客户端，由 Runtime 的 Web 服务提供
packages/
  protocol/         线协议：信封、方法、主题事件、领域类型与校验
  client/           连接、请求、订阅、重连与镜像归约
  runtime-core/     装配、WebSocket 网关与请求处理
  harness/          会话、任务、停止屏障与 Driver ABI
  agent-drivers/    Codex、Claude、Copilot、Pi、OpenCode 与 ACP 驱动
  runtime-storage/  Runtime 主目录、会话与项目存储、发现文件
  models/           模型能力、本地模型包、选择与用量账本
  providers/        OpenAI、Anthropic、Google、ElevenLabs 等在线服务
  jobs/             长任务与调度
  nodes/            局域网能力共享：节点服务与发起方
  code-runtime/     代码包适配与帧烘焙
  ui/               React 界面（React Spectrum 2 + Zustand）
crates/
  editor-semantics/ 时间语义：精确有理数、十进制秒与帧量化
  video-model/      视频交换 DTO
  video-engine/     视频引擎与存储：事务、回执、撤销
  timeline/         时间线与元素模型
  render-graph/     原生成片导出与 WASM 预览共用的帧计划
  engine-host/      Engine Host 进程，通过 stdio 与 Runtime 通信
  export-worker/    成片渲染
  model-worker/     本地推理：转写、语音合成、图片生成、音频分离
  speech-doc/       文稿后处理、对齐与字幕拆分
bindings/
  preview-wasm/     编辑器预览的 WASM 入口
skills/             内置创作 skill
agent-skills/       外部智能体使用的 BaoCut skill
templates/          内置创作模板
tools/              构建与检查脚本
```

依赖方向与各层职责见[架构设计 §11、§13](docs/architecture/architecture-design.md#11-客户端架构)，文件放置与命名见[仓库约定](docs/repo-conventions.md)。

</details>

<a id="license"></a>
## 许可

BaoCut 采用 [BaoCut Community License 1.0](LICENSE)，属于源码可用（source-available）软件。以下为中文摘要，正式条款以 LICENSE 的英文原文为准：

- 免费允许个人使用、学习研究、非商业修改与分发，以及企业内部使用和内部定制。
- 允许用 BaoCut 制作和销售商业内容，包括广告、付费视频和客户剪辑订单。软件许可不要求作品付费、署名、加水印或公开源码；内置原创模板元素用于作品也适用此许可。
- 销售原版或修改版软件、换皮销售、提供商业托管平台或 API，以及把 BaoCut 代码或引擎集成到对外商业软件产品中，需要事先取得单独的书面商业授权。公开修改版源码不豁免这些要求。
- 独立编写、不包含 BaoCut 代码、仅调用公开接口的插件或客户端不因互操作而受本许可约束；附带分发或商业托管 BaoCut 本身仍须遵守软件许可。
- 第三方代码、素材、字体与模型遵守各自许可，见[第三方声明](THIRD_PARTY_NOTICES.md)。历史版本已经按 Apache-2.0 等许可授出的权利不被撤回。

商业授权请联系 Jim Liu：<junminliu@gmail.com>。贡献者保留版权；本许可不代替贡献者协议。
