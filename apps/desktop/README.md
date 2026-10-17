# apps/desktop

BaoCut 的 Electron 桌面端：主进程（`src/main`）、preload 与渲染进程（`src/renderer`，界面来自 `@baocut/ui`）。主进程按需拉起 Runtime（`out/main/runtime.js`，以 `ELECTRON_RUN_AS_NODE` 运行），Runtime 再按需起各个 Rust Worker。运行与开发命令见[根 README](../../README.md)，验证入口见[开发流程 §2](../../docs/development-workflow.md#2-验证)。

| 目录 | 内容 |
| --- | --- |
| `src/main` | 主进程：窗口、Runtime 的监护（`runtime-supervisor.ts`）、更新、打包后的资源布局（`packaged-resources.ts`） |
| `src/preload`、`src/renderer` | 预加载脚本与渲染进程入口 |
| `tools/` | 对构建产物的检查（`check-file-fonts.mjs`、`check-model-assets.mjs`）、性能测量与打包脚本 |
| `build/` | 打包用的资源：`icon.ico`（Windows）、`icon.icns`（macOS）、`icon.png`（1024），都由 `tools/app-icon/` 生成，`npm run icons` 重新导出，不手改 |

## 外部 Agent 与 CLI

桌面构建把当前 CLI、离线工具目录和 Runtime 放在同一个 App 中。macOS 的入口是 `BaoCut.app/Contents/MacOS/baocut-cli`，Windows 是安装目录里的 `baocut.cmd`；两者都使用包内的 Electron，无需另装 Node，也不自动向系统 PATH 写文件。把该入口的完整路径设为 `BAOCUT_CLI`，或通过绝对路径调用。macOS 的启动器也支持用户自己建立的符号链接；打包时用 Xcode 的 clang 编译为与宿主相同架构的 Mach-O，随 App 签名，避免脚本放在 `Contents/MacOS` 造成嵌套代码签名失败。

先运行入口的 `version`：没有 Runtime 时只报告 CLI 版本，已有 Runtime 时检查工具接口是否兼容；不要用 App 的营销版本号代替这个检查。确认后可用该入口执行 `skill install --agent codex`（其他宿主见帮助）更新已安装的外部 Skill。CLI 优先启动自身所在 App 的 Runtime、读取同一包的说明书；显式的 `BAOCUT_RUNTIME_ENTRY` 仍优先。

旧的 3.8.0 Build 77 发布包没有这些入口；只改环境变量不能补出缺失文件。需要含修复的新桌面包，或先从与 App 匹配的源码运行 CLI。旧 Homebrew `bcut` 配方不是当前桌面 CLI 的匹配安装方式。启动发现与版本门见 [Skill 启动说明](../../skills/baocut/references/start.md)。

构建后用 `node tools/check-bundled-cli.mjs --dev`（在本目录）检查离线 `version`、`--help` 和 `spec`；打包检查也执行同样的命令检查，并核对说明书来自同一个包；使用临时 Home，不启动 Runtime。产物结构检查要求启动器、`out/main/cli.js` 和 `out/main/generated/cli-catalog.json` 都在。

## macOS 打包

### Intel Mac 本地包

Intel Mac（macOS 14+）用本机 x64 工具链运行，输出目录必须全新，源码先提交：

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer npm run package:mac -- \
  --local --target x86_64-apple-darwin --out /private/tmp/baocut-mac-intel
```

本地模式生成临时签名的 App、ZIP、DMG 与校验和，不公证、不生成更新源，不接受发布 build 号、下载地址或 Developer ID 身份。产物名带 `x86_64-apple-darwin-local`，`app-release.json` 记录来源提交与签名状态。正式发布仍使用下面的 Apple Silicon 流程。

Intel 的 Model Worker 关闭 MLX / Core ML，启用 candle CPU 与 `whisper-ggml-metal`。Whisper 通过 whisper.cpp 的 Metal 后端使用可用的 AMD 显卡；没有兼容 GPU 或 `BAOCUT_GPU=off` 时回落 CPU。其他模型、VAD 与对齐器走 CPU。Metal 内核由 whisper-rs-sys 内嵌，不需要 Apple Silicon 的 `mlx.metallib`。需要完整 Xcode、CMake 与 Rust WASM 目标。Intel Worker 在启动线程前设置 `GGML_METAL_CONCURRENCY_DISABLE=1`，规避当前 ggml 并发 Metal 调度在 AMD 独显上的错误，仍使用 GPU 计算。已用 Radeon Pro 5500M 与 Whisper large-v3 Turbo q8_0 跑通中英文样本；其他 AMD 型号与模型尚未实测。Runtime 的 Intel Mac 握手期限按[架构设计 §6.5](../../docs/architecture/architecture-design.md#65-model-worker本地推理进程)留出首次 Metal 编译时间。打包后的 Worker 启动检查与真实模型推理分别验证。

### Apple Silicon 发布包

Apple Silicon、macOS 14+、Node 22.18+、Rust 与 Xcode 命令行工具上，从干净、已提交的仓库根运行：

```sh
npm run package:mac -- --build 60 \
  --sign-sha1 <Developer-ID-证书完整-SHA1> \
  --out /仓库外/全新产物目录 \
  --download-base-url https://github.com/jimliu/baocut/releases/download/baocut-v3.0.0-build.60
```

版本从 `apps/desktop/package.json` 读取，App ID 为 `com.baocut.app`。build 号接着既有发布递增；上面的 60 是首个 3.0.0 候选，后续发布不复用。签名与加密备份见[签名说明](../../docs/macos-signing.md)，开发代理使用[发布 skill](../../.agents/skills/bcut-release/SKILL.md)。公证 profile 默认 `baocut-notary`，可用 `--notary-profile` 或 `BAOCUT_NOTARY_PROFILE` 覆盖；CI 独立钥匙串传 `--sign-keychain`。

构建桌面与 Web 后，打包器用 `cargo build --release --locked --target aarch64-apple-darwin` 构建 Worker 与凭据助手；Model Worker 保留默认 MLX / Core ML 后端。同一次构建的 `mlx.metallib` 随包进入 `Contents/Resources/bin`，Runtime 通过 `PMETAL_METALLIB_PATH` 指定它。找到多份时必须用 `--metallib` 指向本次构建产物，不能借用开发机的缓存。`--bin-dir` 只用于已核对来源 commit 的 release 程序。

Mac 的 Export Worker 另开 `export-worker/external-fonts`：内置字体只保留在 `Contents/Resources/web/assets`，`bundled-fonts.json` 将内核的原始文件名映射到 Vite 的哈希文件名；桌面 `app.asar` 内的字体 URL 在 staging 时改指向同一目录，Web 的地址不变。打包前逐份核对桌面、Web 与原生字体的字节，并拒绝仍嵌入字体的 `--bin-dir` Export Worker。普通开发构建与 Windows 打包仍用原有字体布局。Electron 只保留应用出货语言及其 Chromium 地区、性别变体，英文兜底保留。DMG 使用 LZFSE（`ULFO`）压缩。

Electron-builder 先装成 `BaoCut.app`；签名脚本用完整证书指纹选择身份，从内向外签名，不用 `--deep` 签名。App 和 DMG 都需 Apple 公证为 `Accepted`，随后 staple；最终 ZIP 从已 staple 的 App 生成，重新解压复验签名、公证票据与 Gatekeeper，并用解压出的应用执行 Runtime 与 Worker 自检。产物为 `BaoCut-<版本>-build.<n>-aarch64-apple-darwin.zip`、`.dmg`、对应 `.sha256`、`app-release.json` 与公证记录。中间 `notary-submission.zip` 不分发。输出目录必须全新或为空。

`model-worker` 单独使用 `build/entitlements.model-worker.mac.plist`，在保持 hardened runtime 的同时允许加载其他签名身份的动态库：LiteRT-LM 由模型安装器另行下载并核对 SHA-256，签名属于上游。此权限不授予 Electron 或其他 Worker。正式包与最终 ZIP 解压后都核对模型进程的实际签名权限；只通过启动握手不能证明运行库可加载。

包内资源与 Windows 用同一布局；Mac 的 `<resources>` 是 `Contents/Resources`。`node apps/desktop/tools/check-packaged-app.mjs /路径/BaoCut.app` 对真实包检查。仍需从仓库外、用独立 `BAOCUT_HOME` 启动 `verified-extraction/BaoCut.app` 检查页面与功能，签名成功不替代预览、导出、模型与 Agent 验收。ffmpeg 与 Agent 可执行文件沿用受管外部工具发现，不假装包含在安装包内。

共享字体的产物检查用 `node apps/desktop/tools/check-file-fonts.mjs --out=/路径/BaoCut.app/Contents/Resources/app.asar/out`：隐藏 Electron 窗口读取最终 ASAR 中的页面和字体 URL，核对清单中的字体全部加载并注入预览内核；不启动 Runtime，也不读取用户数据。

发布通过 GitHub Releases，归档文件名与内容不可变。`--download-base-url` 生成 App 自己的解析器验证过的 ZIP 更新清单；公开归档读回通过后才更新 `apps/desktop/releases/` 的版本钉。新版使用独立 ID，不将旧版官网的更新源直接换成新包；全部选定平台发布与验证完成后，将最新稳定桌面版本标记为 GitHub Latest，步骤见[发布 skill](../../.agents/skills/bcut-release/SKILL.md#complete-public-release)。

**GitHub Actions**：推送 `baocut-v<VERSION>-build.<BUILD>` release tag 自动触发 `desktop-release`，从 tag 的同一提交并行构建 Mac Apple Silicon 与 Windows x64 CPU、CUDA、Vulkan。Mac 原生检查通过后立即发布并更新 Mac appcast，不等待 CUDA；Windows 原生检查通过且 Mac Release 已公开后，追加到同一个 Release 并更新 Windows appcast。Mac 发布后先写入完整日志、交付已验证的下载；全部选定平台完成后再更新 Latest。Git tag 与源码 SHA 保持不变。tag 版本必须与 package.json / lockfile 一致、build 递增、提交已在 `main` 上；不能复用 Build 60。签名材料放在允许 `main` 和 release tag 的 `macos-release` Environment。`desktop-macos` 保留默认 `mode=validate` 的手动凭据验证入口。Secrets、命令和完整规则见[签名说明 §5](../../docs/macos-signing.md#5-github-actions-配置)；UI/导出与真实模型推理未由流水线验证，报告会明确标注。

## Windows 打包

在 Windows x64 上，从仓库根运行：

```sh
npm run package:win          # 标准版：Model Worker 用 candle CPU 与 whisper.cpp 的 Whisper（CPU）
npm run package:win:cuda     # CUDA 版：candle 与 Whisper 都走 CUDA（NVIDIA 专用），要 CUDA Toolkit 13.1；Whisper 的 CUDA 尚未实测
npm run package:win:vulkan   # Vulkan 版：Whisper 用 Vulkan GPU（candle 仍在 CPU 上），要 Vulkan SDK；尚未实测
```

三个版本按用户的显卡选：NVIDIA（Ampere / RTX 30 起）用 CUDA 版；AMD、Intel 显卡（以及不支持 CUDA 13 的旧 NVIDIA 显卡）用 Vulkan 版；都没有用标准版。一个包在运行期自己选 CUDA 或 Vulkan 现在做不到（[架构设计 §14](../../docs/architecture/architecture-design.md#14-待评审事项)「单一 GPU 安装包在运行期自选后端」）。

都要在 MSVC 开发环境里运行（whisper.cpp 用 CMake 编）。CUDA 版开 Model Worker 的 `cuda`（candle）与 `whisper-ggml-cuda`（whisper.cpp 的 ggml-cuda）两个 feature：要设好 `CUDA_PATH`，打包脚本另设 `CUDA_COMPUTE_CAP=80`、nvcc 的 `/MD` 与 `CMAKE_CUDA_ARCHITECTURES`（缺省 `80-virtual;86-real;89-real;120-real`，外部设了就用外部的；没有 GPU 的构建机必须显式给，否则 ggml 按本机 GPU 探测架构会失败）；ggml-cuda 要编很多内核，构建比原来明显慢。CUDA 版随带的 NVIDIA 运行库已经覆盖 ggml-cuda 用到的 cudart、cublas 与 cublasLt。Vulkan 版的用户只需要显卡驱动自带的 `vulkan-1.dll`，包里不带。

**CPU 指令集基线**。打包脚本给三个变体编 Model Worker 时都设 `GGML_NATIVE=OFF` 与 `GGML_AVX2=ON`（外部设了就用外部的）：ggml 缺省按构建机的 CPU 探测指令集，runner 带 AVX-512 时编出的 Whisper 在没有 AVX-512 的用户机器上会非法指令崩溃。固定基线是 AVX2（MSVC 上 `/arch:AVX2` 加 FMA、F16C、BMI2，Intel Haswell / AMD Zen 起）：带 AVX-512 的机器在 CPU 上转写稍慢；没有 AVX2 的 CPU（Sandy / Ivy Bridge 与不少 Pentium / Celeron）仍不支持，运行期按 CPU 选内核在 whisper-rs-sys 的静态链接下做不到（[架构设计 §6.5](../../docs/architecture/architecture-design.md#65-model-worker本地推理进程)「ggml 的 CPU 指令集基线」）。whisper-rs-sys 不随这些环境变量重跑：本机以前编过 Windows 的 Worker，先 `cargo clean -p whisper-rs-sys --release --target x86_64-pc-windows-msvc` 再打包；工作流的缓存 key 带着基线。只按源码核对，没有在 Windows 上实际构建或在只有 AVX2 的机器上跑过。

它先 `npm run build`、`npm run build:web`、`npm run build:slides-editor`、`npm run build:design-editor`、`npm run build:design-system-editor`、`npm run build:docs-editor`，再由 `tools/package-desktop.mjs` 用 cargo 编 Worker（release、`x86_64-pc-windows-msvc`、`--locked`），用 electron-builder 出包到 `apps/desktop/dist/<cpu|cuda|vulkan>/`（已被 git 忽略）：

- `BaoCut-<版本>[-build.<n>]-win-x64[-cuda|-vulkan]-setup.exe`：NSIS 一键安装，按用户装到 `%LOCALAPPDATA%\Programs\baocut`，不要管理员；
- `BaoCut-<版本>[-build.<n>]-win-x64[-cuda|-vulkan].zip`：解开即用；
- `BaoCut-<版本>[-build.<n>]-win-x64[-cuda|-vulkan]-release.json`：发布报告，版本、build、变体，安装器与 zip 的文件名、大小与 sha256；
- `win-unpacked/`：同样的内容，未打包。

都不签名。appId 与产品名取自更新规则（`app-update-rules.ts` 的 `BUNDLE_ID`、`PRODUCT_NAME`）。

**发布与更新**。发布的包要给 build 号：`node apps/desktop/tools/package-desktop.mjs --variant <cpu|cuda|vulkan> --build <n>`（`desktop-windows` 工作流的 `build` 输入）。build 号与变体写进应用的 `package.json`（`baocutBuild`、`baocutVariant`），产物名带 `build.<n>`；没有 build 号的包不检查更新。再给 `--download-base-url <https 目录>`（工作流的 `download_base_url`）时另写更新源 `appcast-x86_64-pc-windows-msvc[-cuda|-vulkan].json`：schema-1 清单，指向那个目录里的安装器，带大小与 sha256，写完用应用的解析器读一遍。再给 `--rollout-hours <n>`（工作流的 `rollout_hours`）时分批推送：更新源另写 `rolloutHours` 与 `releasedAt`（生成的时刻），自动检查在这之后的 n 小时里按本机位置逐步放开，手动检查不受限（[架构设计 §2.6](../../docs/architecture/architecture-design.md#26-应用更新)）；隔了很久才上传时，把 `releasedAt` 改成真正发布的时刻再传（它不在任何摘要里）。应用按自己的变体读对应的一份。更新源为 GitHub 仓库的 `apps/desktop/releases/` 版本钉，安装器为同一 GitHub Release 的不可变资产（[架构设计 §2.6](../../docs/architecture/architecture-design.md#26-应用更新)）；演练时用 `BAOCUT_UPDATE_APPCAST=<清单的路径>` 指过去，清单里的安装器地址这时也可以是本地路径。

应用内更新只认 NSIS 装的那一份（exe 旁边有 `Uninstall BaoCut.exe`）：下载、校验之后，应用正常退出（先经 IPC 停 Runtime），退出时静默起安装器换文件：「重启并更新」用 `/S --updated --force-run`，装完重新打开应用；已下载时用户正常退出用 `/S --updated`，装完不打开。zip 版在资源管理器里显示安装包并打开下载页。

**包里有什么**。asar 里只有 `out/`、生成的 `package.json` 与主进程真正 `require` 的第三方包（现在是 `ws`、`zod`）；工作区的 TypeScript 包已经打进 bundle。Runtime 与 Worker 要按路径读的东西放在 asar 外的 `resources/`，布局只在 `src/main/packaged-resources.ts` 定义，主进程启动 Runtime 时经环境变量交给它（[仓库约定 §2](../../docs/repo-conventions.md#2-放置规则)）：

| `resources/` 下 | 来源 | 交给 Runtime 的变量 |
| --- | --- | --- |
| `bin/` | `engine-host`、`export-worker`、`model-worker`、`speech-worker`、`credential-helper` 的 `.exe`；CUDA 版另有 NVIDIA 运行库与说明 | `BAOCUT_BIN_DIR` |
| `templates/` | 仓库根的 `templates/` | `BAOCUT_TEMPLATES_DIR` |
| `stickers/` | 仓库根的 `stickers/`：元素面板的随包贴纸（SVG 与 Lottie）、来源与许可 | `BAOCUT_STICKERS_DIR` |
| `skills/` | 仓库根的 `skills/`：说明书 `baocut/` 与它下面的内置 skill `baocut/built-in-skills/` | `BAOCUT_AGENT_SKILLS_DIR`（`skills/`）、`BAOCUT_SKILLS_DIR`（`skills/baocut/built-in-skills/`） |
| `model-assets/` | `packages/models/assets` | `BAOCUT_MODEL_ASSETS_DIR` |
| `web/` | `apps/web/dist` | `BAOCUT_WEB_DIST` |
| `slides-editor/` | `apps/slides-editor/dist`：幻灯片编辑器页面与 `slides_check` 用的编译器 | `BAOCUT_SLIDES_EDITOR_DIST` |
| `design-editor/` | `apps/design-editor/dist`：设计稿编辑器页面、画板运行时与快速编辑 Worker | `BAOCUT_DESIGN_EDITOR_DIST` |
| `design-system-editor/` | `apps/design-system-editor/dist`：设计系统编辑器页面、预览页 `artifact-type/run.html` 与预览用的 React UMD | `BAOCUT_DESIGN_SYSTEM_EDITOR_DIST` |
| `docs-editor/` | `apps/docs-editor/dist`：文档编辑器页面与它的运行时、字体 | `BAOCUT_DOCS_EDITOR_DIST` |

[BaoCut 许可](../../LICENSE)、第三方代码的来源、修改声明与原始许可由 `tools/third-party-notices.ts` 的清单随桌面与 Web 构建分发。安装包在 asar 内附带 `LICENSE`，另在 `resources/LICENSE`、`resources/THIRD_PARTY_NOTICES.md` 与 `resources/crates/model-runtime/licenses/speech-swift.txt` 保留原文副本；打包结构检查与安装后的自检核对这些文件的内容。

**自检**。`node apps/desktop/tools/check-packaged-app.mjs <BaoCut.exe 所在目录>` 用应用自己的可执行文件按 Node 方式运行 asar 里的 `runtime.js --self-check --probe`：报告每项解析到哪里，并把每个原生程序起一次、走一遍握手（缺 DLL、架构不对在这里暴露）。只能在 Windows 上对 Windows 的包跑；`--dev` 对开发构建跑一遍。

### GitHub Actions 发布

常规全平台发布由 `desktop-release` 在 release tag push 后自动调用原生构建和候选发布；规则见[签名说明 §5.4](../../docs/macos-signing.md#54-release-tag-自动发布)。`desktop-windows` 和 `desktop-windows-publish` 仍提供以下两次手动触发入口，用于单平台补发或重试；普通分支 push 不发布。运行结果与硬件验证状态分别报告，不能把工作流存在当作已验证。

冻结发布源码前，把本版本的应用内更新说明写入 `releases/release-notes.json` 并提交：`version`、`build` 必须与包一致，`notes` 是非空的英文纯文本（每条一行），`notesLocalized` 是可选的语言码到纯文本映射。说明依据[发布日志流程](../../.agents/skills/bcut-release/references/release-notes.md)整理，包含重要限制。Mac 和 Windows 打包生成更新源时共用此文件；本地打包可用 `--release-notes <JSON 文件>` 指定另一份。缺文件、说明为空或版本/build 不匹配会在出包前失败，发布校验也拒绝空说明的候选。应用按界面语言选择说明，缺译文回退英文；GitHub Release 的 Markdown 正文另外发布，不会自动写入应用更新源。

```sh
gh workflow run desktop-windows.yml --ref baocut-v3.0.0-build.60 \
  -f include_cuda=true -f include_vulkan=true -f build=60 \
  -f download_base_url=https://github.com/jimliu/baocut/releases/download/baocut-v3.0.0-build.60

# 原生 job 通过且 artifact 已上传后，用实际 run ID；只选择验证通过的变体。
gh workflow run desktop-windows-publish.yml --ref main \
  -f 'candidate_run_id=<RUN_ID>' -f release_tag=baocut-v3.0.0-build.60 \
  -f variants=cpu,cuda,vulkan
```

构建来源固定在现有 Mac Release 的同一完整 commit；版本与 build 相同。构建环境修复可在 main 上执行工作流并传 `source_ref=<Mac 源 commit>`，报告分别记录产品与工作流 SHA。Windows Cargo 输出使用短路径 `D:\bt`，CMake 使用 Ninja，避免 Vulkan 着色器生成器触发 MSBuild 的长路径限制；`include_cpu=false` 可只重试 GPU 变体。发布工作流仅授予发布 job `contents: write` 和读取候选产物所需的 `actions: read`，不使用 Mac 证书或私钥。它核对候选工作流、仓库、来源 SHA、各选中变体的原生 job 结果、文件大小与 SHA-256、App 自己的更新清单解析结果，再把安装器、ZIP、校验文件、补充发布报告与清单追加到已有 Release。已存在的同名不同字节不覆盖；Mac 资产保留，发布过程中保持原来的 Latest，完成后按发布 skill 标记最新稳定桌面版本。公开下载读回验证后，才提交与推送 Windows 各变体的更新清单。

Windows 安装包尚无 Authenticode 签名。当前 Worker 链接 `MSVCP140.dll`、`VCRUNTIME140.dll` 与 `VCRUNTIME140_1.dll`，安装器和 ZIP 尚未随附这些运行库；用户需先安装 [Microsoft Visual C++ v14 x64 Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist/)。Hosted runner 已装运行库，因此其自检不能证明全新系统无需此依赖。流水线中的启动、安装、同版覆盖升级、卸载与 ZIP 自检不替代真实 CUDA / Vulkan 硬件上的推理；没有通过 native job 的变体不得发布。验证发布门本身可运行 `node --test apps/desktop/tools/windows-release.test.mjs` 和 `actionlint .github/workflows/desktop-windows-publish.yml`。

**没有 Windows 机器时**：在 GitHub Actions 手动触发 `desktop-windows` 工作流（`.github/workflows/desktop-windows.yml`），它出各变体的包，对解开的包、zip 与静默安装后的目录各跑一遍自检，核对安装目录里有 `Uninstall BaoCut.exe`、按更新的参数（`/S --updated`）在装好的上面再装一遍，再上传安装包、zip 与发布报告。macOS 上可以交叉编译 Worker（`cargo build --release --target x86_64-pc-windows-gnu ...`，要 mingw-w64），再用 `node apps/desktop/tools/package-desktop.mjs --target x86_64-pc-windows-gnu --bin-dir <产物目录> --targets zip --out <仓库外的目录>` 出 zip 核对结构；NSIS 的 `makensis` 是 x86_64 程序，Apple 芯片上要 Rosetta。这样出的包不能代替 Windows 上的自检。

**现状与限制**（详见[架构设计 §14](../../docs/architecture/architecture-design.md#14-待评审事项)）：

- 不签名，首次运行会被 SmartScreen 拦下。
- 凭据：Windows 凭据助手使用 Credential Manager，启动时可读取 v2 的 `bcut` 服务条目并写入新版安全存储。已通过 Windows 目标交叉编译，尚未在 Windows 上实测；失败保留待重试状态，不回退到明文文件（[架构设计 §6.8](../../docs/architecture/architecture-design.md)）。
- CUDA 版用 Model Worker 的 `cuda`（candle 的 CUDA 后端）与 `whisper-ggml-cuda`（Whisper 的 ggml CUDA 后端），还没有实际构建过；Whisper 在 CUDA 与 Vulkan 上都没有实测。CUDA 版的 Worker 依赖显卡驱动的 `nvcuda.dll`，没有 NVIDIA 驱动的机器（包括 CI 的 runner）上预计起不来（未实测），那样的机器用标准版或 Vulkan 版。
- 更新源与下载页使用 GitHub（§2.6）；Windows 的完整跨版本自动更新与真实 GPU 推理仍需另行验证。
- 停止 Runtime（经 IPC 请它收尾）、Model Worker 的父进程看护与推理线程降优先级只交叉编译过，没有在 Windows 上实测；没有内存压力信号。
- 不设 Electron fuse：`GrantFileProtocolExtraPrivileges` 与 `RunAsNode` 都不能关（[架构设计](../../docs/architecture/architecture-design.md)的「字体」一段）。
