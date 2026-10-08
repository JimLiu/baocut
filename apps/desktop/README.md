# apps/desktop

BaoCut 的 Electron 桌面端：主进程（`src/main`）、preload 与渲染进程（`src/renderer`，界面来自 `@baocut/ui`）。主进程按需拉起 Runtime（`out/main/runtime.js`，以 `ELECTRON_RUN_AS_NODE` 运行），Runtime 再按需起各个 Rust Worker。运行与开发命令见[根 README](../../README.md)，验证入口见[开发流程 §2](../../docs/development-workflow.md#2-验证)。

| 目录 | 内容 |
| --- | --- |
| `src/main` | 主进程：窗口、Runtime 的监护（`runtime-supervisor.ts`）、更新、打包后的资源布局（`packaged-resources.ts`） |
| `src/preload`、`src/renderer` | 预加载脚本与渲染进程入口 |
| `tools/` | 对构建产物的检查（`check-file-fonts.mjs`、`check-model-assets.mjs`）、性能测量与打包脚本 |
| `build/` | 打包用的资源：`icon.ico`（Windows）、`icon.icns`（macOS）、`icon.png`（1024），都由 `tools/app-icon/` 生成，`npm run icons` 重新导出，不手改 |

## macOS 打包

Apple Silicon、macOS 14+、Node 22.18+、Rust 与 Xcode 命令行工具上，从干净、已提交的仓库根运行：

```sh
npm run package:mac -- --build 60 \
  --sign-sha1 <Developer-ID-证书完整-SHA1> \
  --out /仓库外/全新产物目录 \
  --download-base-url https://github.com/jimliu/baocut/releases/download/baocut-v3.0.0-build.60
```

版本从 `apps/desktop/package.json` 读取，App ID 为 `com.baocut.app`。build 号接着既有发布递增；上面的 60 是首个 3.0.0 候选，后续发布不复用。签名与加密备份见[签名说明](../../docs/macos-signing.md)，开发代理使用[发布 skill](../../.agents/skills/bcut-release/SKILL.md)。公证 profile 默认 `baocut-notary`，可用 `--notary-profile` 或 `BAOCUT_NOTARY_PROFILE` 覆盖；CI 独立钥匙串传 `--sign-keychain`。

构建桌面与 Web 后，打包器用 `cargo build --release --locked --target aarch64-apple-darwin` 构建 Worker 与凭据助手；Model Worker 保留默认 MLX / Core ML 后端。同一次构建的 `mlx.metallib` 随包进入 `Contents/Resources/bin`，Runtime 通过 `PMETAL_METALLIB_PATH` 指定它。找到多份时必须用 `--metallib` 指向本次构建产物，不能借用开发机的缓存。`--bin-dir` 只用于已核对来源 commit 的 release 程序。

Electron-builder 先装成 `BaoCut.app`；签名脚本用完整证书指纹选择身份，从内向外签名，不用 `--deep` 签名。App 和 DMG 都需 Apple 公证为 `Accepted`，随后 staple；最终 ZIP 从已 staple 的 App 生成，重新解压复验签名、公证票据与 Gatekeeper，并用解压出的应用执行 Runtime 与 Worker 自检。产物为 `BaoCut-<版本>-build.<n>-aarch64-apple-darwin.zip`、`.dmg`、对应 `.sha256`、`app-release.json` 与公证记录。中间 `notary-submission.zip` 不分发。输出目录必须全新或为空。

包内资源与 Windows 用同一布局；Mac 的 `<resources>` 是 `Contents/Resources`。`node apps/desktop/tools/check-packaged-app.mjs /路径/BaoCut.app` 对真实包检查。仍需从仓库外、用独立 `BAOCUT_HOME` 启动 `verified-extraction/BaoCut.app` 检查页面与功能，签名成功不替代预览、导出、模型与 Agent 验收。ffmpeg 与 Agent 可执行文件沿用受管外部工具发现，不假装包含在安装包内。

发布通过 GitHub Releases，归档文件名与内容不可变。`--download-base-url` 生成 App 自己的解析器验证过的 ZIP 更新清单；公开归档读回通过后才更新 `apps/desktop/releases/` 的版本钉。新版使用独立 ID，不将旧版官网的更新源直接换成新包；旧 skill 的 GitHub Latest 保持原状。具体顺序见发布 skill。

**GitHub Actions**：手动触发 `desktop-macos`，从本仓库 `main` 的固定 commit 构建。默认 `mode=validate` 只验证签名私钥、指纹与公证访问；`mode=package` 生成候选，`mode=publish` 构建后发布，并更新 Mac appcast。后两种模式必须提供递增的新 build，不能复用已公开的 Build 60。签名材料放在仅允许 `main` 的 `macos-release` Environment；变量、Secrets、命令与验证范围见[签名说明 §5](../../docs/macos-signing.md#5-github-actions-配置)。这套工作流没有自动执行 UI、导出或真实模型推理验收，报告会标为未运行。

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

它先 `npm run build`、`npm run build:web`，再由 `tools/package-desktop.mjs` 用 cargo 编 Worker（release、`x86_64-pc-windows-msvc`、`--locked`），用 electron-builder 出包到 `apps/desktop/dist/<cpu|cuda|vulkan>/`（已被 git 忽略）：

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
| `skills/` | 仓库根的 `skills/` | `BAOCUT_SKILLS_DIR` |
| `agent-skills/` | 仓库根的 `agent-skills/` | `BAOCUT_AGENT_SKILLS_DIR` |
| `model-assets/` | `packages/models/assets` | `BAOCUT_MODEL_ASSETS_DIR` |
| `web/` | `apps/web/dist` | `BAOCUT_WEB_DIST` |

[BaoCut 许可](../../LICENSE)、第三方代码的来源、修改声明与原始许可由 `tools/third-party-notices.ts` 的清单随桌面与 Web 构建分发。安装包在 asar 内附带 `LICENSE`，另在 `resources/LICENSE`、`resources/THIRD_PARTY_NOTICES.md` 与 `resources/crates/model-runtime/licenses/speech-swift.txt` 保留原文副本；打包结构检查与安装后的自检核对这些文件的内容。

**自检**。`node apps/desktop/tools/check-packaged-app.mjs <BaoCut.exe 所在目录>` 用应用自己的可执行文件按 Node 方式运行 asar 里的 `runtime.js --self-check --probe`：报告每项解析到哪里，并把每个原生程序起一次、走一遍握手（缺 DLL、架构不对在这里暴露）。只能在 Windows 上对 Windows 的包跑；`--dev` 对开发构建跑一遍。

### GitHub Actions 发布

Windows 发布分成原生构建与候选发布两次手动触发；普通 push 不启动这些工作流。首次构建的运行结果与硬件验证状态分别报告，不能把工作流存在当作已验证。

```sh
gh workflow run desktop-windows.yml --ref baocut-v3.0.0-build.60 \
  -f include_cuda=true -f include_vulkan=true -f build=60 \
  -f download_base_url=https://github.com/jimliu/baocut/releases/download/baocut-v3.0.0-build.60

# 原生 job 通过且 artifact 已上传后，用实际 run ID；只选择验证通过的变体。
gh workflow run desktop-windows-publish.yml --ref main \
  -f 'candidate_run_id=<RUN_ID>' -f release_tag=baocut-v3.0.0-build.60 \
  -f variants=cpu,cuda,vulkan
```

构建来源固定在现有 Mac Release 的同一完整 commit；版本与 build 相同。构建环境修复可在 main 上执行工作流并传 `source_ref=<Mac 源 commit>`，报告分别记录产品与工作流 SHA。Windows Cargo 输出使用短路径 `D:\bt`，CMake 使用 Ninja，避免 Vulkan 着色器生成器触发 MSBuild 的长路径限制；`include_cpu=false` 可只重试 GPU 变体。发布工作流仅授予发布 job `contents: write` 和读取候选产物所需的 `actions: read`，不使用 Mac 证书或私钥。它核对候选工作流、仓库、来源 SHA、各选中变体的原生 job 结果、文件大小与 SHA-256、App 自己的更新清单解析结果，再把安装器、ZIP、校验文件、补充发布报告与清单追加到已有 Release。已存在的同名不同字节不覆盖；Mac 资产与历史 skill 的 Latest 保留原状。公开下载读回验证后，才提交与推送 Windows 各变体的更新清单。

Windows 安装包尚无 Authenticode 签名。当前 Worker 链接 `MSVCP140.dll`、`VCRUNTIME140.dll` 与 `VCRUNTIME140_1.dll`，安装器和 ZIP 尚未随附这些运行库；用户需先安装 [Microsoft Visual C++ v14 x64 Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist/)。Hosted runner 已装运行库，因此其自检不能证明全新系统无需此依赖。流水线中的启动、安装、同版覆盖升级、卸载与 ZIP 自检不替代真实 CUDA / Vulkan 硬件上的推理；没有通过 native job 的变体不得发布。验证发布门本身可运行 `node --test apps/desktop/tools/windows-release.test.mjs` 和 `actionlint .github/workflows/desktop-windows-publish.yml`。

**没有 Windows 机器时**：在 GitHub Actions 手动触发 `desktop-windows` 工作流（`.github/workflows/desktop-windows.yml`），它出各变体的包，对解开的包、zip 与静默安装后的目录各跑一遍自检，核对安装目录里有 `Uninstall BaoCut.exe`、按更新的参数（`/S --updated`）在装好的上面再装一遍，再上传安装包、zip 与发布报告。macOS 上可以交叉编译 Worker（`cargo build --release --target x86_64-pc-windows-gnu ...`，要 mingw-w64），再用 `node apps/desktop/tools/package-desktop.mjs --target x86_64-pc-windows-gnu --bin-dir <产物目录> --targets zip --out <仓库外的目录>` 出 zip 核对结构；NSIS 的 `makensis` 是 x86_64 程序，Apple 芯片上要 Rosetta。这样出的包不能代替 Windows 上的自检。

**现状与限制**（详见[架构设计 §14](../../docs/architecture/architecture-design.md#14-待评审事项)）：

- 不签名，首次运行会被 SmartScreen 拦下。
- 凭据：Windows 上凭据助手对一切操作答 `unsupported`，在线 Provider 与远端节点的凭据如实报告不可用，不回退到明文文件（[架构设计 §6.8](../../docs/architecture/architecture-design.md)）。
- CUDA 版用 Model Worker 的 `cuda`（candle 的 CUDA 后端）与 `whisper-ggml-cuda`（Whisper 的 ggml CUDA 后端），还没有实际构建过；Whisper 在 CUDA 与 Vulkan 上都没有实测。CUDA 版的 Worker 依赖显卡驱动的 `nvcuda.dll`，没有 NVIDIA 驱动的机器（包括 CI 的 runner）上预计起不来（未实测），那样的机器用标准版或 Vulkan 版。
- 更新源与下载页使用 GitHub（§2.6）；Windows 的完整跨版本自动更新与真实 GPU 推理仍需另行验证。
- 停止 Runtime（经 IPC 请它收尾）、Model Worker 的父进程看护与推理线程降优先级只交叉编译过，没有在 Windows 上实测；没有内存压力信号。
- 不设 Electron fuse：`GrantFileProtocolExtraPrivileges` 与 `RunAsNode` 都不能关（[架构设计](../../docs/architecture/architecture-design.md)的「字体」一段）。
