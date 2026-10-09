<p align="center">
  <img src="apps/desktop/build/icon.png" alt="BaoCut" width="128">
</p>

<h1 align="center">BaoCut</h1>

<p align="center">
  <strong>An AI video agent built around an editable video, not a one-shot MP4.</strong><br>
  Tell it what you want. It transcribes, subtitles, translates, dubs, cuts and animates. Every result lands in a timeline you can keep editing.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-Hans.md">简体中文</a>
</p>

---

## Download and install

[BaoCut 3.1.0 (Build 62)](https://github.com/JimLiu/baocut/releases/tag/baocut-v3.1.0-build.62) is available for macOS and Windows. Packaged apps include the Runtime and native workers; Node.js and Rust are only needed for development.

| Platform | Installer | ZIP | Choose this version for |
| --- | --- | --- | --- |
| macOS 14+ · Apple Silicon | [DMG](https://github.com/JimLiu/baocut/releases/download/baocut-v3.1.0-build.62/BaoCut-3.1.0-build.62-aarch64-apple-darwin.dmg) | [ZIP](https://github.com/JimLiu/baocut/releases/download/baocut-v3.1.0-build.62/BaoCut-3.1.0-build.62-aarch64-apple-darwin.zip) | Apple Silicon Macs; Developer ID signed and notarized |
| Windows x64 · CPU | [Setup EXE](https://github.com/JimLiu/baocut/releases/download/baocut-v3.1.0-build.62/BaoCut-3.1.0-build.62-win-x64-setup.exe) | [ZIP](https://github.com/JimLiu/baocut/releases/download/baocut-v3.1.0-build.62/BaoCut-3.1.0-build.62-win-x64.zip) | CPU inference |
| Windows x64 · CUDA | [Setup EXE](https://github.com/JimLiu/baocut/releases/download/baocut-v3.1.0-build.62/BaoCut-3.1.0-build.62-win-x64-cuda-setup.exe) | [ZIP](https://github.com/JimLiu/baocut/releases/download/baocut-v3.1.0-build.62/BaoCut-3.1.0-build.62-win-x64-cuda.zip) | NVIDIA GPUs supported by CUDA 13, starting with RTX 30 / Ampere |
| Windows x64 · Vulkan | [Setup EXE](https://github.com/JimLiu/baocut/releases/download/baocut-v3.1.0-build.62/BaoCut-3.1.0-build.62-win-x64-vulkan-setup.exe) | [ZIP](https://github.com/JimLiu/baocut/releases/download/baocut-v3.1.0-build.62/BaoCut-3.1.0-build.62-win-x64-vulkan.zip) | Vulkan-capable AMD / Intel GPUs or older NVIDIA GPUs; Whisper uses the GPU, candle uses the CPU |

On macOS, open the DMG and drag BaoCut into Applications. On Windows, install the [Microsoft Visual C++ v14 x64 Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist/) first, then run the installer or extract the ZIP. Windows packages are unsigned; GPU variants need compatible graphics drivers. Checksums and verification details are on the release page. The app checks GitHub Releases for updates through its platform-specific update feed.

Agent features require a signed-in agent engine such as Codex CLI or Claude Code. Media analysis, transcription preparation and export also require `ffmpeg` and `ffprobe`; these external tools are not bundled.

<img width="4432" height="2704" alt="CleanShot 2026-10-07 at 9 35 49 PM@2x" src="https://github.com/user-attachments/assets/304eecf4-56f7-40bf-a1f0-83dd9a7d4ee8" />

<img width="3294" height="2582" alt="CleanShot 2026-10-07 at 9 38 02 PM@2x" src="https://github.com/user-attachments/assets/f71e7ad1-a7cb-40f5-987b-4b78403c11cf" />



## Why BaoCut

Most AI video tools render once and hand you a file. If the second sentence of the translation is wrong, you start over. BaoCut takes the opposite stance:

- **The video is the source of truth.** Transcripts, translations, subtitle layers, chapters, voice-overs and motion graphics all live inside one editable video. Files (SRT, MP4, audio, transcripts) are exports of it, never the other way around.
- **Local edits stay local.** Fix one subtitle line, swap one shot, redo one voice-over sentence. The agent changes exactly that and reports a receipt of what changed. Nothing else is re-rendered.
- **Humans and the agent share one editor.** You drag a clip, the agent rewrites a caption; both go through the same command gateway, the same transactions, the same undo stack. You can take over at any point.
- **Bounded autonomy.** The agent works inside an explicit scope, access mode and budget. Destructive actions ask first. Untrusted material (a downloaded page, a transcript) is data, never instructions.
- **Honest delivery.** The agent reports what it measured, what it actually looked at, and what still needs a human ear. A failed check is reported as a failed check, not hidden behind "done".

## What it can do

**From existing footage**

- **Transcribe** with local models (Whisper large-v3 / v3-turbo, Qwen3-ASR, MOSS with diarization) or online APIs, with word-level timing. Segments stream into the timeline while the job runs.
- **Subtitle** in the original language, translated, or bilingual. The agent translates sentence by sentence itself; subtitle styles are remembered per project.
- **Dub into another language.** Translate, separate vocals from background (HTDemucs), synthesize per sentence with a cloned or preset voice, lay the new track on the timeline.
- **Cut a talking-head recording.** Remove filler words, long pauses, retakes and false starts on the timeline. The original media is never touched.
- **Chapters, summaries, titles, blog posts, shorts.** Read the timed transcript and write the derivatives, with every claim traceable to a timestamp.

**From a brief**

- **Make a video from a prompt** with 24 built-in scene templates and example prompts: explainers, product launches, trailers, tutorials, data stories, typography motion and more.
- **Narration-first production.** Plan the script, synthesize the voice in one pass, then cut the picture to the narration.
- **Motion graphics as code.** The agent writes a self-contained HTML composition (lower thirds, big numbers, callouts, brand stingers), imports it as a code bundle, bakes frames and places it on the timeline. Supports BaoCut's own `baocut/1` contract and `hyperframes/1`.
- **Image generation** for shots that need a still: local Qwen-Image or online providers.

**Delivery**

- Export MP4 with burned-in or sidecar subtitles, SRT / WebVTT, transcripts, audio stems, and a portable `.baocut` bundle that reopens with full edit history on another machine.

## Four ways in, one Runtime

Every surface talks to the same local Runtime over the same protocol and edits the same video.

| Surface | What it is |
| --- | --- |
| **Desktop app** (Electron) | Home for working with the agent, Space for browsing and re-editing everything a project produced, a full timeline editor with preview, undo and live captions. |
| **CLI** `baocut` | Thin client for scripts and terminals. Emits JSON when piped; exit codes tell you whether the user needs to act. |
| **MCP service + BaoCut skill** | Your own agent (Claude Code, Codex, Cursor, Gemini CLI…) drives BaoCut through the same tool catalog. `baocut skill install` drops the skill into your agent; `baocut mcp install` wires up MCP. Same tool names on both paths. |
| **Web client** | Open any video's editor in the browser with a one-time link from `baocut web open --video <id>` so a remote agent can show you its work. |

**Bring your own agent engine.** Claude Code and Codex CLI are validated end to end. GitHub Copilot CLI, Pi and OpenCode are built in, and any Agent Client Protocol agent (Gemini CLI, Cursor Agent, Grok, Kimi Code, or one you add) plugs in through the same driver.

**Bring your own models.** Capabilities (transcribe, speak, generate image, generate text, separate audio) are decoupled from providers. Run local models on Apple Silicon (MLX, Core ML) or on Windows (whisper.cpp + candle, with CUDA and Vulkan builds), or point a capability at OpenAI, Anthropic, Google, ElevenLabs, DeepSeek, Moonshot, Qwen, Zhipu, MiniMax, Volcengine, xAI, Mistral, Groq, OpenRouter, SiliconFlow or any OpenAI-compatible endpoint. A usage ledger tracks cost per job. One machine can share its local models with others on the LAN.

## Run from source

For normal use, choose a [packaged app](#download-and-install): it includes the Rust workers and WASM, so you do not need Node.js, Rust or a compiler. Source development has two paths:

| Goal | Command after `npm ci` | Requirements / limits |
| --- | --- | --- |
| Full desktop development | `npm run dev` | Node.js 22.12+, Rust, CMake and platform build tools below. Builds native workers and WASM before launching. |
| Shell/UI development without Rust | `npm run dev:lite` | Node.js 22.12+. Skips native and WASM builds. On a fresh checkout, video editing, preview, export, local inference and speech processing are unavailable; existing outputs may still be used. |

Agent conversations additionally need an installed, signed-in agent engine. Media analysis, transcription preparation and export need `ffmpeg` and `ffprobe` on PATH. Neither is bundled. Opening the app does not require an agent login.

### 1. Install the tools for your OS

Install [Git](https://git-scm.com/downloads) and [Node.js](https://nodejs.org/en/download) 22.12+ first. Open a new terminal and check `git --version`, `node --version` and `npm --version`. For lite mode, skip the Rust/compiler steps below and continue at step 2.

**macOS**

Install the Command Line Tools (`xcode-select --install`). If you use [Homebrew](https://brew.sh), install CMake and FFmpeg with `brew install cmake ffmpeg`. Install Rust using the [official rustup installer](https://rust-lang.org/tools/install/):

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
. "$HOME/.cargo/env"
rustup default stable
rustup target add wasm32-unknown-unknown
```

On Apple Silicon with macOS 14+, the local model worker uses MLX / Core ML and also needs **full Xcode with the Metal compiler**. Install Xcode, launch it once to finish setup, and select it (adjust the path if installed elsewhere):

```sh
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
xcrun --find metal
# If Metal is missing from the selected Xcode:
xcodebuild -downloadComponent MetalToolchain
```

Intel Macs use candle / whisper.cpp instead, requiring CMake and a C++ compiler. Published macOS packages target Apple Silicon; Intel source builds are not covered by the release checks.

**Windows x64**

Install [Visual Studio / Build Tools](https://visualstudio.microsoft.com/downloads/) with **Desktop development with C++**, the MSVC x64 tools and a Windows SDK (see [Rust's MSVC prerequisites](https://rust-lang.github.io/rustup/installation/windows-msvc.html)). Install [CMake](https://cmake.org/download/) with its PATH option enabled, and [LLVM](https://releases.llvm.org/download.html) for the libclang used by Rust bindings. If bindings cannot locate it, set `LIBCLANG_PATH` to LLVM's `bin` directory. Install FFmpeg with both `ffmpeg.exe` and `ffprobe.exe` on PATH.

Download and run [rustup-init.exe](https://rust-lang.org/tools/install/), keeping the default `x86_64-pc-windows-msvc` host. Reopen an **x64 Native Tools Command Prompt** or a **Developer PowerShell configured for x64** before running the source-build commands; a regular terminal may find Rust but lack `cl.exe` and the SDK environment.

```powershell
rustup default stable
rustup target add wasm32-unknown-unknown
cargo --version
cmake --version
cl /?
```

The default Windows build uses CPU inference and does not need CUDA or Vulkan SDKs. GPU builds have extra requirements; see the [desktop guide](apps/desktop/README.md#windows-打包).

**Linux (source development)**

Install Rust with the same rustup commands as macOS. On Debian/Ubuntu, install the native tools with `sudo apt install build-essential cmake clang libclang-dev pkg-config ffmpeg`. Other distributions use their corresponding packages. Linux source development uses candle / whisper.cpp; Linux installers and native release validation are not provided.

### 2. Clone, check and run

Run from the repository root. These commands work in macOS/Linux terminals and Windows developer terminals:

```sh
git clone https://github.com/jimliu/baocut.git
cd baocut
npm ci
npm run doctor
npm run dev
```

The npm scripts that run TypeScript source explicitly enable type stripping, so Node.js 22.12–22.17 also work without changing your Node installation. `doctor` reports missing tools with installation hints and exits nonzero for missing source-build prerequisites. FFmpeg is a warning because it is needed for media workflows, not to compile the app. The check does not install tools or prove all SDKs and Rust dependencies can build. `npm run setup` checks prerequisites and builds native workers and WASM without opening Electron; `npm run dev` runs it automatically and stops if either build fails. Rustup-based WASM builds install the target when missing. The first build downloads dependencies and can take considerable time and disk space; later runs reuse Cargo's cache. Cargo is also discovered in `CARGO_HOME/bin` and next to rustup when absent from PATH.

Without Rust, use this **instead of** `doctor` and `dev`:

```sh
npm run dev:lite
```

After installing the full toolchain, run `npm run dev` to restore the native features. Development mode starts Electron and Vite, launches the Runtime on demand and stops it on exit. Data goes to `.dev/baocut-home` in the repo. Electron 44 downloads its binary before `dev`, `dev:lite` or `start`, so first launch needs network access. The development supervisor asks Electron, Vite and the Runtime to exit on Ctrl+C or terminal closure, then force-kills remaining processes after 12 seconds.

### Troubleshooting

- **Cargo missing / no default toolchain:** reopen the terminal after installing Rust and run `rustup default stable`, then `npm run doctor`.
- **Windows `cl.exe`, linker or SDK missing:** use the x64 developer terminal and check the C++ workload and Windows SDK installation. For `libclang` errors, check LLVM and `LIBCLANG_PATH`.
- **macOS `metal` missing:** select full Xcode and install its MetalToolchain component; Command Line Tools alone do not provide the MLX build environment.
- **WASM target missing:** run `rustup target add wasm32-unknown-unknown`. `wasm-opt` is optional; without it the build uses Cargo's output.
- **Electron download fails:** verify access to its download server and retry the launch. `npm ci` alone does not fetch the Electron 44 binary.
- **`npm start` on a fresh checkout:** it previews existing build output. Run `npm run setup` and `npm run build` first.

To connect a CLI to the Runtime started by the development desktop, on macOS/Linux:

```sh
BAOCUT_HOME=.dev/baocut-home npm run cli -- status
```

On Windows PowerShell:

```powershell
$env:BAOCUT_HOME = '.dev/baocut-home'
npm run cli -- status
```

In Windows Command Prompt, use `set "BAOCUT_HOME=.dev/baocut-home"` before the CLI command.

### Other commands

| Command | What it does |
| --- | --- |
| `npm run doctor` / `npm run setup` | Check source-build prerequisites / check and build native workers plus WASM |
| `npm run dev:lite` | Run the desktop shell without Rust builds; see the limits above |
| `npm run dev:designs` | Start the interactive prototype with Vite at `http://127.0.0.1:4331/#/home`, rebuilding and reloading on source changes. First run `npm --prefix designs/baocut ci`; see the [prototype README](designs/baocut/README.md). |
| `npm run build` | Build main process, preload, Runtime and UI into `apps/desktop/out` |
| `npm start` | Preview the already-built desktop app (UI loaded from files); first run `npm run setup` and `npm run build` |
| `npm run package:mac -- --build <n> --sign-sha1 <SHA1> --out <new-directory>` | Signed and notarized Apple Silicon ZIP and DMG; see the [desktop guide](apps/desktop/README.md#macos-打包). |
| `npm run package:win` / `package:win:cuda` / `package:win:vulkan` | Windows x64 installer (NSIS, per-user) and zip, unsigned: CPU, CUDA (NVIDIA) or Vulkan (AMD / Intel) model worker. See [desktop README](apps/desktop/README.md#windows-打包) |
| `npm run runtime` | Start the Runtime alone (default home `~/.baocut`) |
| `npm run cli -- --help` | The `baocut` CLI. Tool commands derive from the Runtime's tool catalog (same as MCP); `baocut help <command>` for arguments, `baocut spec` for a machine-readable catalog. Starts a Runtime in the background when none is running and lets it exit when idle (`baocut runtime status\|ensure\|stop`). Exit codes: 0 ok, 1 failed, 2 user action needed, 3 Runtime unavailable, 4 bad arguments. Design in [Agent surface §5](docs/design/agent-surface/agent-surface-design.md#5-cli-约定) |
| `npm run build:engine` | Build the video engine (`engine-host`), export renderer (`export-worker`), `speech-worker` and local inference process (`model-worker`). Backend follows the platform: MLX and Core ML on Apple Silicon, candle and whisper.cpp elsewhere (needs CMake and a C++ compiler). Extra args go to cargo (`-- --release`) |
| `npm test` | Unit tests and Runtime end-to-end tests with a fake driver (no Codex needed) |
| `npm run check:file-fonts` | Build the desktop app and verify, in a hidden Electron window over `file://`, that the preview renderer loads every font |
| `npm run typecheck` | Type check |

## Status

BaoCut is under active development, with macOS Apple Silicon and Windows x64 packages available above. What is true today:

- Codex CLI and Claude Code are validated end to end, including an external-agent run over CLI and MCP ([record](docs/acceptance/agent-surface-e2e.md)). Other engines are built in but not individually tested in BaoCut.
- Local inference is implemented for Apple Silicon (MLX, Core ML) and Windows (whisper.cpp, candle). Mac arm64 packages are Developer ID signed and notarized. Windows CPU, CUDA and Vulkan packages passed native build, installation, update-in-place and ZIP self-checks; they are unsigned, and GPU inference has not been tested on hardware. Windows Credential Manager storage and v2 credential migration are included; live credential migration has not been tested by CI. See the [desktop guide](apps/desktop/README.md).
- Some local model weights (OmniVoice, Qwen-Image) carry non-commercial licenses. The app says so before you pick them.
- Full product scope, release stages and the current position on them: [Product design §11](docs/product/product-design.md).

## Learn more

| | |
| --- | --- |
| [docs/](docs/README.md) | Product design, architecture, format and protocol specs, acceptance criteria. Start with the reading guide. |
| [designs/baocut/](designs/baocut/README.md) | Interactive UI prototype; UI changes land here first. |
| [skills/](skills/README.md) | Built-in craft skills the agent follows (subtitles, translation, talking-head cut, narration, motion graphics…). |
| [agent-skills/](agent-skills/README.md) | The BaoCut skill that teaches external agents how to use BaoCut over CLI or MCP. |
| [templates/](templates/README.md) | Built-in creation templates. |
| [AGENTS.md](AGENTS.md) | Rules for coding agents working in this repository. |

<a id="environment-variables"></a>
<details>
<summary><strong>Environment variables</strong></summary>

| Variable | Purpose |
| --- | --- |
| `BAOCUT_LEGACY_ROOT` | Explicit v1/v2 data directory for startup migration, including in an isolated development home. Old data stays unchanged; completion is recorded in `<home>/store/legacy-upgrade.json`. The default desktop launch (development or packaged) detects historical platform directories automatically; explicitly configured sandbox homes stay isolated |
| `BAOCUT_HOME` | Runtime home: discovery file, instance lock, session store, logs. Default `~/.baocut`; `.dev/baocut-home` in desktop development mode |
| `BAOCUT_PROJECTS_DIR` | Where "New project" creates directories. Default `~/BaoCut`; `<home>/projects` when `BAOCUT_HOME` is set |
| `BAOCUT_<ID>_PATH` | Executable of an agent engine; `<ID>` is one of `CLAUDE`, `CODEX`, `GEMINI`, `CURSOR`, `GROK`, `KIMI` (e.g. `BAOCUT_CODEX_PATH`). Otherwise the newest version found on the login shell's PATH and known install locations |
| `BAOCUT_LOCALE` | Language of UI, Runtime and CLI text (`en`, `zh-Hans`; `zh-CN` and `en_US.UTF-8` are accepted). Overrides the setting. For tests and troubleshooting; the test suite sets `zh-Hans` |
| `BAOCUT_SYSTEM_LANGUAGES` | System preferred languages as the Runtime sees them, comma separated. The desktop app passes the OS setting; otherwise `LC_ALL` / `LC_MESSAGES` / `LANG` |
| `BAOCUT_ALLOWED_ORIGINS` | Extra origins allowed to connect to the Runtime, comma separated. Desktop development mode adds Vite's address |
| `BAOCUT_BIN_DIR` | Directory of the native programs shipped with the app (workers and credential helper). When set, cargo outputs are not searched; the packaged desktop app sets `<resources>/bin` |
| `BAOCUT_ENGINE_HOST` / `BAOCUT_MODEL_WORKER` | Path to `engine-host` / `model-worker`. Otherwise `BAOCUT_BIN_DIR`, then cargo output dirs (`CARGO_TARGET_DIR`, `.cargo/config*.toml` `build.target-dir`, repo `target/`) under `{release,debug}/`. Without `model-worker`, local transcription is unavailable |
| `BAOCUT_EXPORT_WORKER` | Path to `export-worker`. Otherwise next to `engine-host`, then the cargo output dirs; without it export fails with `EXPORT_TOOL_MISSING` |
| `BAOCUT_RUNTIME_ENTRY` | Entry the CLI uses to start a Runtime: `.ts` / `.js` run with the current Node, anything else as an executable. Otherwise an installed BaoCut app, then `apps/runtime` in the repo |
| `BAOCUT_MODELS_DIR` | Local model files. Default `<BAOCUT_HOME>/models` |
| `BAOCUT_TEMPLATES_DIR` | Built-in creation templates ([template spec §6](docs/spec/template-spec.md#6-目录来源与加载)). Otherwise the packaged `templates/`, then the repo's. User templates live in `<BAOCUT_HOME>/templates`; built-in wins on id clash |
| `BAOCUT_SKILLS_DIR` | Built-in agent skills ([architecture §3.8](docs/architecture/architecture-design.md)). Otherwise the packaged `skills/`, then the repo's. User skills live in `<BAOCUT_HOME>/skills`; built-in wins on id clash |
| `BAOCUT_AGENT_SKILLS_DIR` | Source of the BaoCut skill for external agents ([Agent surface §8](docs/design/agent-surface/agent-surface-design.md)), rendered by `baocut skill install`. Otherwise the packaged `agent-skills/`, then the repo's |
| `BAOCUT_MODEL_ASSETS_DIR` | Model data shipped with the app (self-test samples, reference recordings of built-in voices, i.e. `packages/models/assets`). Otherwise the packaged `model-assets/`, then the repo's; the packaged desktop app sets `<resources>/model-assets` |
| `BAOCUT_WORKER_FEATURES` | Extra cargo features for `model-worker` in `npm run build:engine`, comma separated. `cuda,whisper-ggml-cuda` for NVIDIA on Windows / Linux (needs the CUDA toolkit; Whisper on CUDA untested), `whisper-ggml-vulkan` for AMD / Intel (needs the Vulkan SDK; untested) |
| `BAOCUT_GPU` | `off`, `0`, `false`, `cpu` or `no` keeps `model-worker` on the CPU for both candle and whisper.cpp ([Model Worker protocol §2.1](docs/spec/model-worker-protocol-spec.md)) |
| `BAOCUT_FFMPEG` | `ffmpeg` used for media analysis, WebM playback cache and transcription audio preparation. Otherwise found on the login shell's PATH |

</details>

<details>
<summary><strong>Repository layout</strong></summary>

```text
apps/
  desktop/          Electron main process, preload, UI entry
  runtime/          Runtime process entry
  cli/              Command-line client
  web/              Web client, served by the Runtime's web service
packages/
  protocol/         Wire protocol: envelopes, methods, topic events, domain types, validation
  client/           Connect, request, subscribe, reconnect; mirror reduction
  runtime-core/     Assembly, WebSocket gateway, request handling
  harness/          Sessions, tasks, stop barrier, Driver ABI
  agent-drivers/    Agent engine adapters: Codex app-server, Claude Agent SDK, Copilot, Pi, OpenCode, ACP
  runtime-storage/  Runtime home, session and project storage, discovery file
  models/           Capabilities, local model bundles, selection, usage ledger
  providers/        Online providers: OpenAI, Anthropic, Google, ElevenLabs, OpenAI-compatible
  jobs/             Long-running jobs and scheduling
  nodes/            LAN capability sharing (node service and initiator)
  code-runtime/     Code bundle adapters and frame baking
  ui/               React UI (React Spectrum 2 + Zustand)
crates/
  editor-semantics/ Time semantics: exact rationals, decimal seconds, frame quantization
  video-model/      Video interchange DTOs
  video-engine/     Video engine and storage: transactions, receipts, undo
  timeline/         Timeline and element model
  render-graph/     Frame plans shared by native export and WASM preview
  engine-host/      Engine Host process, talks to the Runtime over stdio
  export-worker/    Final render
  model-worker/     Local inference (ASR, TTS, image, separation)
  speech-doc/       Transcript post-processing, alignment, subtitle splitting
bindings/
  preview-wasm/     WASM entry for the editor preview
skills/             Built-in craft skills
agent-skills/       The BaoCut skill for external agents
templates/          Built-in creation templates
tools/              Build scripts
```

Dependency direction and layer responsibilities: [architecture §11, §13](docs/architecture/architecture-design.md#11-客户端架构). Placement and naming: [repo conventions](docs/repo-conventions.md).

</details>

<a id="license"></a>
## License

BaoCut is **source-available** under the [BaoCut Community License 1.0](LICENSE). In short:

- Free for personal use, study and research, non-commercial modification and redistribution, and internal use and customization inside a company.
- Free to make and sell content with BaoCut, including ads, paid videos and editing work for clients. No fees, attribution, watermark or source disclosure are required for your output; built-in original template elements are covered too.
- Selling the software or a modified version, rebranding it, offering it as a hosted service or API, or embedding BaoCut code or engines in a commercial software product requires a separate written commercial license. Publishing modified sources does not waive this.
- Independently written plugins and clients that contain no BaoCut code and only use public interfaces are not covered by this license; bundling or hosting BaoCut itself still is.
- Third-party code, assets, fonts and models keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Rights already granted under earlier licenses (such as Apache-2.0) are not withdrawn.

For commercial licensing contact Jim Liu: <junminliu@gmail.com>. Contributors keep their copyright; this license is not a contributor agreement.
