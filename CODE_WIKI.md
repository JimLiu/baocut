# BaoCut Code Wiki

> BaoCut 3.x · An AI video agent built around an **editable video**, not a one-shot MP4.
> The single local Runtime exposes the same protocol to four surfaces (Desktop Electron app, `baocut` CLI, MCP + BaoCut skill for external agents, and the Web client). All video state lives inside Rust crates (video engine + timeline + render pipeline) and is edited through a single command gateway.

---

## 1. Overview & Architecture

### 1.1 Project vision

BaoCut flips the typical AI-video workflow:

- **The editable video is the source of truth.** Transcripts, subtitles, dubs, chapters, motion graphics all live *inside* one versioned video. MP4/SRT are exports, never inputs.
- **Agent and human share one editor.** The agent, the CLI, the UI, and an external MCP agent all drive the same Runtime, the same transactions, the same undo stack.
- **Bounded autonomy.** Destructive edits go through an approval flow; scope, access mode and budget are explicit on every task.

### 1.2 Top-level process layout

```text
┌─────────────────── Four client surfaces ───────────────────┐
│  apps/desktop (Electron)  apps/cli (baocut)  apps/web      │
│                        + MCP + BaoCut skill                │
└─────────── WebSocket / JSON-RPC envelope ──────────────────┘
                           │
                           ▼
                apps/runtime / @baocut/runtime-core
                 (Node.js Runtime process)
                 ├── @baocut/harness     Agent sessions + tools
                 ├── @baocut/jobs        Long-running pipelines
                 ├── @baocut/models      Capabilities + providers
                 ├── @baocut/nodes       LAN sharing
                 ├── @baocut/code-runtime HTML-composition bake
                 ├── @baocut/providers   Online API adapters
                 └── @baocut/runtime-storage  File / credential IO
                           │
             stdio JSON-line workers (Rust)
                           │
        ┌──────────┬───────────┬────────────┬────────────┐
        ▼          ▼           ▼            ▼            ▼
  engine-host  export-worker  model-worker speech-worker  …
  (video engine) (final render)(local ML)  (LLM speech)

         ↳ crates/video-engine, timeline, render-graph,
           render-raster, subtitle-render, motion,
           audio-dsp, media-core, speech-doc, waveform …
```

### 1.3 Architectural pillars

| Layer | Technology | Responsibility |
| --- | --- | --- |
| **Client surfaces** | Electron 44, Vite 7 + React 19, Node 22 CLI, static Web | Windowing, navigation, state mirrors, rendering React UI (`@baocut/ui`). No business authority. |
| **Runtime** | Node 22 (Esm, `--experimental-strip-types`) | Single authority: WebSocket gateway, request routing, agent harness, job scheduler, model/router selection, credential & project IO. |
| **Video engine** | Rust 2024, SQLite-backed (bundled rusqlite) | Transactional edits, receipts, undo, snapshot-to-snapshot evolution of one video. Runs in its own `engine-host` process; single write lock. |
| **Rendering** | Rust (tiny-skia, cosmic-text, resvg fork, platform codecs) | Shared frame-planning crate (`render-graph`) + two rasterizers: WASM preview (tiny, in-browser) and native export (`export-worker`, with hardware codecs when available). |
| **Local inference** | Rust (Apple MLX + Core ML on arm64; candle + whisper.cpp on x64 / Windows) | Whisper/Qwen-ASR/MOSS transcribe, TTS, voice separation, image generation via `model-worker`. |
| **Speech doc processing** | Rust (`speech-doc`) | Pure post-processing: alignment, subtitle splitting, LLM-based polish, bilingual pairs — runs on transcript output, not raw audio. |
| **Protocol** | TypeScript + Zod (`@baocut/protocol`) | Every DTO, method, topic event, wire envelope and i18n catalogue lives here. Single source of truth. |

---

## 2. Repository Layout

BaoCut is **not** split by language (`frontend/` / `backend/`); it is split by **domain**. Two independent workspaces coexist: one npm (`apps/*`, `packages/*`) and one Cargo (`crates/*`, `bindings/*`).

### 2.1 Top-level directories

| Path | Purpose |
| --- | --- |
| `apps/` | Runnable programs. Thin: only lifecycle, assembly, CLI parsing. |
| `packages/` | TypeScript domain packages (`@baocut/*` npm workspace). |
| `crates/` | Rust domain crates (Cargo workspace). Worker binaries are here too. |
| `bindings/` | TS ↔ Rust boundary: WASM crates consumed by `@baocut/editor-wasm` and preview. |
| `tools/` | Build, check, code generation. Called from root `package.json` scripts. |
| `scripts/` | One-off archived scripts (data migration). Not part of product. |
| `docs/` | Product, architecture and format specs. Single source of truth for public contracts. |
| `designs/baocut/` | Interactive UI prototype (React + Vite). UI changes land here first. |
| `templates/` | Built-in creation templates shipped with the app (`data-story`, `promo-ad`, `vlog-edit`, …). |
| `skills/` | Built-in craft skills (subtitle workflow, talking-head cut, narration, motion graphics, …). Loaded by the Runtime's SkillCatalog. |
| `agent-skills/baocut/` | The external-agent "How to use BaoCut" skill. A single source rendered to CLI help and MCP tools. Craft content is synced from `skills/` via `tools/sync-agent-skill.ts`. |

### 2.2 Two workspaces, two lockfiles

- **npm workspace**: root `package.json` declares `"workspaces": ["apps/*","packages/*"]`. Lockfile is `package-lock.json`.
- **Cargo workspace**: root `Cargo.toml` declares `members = ["crates/*","bindings/*", "crates/render-raster/vendor/bcut-resvg"]`. Lockfile is `Cargo.lock`. Build outputs default to repo `target/`; override via `.cargo/config.local.toml` (template: `.cargo/config.local.toml.example`).

---

## 3. TypeScript Packages (`packages/*`)

Each package is published internally as `@baocut/<name>`, public entry `src/index.ts`. External consumers import only `@baocut/<name>` (or `exports`-declared subpaths); never `@baocut/<name>/src/…`.

### 3.1 Layered dependency graph

```
apps/desktop  apps/cli  apps/web            (surface layer)
    │           │         │
    ▼           ▼         ▼
@baocut/ui   @baocut/client               (UI / client connectors)
    │              │
    │              └───────────────────┐
    └── @baocut/protocol ◄─────────────┤  (wire DTOs + schemas — leaf)
                                       │
          @baocut/runtime-core         │  (assembly; depends on almost everything)
              │   │   │   │            │
              ▼   ▼   ▼   ▼            │
      @baocut/harness  @baocut/jobs    │
      @baocut/models   @baocut/nodes   │
      @baocut/providers                │
      @baocut/code-runtime             │
      @baocut/process-host ────────────┘
              │
              ▼
      @baocut/runtime-storage ◄── @baocut/agent-drivers
```

All packages eventually depend on `@baocut/protocol`, which is a pure leaf (only depends on `zod`).

### 3.2 Package-by-package responsibilities

#### `@baocut/protocol`
Pure declarations. Contains **every** public DTO, Zod schema, method name, topic event, wire envelope and i18n catalog.

- Key files:
  - `wire.ts` — request/response envelope, error codes, streaming chunk protocol.
  - `methods.ts` / `events.ts` / `catalog.ts` — RPC surface, domain topics, auto-generated tool catalog.
  - `video.ts`, `jobs.ts`, `models.ts`, `tasks.ts`, `exports.ts`, `space.ts`, … — domain DTOs.
  - `schemas.ts` / `json-schema.ts` — validators used by CLI and gateway.
  - `i18n.ts` + `messages/<area>/` — runtime text catalogs. Rust worker strings are registered here and matched with `tools/rust-messages.mjs`.
- **Rule**: If it crosses the Runtime↔client boundary or crosses a Rust worker↔Runtime boundary, its type lives here.

#### `@baocut/client`
WebSocket client + state mirroring.

- `BaoCutClient` (from `client.ts`): connect, request/response with retry, topic subscriptions, reconnect.
- Reducer set: `applyConversationEvent`, `applyJobsEvent`, `applyVideoTopicEvent`, `applySettingsEvent`, … — every topic has a pure reducer that the UI (or any JS surface) can use to build a local store without replaying server state.
- Used by: `apps/desktop`, `apps/cli`, `apps/web`, `@baocut/ui`.

#### `@baocut/runtime-core`
The Runtime. Assembles every subsystem into one Node process.

- `runtime.ts` — `startRuntime()`: bind port, write discovery file, start gateway, open storage, start optional services (MCP, Web), idle-exit.
- `gateway.ts` + `handlers.ts` — WebSocket + HTTP, authentication via token in discovery file, method dispatch, request validation.
- `videos/` — `VideoService`, `EngineHost` (stdio child for Rust video engine).
- `agent-tools/` — the unified tool surface: `ToolCatalog`, `VideoTools`, `ModelTools`, `AgentScope`, `McpEndpoint`, grants and approvals. Same tool set is exposed to: (1) internal agent harness, (2) CLI verbs, (3) MCP.
- `models/model-worker.ts` — spawns and reuses `model-worker` Rust processes.
- `services/` — `ServiceManager`, `McpService`, `WebService` (serves `apps/web` dist with one-time tokens).
- `templates/template-catalog.ts`, `skills/skill-catalog.ts` — load built-in + user-installed templates/skills.
- `space-catalog.ts`, `media.ts`, `media-analysis.ts` — Space browser, media registry (range-served static assets), thumbnail + waveform analysis.

#### `@baocut/harness`
Agent sessions & task contracts.

- `Harness` class: one session with one agent engine. Owns the conversation log, task budget, approval flow, tool-call routing.
- `ConversationState`, `TopicLog` — append-only JSONL-based conversation store and topic replay.
- `DriverRegistry` / `AgentManager` — pluggable driver table (Codex, Claude, ACP, Pi, OpenCode, …).
- `projector.ts` — pure projection that turns driver events into BaoCut conversation items.
- `task-contracts.ts` — `buildContract()`, `engineProtections()`: task budget + scopes + approval matrix.

#### `@baocut/agent-drivers`
Adapters for every supported agent engine. Each exposes the same `Driver` ABI defined in `@baocut/harness`.

- `CodexDriver` / `CodexSession` — Codex CLI app-server transport.
- `ClaudeDriver` / `ClaudeSession` — Claude Code, Claude Agent SDK, MCP servers wired through.
- `AcpDriver` — **Agent Client Protocol** (Gemini CLI, Cursor Agent, Grok, Kimi Code, custom). Presets in `ACP_PRESETS`.
- `PiDriver`, `OpenCodeDriver` — native support.
- `login-shell.ts` — discovery of agent binaries on the user's login shell PATH and known install locations. Override with `BAOCUT_<ID>_PATH` (`CLAUDE`, `CODEX`, `GEMINI`, `CURSOR`, `GROK`, `KIMI`).
- `approval-rule.ts` — `commandRule()`: maps tool/command pattern to auto-approval or manual gate.

#### `@baocut/jobs`
Long-running pipelines, scheduler, resource admission, application of results back into the video.

- `JobManager` — queue, ledger (`JobLedger`), admission (`JobAdmission`), recovery (`job-recovery.ts`), reconciliation of restarts.
- `ResourceScheduler` + `MachineCapacity` — GPU / CPU / memory accounting; GPU estimate via `unifiedGpuEstimate()`.
- Pipelines (all in `pipelines/`):
  - `TRANSLATE_PIPELINE` — translate cues sentence-by-sentence.
  - `TRANSLATE_SUBTITLES_PIPELINE` — subtitle file translation.
  - `TRANSCODE_PIPELINE` — ffmpeg-based media normalization.
  - `SPEECH_WORKER_PROTOCOL` — `speech-worker` LLM cue processing.
  - `SPEAKERS_PIPELINE` — diarization label + speaker proposal round-trip.
  - `dub-separator.ts` (exported `localDubSeparator`) — HTDemucs vocal separation for dubbing.
- `pipeline.ts` / `pipeline-runner.ts` — step DAG, typed step outputs, fault injection for crash testing.
- `job-application.ts` — apply pipeline results back into the engine-host as transactions, with idempotency and `APPLY_ATTEMPTS` retry.
- `ArtifactStore` — content-addressed (`sha256:`) job output storage; sweep stale files.
- `media-probe.ts` — `ffprobeMediaProbe()` and mime sniffers.
- `speech-document.ts` — bridge into Rust `speech-doc` via `editor-wasm` or worker.

#### `@baocut/models`
Capability model, catalog, providers, usage.

- `ModelCatalog` / `bundle-registry.ts` — `BUNDLES`: definition of every known local bundle (Whisper, Qwen3-ASR, MOSS, Qwen-Image, OmniVoice, HTDemucs…), per platform. `platformBundles()`, `defaultTranscribeBundle()`.
- `ModelServices` / `model-selection.ts` — `selectModel()`, `effectiveChoice()`, capability routing.
- `ModelServiceStore` — account + provider storage (credential keys delegated to `runtime-storage`).
- `UsageLedger`, `buildUsageReport()`, `MODEL_PRICES` — token/image/audio-second cost accounting per-account, per-period.
- `transcribe-provider.ts`, `generation-provider.ts` — abstract Transcribe/Generation `Provider` interfaces, `OnlineTranscriber`, `OnlineGenerator`, `OnlineTextProvider`.
- Shipped assets: `model-assets.ts`, local-speech self-test fixtures, reference recordings for built-in voice cloning.

#### `@baocut/providers`
Adapters that turn an HTTP endpoint into a `TranscribeProvider` / `TextAdapter` / `ImageAdapter` / `SpeechAdapter`.

- HTTP kernel: `provider-fetch()` with retry, redaction, rejection-code parsing.
- **OpenAI** family: `OpenAiAdapter` (ASR), `OpenAiTextAdapter`, `OpenAiImageAdapter`, `OpenAiSpeechAdapter`.
- **OpenAI-compatible**: `CompatibleAdapter` + vendor catalogue `COMPAT_VENDORS` (DeepSeek, Moonshot, Qwen, Zhipu, MiniMax, Volcengine, xAI, Mistral, Groq, OpenRouter, SiliconFlow…).
- **Anthropic**: `AnthropicTextAdapter`.
- **Google Gemini**: `GoogleAdapter`, `GoogleTextAdapter`, `GoogleImageAdapter`.
- **ElevenLabs**: `ElevenLabsAdapter` (TTS) + `ElevenLabsVoiceCloneAdapter`.
- Audio prep helpers (ffmpeg-based chunking): `audio-prep.ts` (extract → encode → detect silences), `chunk-plan.ts`.
- Usage reporter: `callReport` with cost per call.

#### `@baocut/nodes`
LAN capability sharing. One Runtime can advertise its local `model-worker` to others on the same LAN.

Server side (the Runtime exposing models):
- `NodeService` — HTTP endpoints, `Pairing` flow + token, `DnsSdAdvertiser` (Bonjour/avahi).
- `NodeJobs` — incoming remote jobs, execution, streaming back.
- `ShareStore` + `source-gate.ts` — controls which models/files a remote host can see.

Client side (the Runtime consuming a paired node):
- `NodeInitiator`, `RemoteNodeProvider`, `NodeClient`, `DnsSdDiscoverer`.
- `NodeStore` — saved pairings.
- `NodeProviderSource` — exposes paired remotes as regular `ProviderSource` entries in `@baocut/models`.

#### `@baocut/code-runtime`
HTML-based motion-graphics compositions (agent writes HTML, BaoCut frames it and places it on the timeline). Implements two author contracts: `baocut/1` and `hyperframes/1`.

- `bundle-inspect.ts` — `inspectBundle()`, `computeContentHash()`, validate structure, scan for external network references.
- `CompositionHost` — Electron offscreen window that hosts the composition, sandboxes requests to `file:` / `data:`, and drives a requestAnimationFrame loop. Returns `RenderedFrame` PNGs.
- `COMPOSITION_ADAPTER_SCRIPT` — injected into the page; exposes a unified `postMessage` API for both contracts.
- `bakeComposition()` — frame-by-frame PNG → ffmpeg → ProRes 4444 `.mov` with alpha. Used as a regular media clip afterward.
- `verifyBundle()` — implements the full verification matrix from spec.

#### `@baocut/ui`
Shared React UI; used by both Electron and Web surfaces.

- Stack: React 19 + React Aria / React Aria Components / React Spectrum S2 / Zustand / pdfjs-dist / react-markdown.
- `App` component — full shell (Home, Space, Editor panes, rail, menu). Surface-specific chrome is outside.
- `host.ts` — `HostBridge` interface: file open, system dialogs, credential access, app-update hooks. Electron `preload` and the Web client each provide a `HostBridge` implementation.
- State models (Zustand stores, `src/model/`): `editor.ts`, `player.ts`, `media.ts`, `seek.ts`, `services.ts`, `space.ts`, `sidebar.ts`, `thread.ts`, `chapters.ts`, `cue-edit.ts`, `dub-undo.ts`, `new-flow.ts`, `ai-tools.ts`, `format.ts`.
- Locale: `state/locale.ts` backed by `@baocut/protocol` i18n catalogues. UI copy files: `copy.ts`, `copy.zh-Hans.ts`, `copy.ja.ts`, … each copy module has matching keys via `defineMessages()`.
- Preview kernel entry: `src/render/preview-wasm.ts` (exported as `./preview-kernel`).

#### `@baocut/runtime-storage`
All durable IO used by the Runtime.

- `home.ts` / `discovery.ts` — `BAOCUT_HOME`, lock file, client discovery file (endpoint + token).
- `json-file.ts`, `jsonl-file.ts`, `store-file.ts` — generic JSON and append-only JSONL primitives.
- `conversation-store.ts` — append-only conversation JSONL. First line = header, second line = full snapshot, subsequent lines are `{op:"item"…}` or `{op:"meta"…}` deltas. Don't `JSON.parse()` the whole file; replay it.
- `project-store.ts` / `project-marker.ts`, `space-marks.ts`, `space-artifacts.ts` — video projects and Space views.
- `settings-store.ts` — preferences.
- `credential-store.ts` — abstraction; two backends: `file-credential-store.ts` (AES-GCM via local key) and `keychain-credential-store.ts` (macOS Keychain / Windows Credential Manager via Rust `credential-helper` binary). `credential-migration.ts` upgrades v2 entries.
- `grant-store.ts` — agent capability grants / approvals.
- `agent-prefs.ts`, `agent-probes.ts`, `agent-providers.ts`, `skill-prefs.ts` — persisted user choices about engines, API keys, enabled skills.

#### `@baocut/process-host`
Spawn and supervise child processes (Rust workers, Electron composition host, ffmpeg, login-shell commands).

- `JsonLineWorker` — stdio JSON-RPC pattern: typed requests, progress events, graceful cancel, timeout, exit-code + stderr aggregation. Used by EngineHost, ModelWorker, ExportWorker, SpeechWorker, CredentialHelper.
- `findBundledBinary()` / `cargoTargetDirs()` — lookup order: `BAOCUT_BIN_DIR` → packaged `resources/bin` → cargo target dirs (`CARGO_TARGET_DIR`, `.cargo/config*`, repo `target/`).
- `process-tree.ts` — `killProcessTree()` (macOS/Linux SIGKILL walk; Windows `taskkill.exe`).
- `shell-command.ts` — login-shell command runner with login-shell PATH.
- `system-terminal.ts` — open user's terminal at a path (cross-platform).
- `install-hint.ts` — `ffmpegMissingRemedyMessage()` and upgrade guides.

#### `@baocut/editor-wasm`
Thin wrapper over `bindings/editor-wasm`. Exports two entry points:
- `./src/node.ts` (Node) — used by `@baocut/jobs` for speech-doc operations on the server side.
- `./src/browser.ts` (browser) — loaded by preview renderer.
Exposes semantic operations: range math, stage/rect computations via Rust `editor-semantics`.

#### `@baocut/legacy-import`
BaoCut v1/v2 project migration (`bcut-project.ts`, `video-plan.ts`, `video-writer.ts`). Reads legacy project files on first run when `BAOCUT_LEGACY_ROOT` is set.

---

## 4. Applications (`apps/*`)

### 4.1 `apps/desktop` — Electron desktop app
- **Stack**: Electron 44 + electron-vite 5 + Vite 7 + React 19.
- **Main** (`src/main/`):
  - `index.ts` / `app-main.ts` — create window, supervise Runtime (spawn as `ELECTRON_RUN_AS_NODE`), dev-mode sets `BAOCUT_HOME=.dev/baocut-home`.
  - `app-menu.ts` — native menu (macOS menu bar, Windows menubar); file actions go through HostBridge.
  - `web-tabs.ts` — multiple open videos = separate webContents tabs with per-tab IPC channels.
- **Preload** (`src/preload/index.ts`): exposes the `HostBridge` to the renderer via `contextBridge` (file dialogs, native shell, updates).
- **Renderer** (`src/renderer/main.tsx`): mounts `@baocut/ui` `<App />`, supplies Electron HostBridge.
- **Packaging**: [apps/desktop/README.md](apps/desktop/README.md).
  - macOS: `npm run package:mac` — Developer-ID signed, notarized, DMG (LZFSE) + ZIP; `mlx.metallib` bundled into `Contents/Resources/bin`.
  - Windows: `npm run package:win` (CPU) / `:cuda` / `:vulkan` — NSIS installer + ZIP, unsigned, runtime self-check.

Scripts (root):
```
npm run dev          # checks prereq + builds Rust workers/WASM, starts electron-vite dev
npm run dev:lite     # skips Rust builds (no video edit/preview/export)
npm run build        # electron-vite build → apps/desktop/out
npm start            # electron-vite preview of built output
npm run package:mac / :win / :win:cuda / :win:vulkan
```

### 4.2 `apps/cli` — `baocut` command line
- Entry: `src/main.ts` → `runCli(argv, adminBucket)`.
- Commands come from the same Runtime tool catalog the MCP service uses — auto-generated via `tools/catalog-snapshot.ts` (snapshot lives under `generated/` and is not committed; rebuilt by `precli` / `pretest`).
- Admin bucket (`src/admin/`) includes: `mcp install`, `skill install`, `runtime status|ensure|stop`, `web open`, `fonts`, `grants`, `jobs`, `models`, `nodes`, `tasks`, `space`, `settings`, `share`, `library`, plus copy files for each language.
- Exit codes (see `cli.ts`): `0` ok · `1` failed · `2` user action needed · `3` Runtime unavailable · `4` bad args.
- Offline help: `cli-copy.ts` + language variants (de, es, fr, it, ja, ko, nl, pl, pt-BR, ru, tr, vi, zh-Hans, zh-Hant) — rendered from the same source as the MCP+BaoCut skill.
- When no Runtime is running the CLI auto-starts one (`--launched-by cli --idle-exit`); it stops itself after `runtime.idleExitMinutes` of no connections.

Run it against a desktop-dev Runtime:
```
BAOCUT_HOME=.dev/baocut-home npm run cli -- status
```

### 4.3 `apps/runtime` — Runtime process
- Entry: `src/main.ts`. Thin wrapper that calls `startRuntime()` from `@baocut/runtime-core`.
- Command line:
  - `--credential-store file|keychain`
  - `--self-check [--probe]` — JSON report on where binaries/data resolve to; nonzero exit on missing.
  - `--launched-by cli --idle-exit` — CLI-launched lifecycle mode.
- Ready handshake: stdout writes `{"type":"ready", …}` once; tokens are in the discovery file, never stdout.

Start stand-alone:
```
npm run runtime              # default home ~/.baocut
```

### 4.4 `apps/web` — Web client
- Static Vite build. Renders the same `@baocut/ui` `<App />` with a Web HostBridge (no native dialogs; files are upload/download).
- Built into `dist/` by `npm run build:web`. Served by the Runtime's `WebService` from `BAOCUT_WEB_DIST`; URLs carry a one-time token generated by `baocut web open --video <id>`.
- No direct network access to the Runtime without the single-use token; origin allow-list via `BAOCUT_ALLOWED_ORIGINS`.

---

## 5. Rust Crates (`crates/*`)

Edition 2024. Workspace version `0.4.0`. Build profiles (from `Cargo.toml`):

- `[profile.wasm]` — `opt-level="z"`, LTO, 1 codegen unit, `panic="abort"`, stripped. Per-package overrides force `opt-level=3` for tiny-skia/render-raster/subtitle-render/frame-render.
- `[profile.dev.package.*]` — rendering hot crates (tiny-skia, render-raster, …, export-worker, media-core, media-native, render-graph, cosmic-text, candle-core, gemm family) pinned to `opt-level=3`. Debug builds of the full pipeline are otherwise ~100× slower.

### 5.1 Data model crates (pure logic, no I/O)

#### `editor-semantics`
Time math: exact rationals, decimal seconds, frame quantization. Shared by everything that touches "when".

#### `video-model`
Video interchange DTOs: cut set, ducking curves, effect refs, markers, speech blocks, placement geometry. Rust-side mirror of `@baocut/protocol` `video.ts` types.

#### `message-ref`
`Text` = (default English literal, `MessageRef` id+args). Worker error text and status messages use this; translations live in TS (`@baocut/protocol/src/messages/<crate>/…`) and are validated by `tools/rust-messages.test.ts`.

#### `timeline`
**Pure core** of the editing semantics (ported from v2 `bcut-timeline`). No I/O.

- Element model: `schema.rs`, `elements.rs`, `geometry.rs`, `keyframes.rs`, `animations.rs`, `effects.rs`, `svg_fill.rs`, `template.rs`.
- Talking-head cut: `cuts.rs`, `detect.rs` — filler/pause/retake detection, word-level cut anchors.
- Semantics: `anchors.rs` (semantic anchors for subtitles/dubs), `follow.rs` (follow another element), `motion.rs` (integration with `motion` crate), `duck.rs` (sidechain ducking), `rules.rs` (per-project rules & constraints), `patch.rs` (patch-based diffs), `words.rs` (word-matching with speech-doc).
- Matching: `match_text.rs` (regex + Unicode-category driven text detection).

#### `motion`
Motion-graph language: `program.rs`, `graph.rs`, `flow.rs`, `lower_bcf.rs` (lower to bytecode form for rasterization).
- Effects registry: `effect/mod.rs` (standard animations).
- Text: `text_motion.rs`, `text_parts.rs`, `interpolate.rs` (value curves).
- Utility: `fingerprint.rs`, `rng.rs`, `curve.rs`, `sample.rs`, `composite.rs`.
- Tests: test families, effect seeds, manifests, libm-only builds.

#### `scene-primitives`
Shared geometric + primitive types used by timeline, motion, frame-render.

#### `speech-doc`
Transcript post-processing (no audio). Input: raw ASR rows with timing. Output: normalized cues with alignment, LLM-based cue polish, bilingual pairings.

- `doc.rs`, `cue.rs`, `sentence.rs`, `speaker.rs` — data model.
- `atomize.rs`, `split.rs`, `layout.rs` — cue segmentation & layout limits.
- `lcs.rs`, `rebind.rs`, `alignment.rs` (implicit in cue ops) — alignment between text tiers.
- `script.rs`, `export.rs` — script view (for blog/chapters) and SRT/WebVTT/Transcript export.
- `llm.rs` — prompts, LLM-based polish with structured output, error budget.
- `paging.rs` — transcript pagination.
- `progress.rs`, `patch.rs`, `build.rs`, `check.rs`, `golden.rs`, `seam.rs`, `timing.rs` — build ops, patching, golden round-trip tests, seam (segment-boundary) smoothing.

#### `speech-doc-bridge`
FFI glue (not exposed) to help the TS side call into speech-doc deterministically.

### 5.2 Render pipeline crates

#### `render-graph`
Shared planner used by both the preview-WASM and native export. Produces a `FramePlan` per frame index: which layers, which transforms, which ducking/anchoring corrections.

- `ducking.rs` — audio sidechain per-layer plan (speech ducking music/BGM).
- Tests: `tests/plan.rs`.

#### `frame-render`
One step below: turn a `FramePlan` + assets into drawing operations. Two feature flags:
- `host` → full raster (uses `render-raster/media`).
- `wasm-safe` (default) → pure, for WASM preview.
- Files: `element.rs`, `effects.rs`, `census.rs`.

#### `render-raster`
**Actual rasterization** backend (tiny-skia, cosmic-text/swash/rustybuzz, SVG via patched resvg v2 vendored under `vendor/bcut-resvg`, media decode).

- `raster.rs`, `drawop.rs`, `exec.rs` — op pipeline, pixel output.
- `fonts.rs` + `font-files` crate — font loading & fallback.
- `media.rs`, `video.rs`, `audio.rs` — media frames (ffmpeg child on host).
- `svg.rs`, `imgcmp.rs` — SVG rendering, image compare (for golden tests).
- `bcf.rs` — motion bytecode executor.
- `assets.rs` — asset cache.
- Default-features = WASM-safe; add `features=["media"]` for host decode/fonts/SVG platform.

#### `subtitle-render`
Cue → pixel, full style pipeline (studio-color, studio-transition, studio-wordbox, designed, boxed-reveal, boxed-motion).

- `host` feature → uses render-raster media (host fonts).
- `wasm-safe` → used in the editor preview WASM.
- `host.rs` + `lib.rs` are the two halves.

#### `timeline-render`
Timeline UI strip drawings (waveform + cuts + subtitles + cursor). Thin wrapper around `render-raster` for the timeline view.

#### `waveform`
Audio spectrum data. Two features:
- Default (WASM-safe): decode BCS1 / BCW1 cached formats only.
- `dsp`: STFT / realfft production of the cached spectrum from PCM.
- Files: `bcs1.rs`, `bcw1.rs`, `dsp.rs`, `beats.rs`, `remap.rs`.

#### `audio-dsp`
Audio processing blocks (used by export-worker and preview):
- `biquad.rs`, `curve.rs`, `dynamics.rs`, `fft.rs`, `loudness.rs`, `master.rs`, `noise.rs`, `osc.rs`, `reverb.rs`, `rng.rs`, `resample.rs`, `stereo.rs`, `truepeak.rs`, `tvlp.rs`, `align.rs`, `math.rs`.

### 5.3 Media crates

#### `media-core`
Platform-agnostic decode/encode wrappers around ffmpeg child process + native codecs.
- `decode.rs`, `encode.rs`, `probe.rs`.

#### `media-native`
Platform codec fast paths: macOS VideoToolbox (`avfoundation→…`), Windows MediaFoundation, frame scaling (`scale.rs`), raw frames (`frames.rs`). Falls back to ffmpeg when unavailable. Tests show the backend used in the `done.video` string (e.g. `avfoundation→avfoundation`).

#### `media-probe`
`ffprobe` shell-out wrapper + native probe fallback. Integration tests in `tests/probe.rs`.

### 5.4 Video engine & worker binaries

#### `video-engine` (library)
Transactional video state. Owns the single-writer SQLite store.

- `lib.rs` — core engine facade.
- `state.rs`, `store.rs` — `VideoState`, SQLite schema and queries.
- `ids.rs` — typed IDs (Uuid v4, prefixed).
- `ops.rs`, `import.rs`, `anchors.rs`, `cuts.rs`, `ducking.rs`, `effects.rs`, `gc.rs`, `video.rs`, `error.rs` — mutation operations. Each op returns a `Receipt` summarizing what actually changed; receipts become the outbox for the Runtime side.
- Tests: `tests/cuts.rs`.

#### `engine-host` (bin, `src/main.rs`)
Process wrapper around `video-engine`. Spawned and supervised by the Runtime's `EngineHost` class in `@baocut/runtime-core`.

- `host.rs` — stdio JSON-line loop: dispatch op to engine, stream receipts to parent.
- `content.rs`, `exports.rs` — import/export paths used by host.
- `package.rs` — portable `.baocut` bundle pack/unpack (video + all assets zipped together; see [video-format-spec §8](docs/spec/video-format-spec.md)).
- `fonts.rs` — list system fonts and bundle fonts for export; forwards to `font-files` crate.
- `barrier.rs` — single-write-lock semantics and multi-client ordering.

#### `export-worker` (bin, `src/main.rs`)
Final render to MP4. Fully cancellable; progress is streamed over stdout as JSON lines.

- `input.rs` — reads frozen `WorkerInput` (frame ranges, layers, codec, captions).
- `master.rs` — audio master pipeline: mixing, ducking curves, EQ/comp/limiter/reverb via `audio-dsp`.
- `render.rs` — drive `frame-render` + `render-raster`, feed frames to `media-core` encoder (native first, ffmpeg fallback).
- `native.rs` — codec selection per platform.
- Feature `external-fonts`: used for macOS release builds so the worker resolves fonts via the shared `web/assets` layout (see [apps/desktop/README §macOS 打包](apps/desktop/README.md)).

#### `model-worker` (bin, `src/main.rs`)
Local inference resident process. Owns one loaded model bundle; Runtime keeps a pool keyed by (bundle, backend).

- Feature flags (from `Cargo.toml`):
  - Default Apple Silicon: `backend-mlx backend-coreml`.
  - Windows/Linux/else: `backend-candle` (optionally `cuda`, `whisper-ggml`, `whisper-ggml-vulkan`, `whisper-ggml-cuda`).
- `worker.rs` — stdio dispatch to `model-runtime` capabilities.
- Wire contract: [docs/spec/model-worker-protocol-spec.md](docs/spec/model-worker-protocol-spec.md). Output format `baocut.asr-result/v1`.
- Tests: end-to-end Whisper → WAV → transcript (requires weights); PNG decode self-test for image bundles.

#### `speech-worker` (bin, `src/main.rs`)
Runs LLM-based speech-doc operations (cue polish, translation-into-cues, speaker rename proposals). Lightweight shell around `speech-doc` `llm.rs` + external LLM text provider selected by Runtime.

- `input.rs` — typed cue streams with locale.
- `llm.rs` — prompt dispatch, back-pressure, output validation against schemas.

#### `model-runtime` (library)
The actual inference implementations. Features gate the backends (MLX / Core ML / candle / whisper-ggml).

- `bundle.rs` — load & hold weights in memory or mmap.
- `audio.rs` — ASR/speech/separation entry points.
- `ticks.rs` — progress tick type for streaming.

#### `font-files`
Font metadata and fallback resolution (shared by subtitle-render, frame-render, engine-host font listing).

#### `credential-helper` (bin)
OS credential-store bridge. Called by `@baocut/runtime-storage`'s `keychain-credential-store.ts` via `JsonLineWorker`. Implements macOS Keychain and Windows Credential Manager; keeps secrets out of the JS process.

### 5.5 Binding crates (`bindings/*`)

#### `bindings/editor-wasm` → consumed by `@baocut/editor-wasm`
- `lib.rs` — wasm-bindgen entry.
- `ranges.rs`, `stage.rs` — pure semantics operations the UI uses constantly: quantize, rect math, layout of cue selection.

#### `bindings/preview-wasm`
- `lib.rs` — wasm-bindgen entry into the editor's preview kernel: build `render-graph`, run `frame-render` (wasm-safe) + `subtitle-render` (wasm-safe) + `render-raster` (no media), return a packed RGBA buffer per frame for drawing into a canvas. Loaded by `@baocut/ui`'s preview kernel.

---

## 6. Data, Storage & Protocols

### 6.1 Runtime home & data locations

The Runtime stores everything under `BAOCUT_HOME` (default `~/.baocut`; dev mode: `.dev/baocut-home`). Key files:

| Path | Content |
| --- | --- |
| `baocut.sock` / `discovery.json` | Endpoint + bearer token for clients. *Never* read tokens from stdout. Written before the `ready` line. |
| `store/conversations/conv_<id>.jsonl` | Append-only conversation. Header → snapshot → delta ops. |
| `store/jobs.jsonl`, `store/applications.jsonl` | Job and application ledgers (append-only: `put`/`remove`; final state = last `put` per key unless followed by `remove`). |
| `store/settings.json`, `store/grants.json` | Settings, agent grants. |
| `credentials.json` (encrypted) or Keychain/CredMan | Provider API keys + internal encryption key references. |
| `models/` | Downloaded local model weights (hashed manifests + per-bundle subdirectories). |
| `artifacts/<sha256>.<ext>` | Content-addressed job outputs (transcripts, baked compositions, dubs, SRT…). |
| `logs/runtime.log` | Rolling runtime log. |
| `scratch/<conv_id>/` | Working directory of stateless agent sessions before a video is created; promoted to a project when the first video appears. |

User project directory: `BAOCUT_PROJECTS_DIR` (default `~/BaoCut`, or `<BAOCUT_HOME>/projects` when `BAOCUT_HOME` is set). Each project contains the engine-host SQLite file, exported files, generated media, and cached preview data.

### 6.2 Wire protocol (`@baocut/protocol/wire.ts`)

- Transport: WebSocket (binary or text frames both accepted; Runtime defaults to JSON on text frames).
- Envelope:
  - Request: `{ "id": number\|string, "method": string, "params": Json, "seq"?: number }`
  - Response: `{ "id": …, "result": Json \| "error": { "code": string, "message": string, "messageRef"?: MessageRef } }`
  - Event: `{ "event": string, "topic": string, "payload": Json, "seq": number }`
- Sequencing: each topic carries monotonic `seq` numbers with `type`=`"snapshot"` (first message, full state) followed by `"patch"` events. Clients that fall behind reconnect and replay the full snapshot.
- Errors: codes are stable identifiers (e.g. `EXPORT_TOOL_MISSING`, `BAD_ARGUMENT`, `NOT_AUTHORIZED`), never localized strings. User-facing text comes from `messageRef` against the i18n catalog.

### 6.3 Command protocol & transactions

Each video mutation (cut, cue edit, place clip…) goes through engine-host as a named op. The op runs inside one SQLite transaction and returns a **Receipt** that enumerates:

- What data changed (before/after keys, hashes).
- Which subtitles/clips/keyframes were added or removed.
- The new `videoRevision`.

Receipts form the outbox that the Runtime forwards to subscribers as a `video.topic` event — and they are what the Runtime commits to durable storage before confirming the request. The same receipts feed the undo stack and the job application logic. See: [docs/spec/command-protocol-spec.md](docs/spec/command-protocol-spec.md).

### 6.4 Runtime ↔ Rust workers (stdio JSON lines)

All Rust worker crates use one pattern, implemented on TS side by `JsonLineWorker`:

- One JSON object per line on stdin/stdout.
- `{ type: "request", id, op, args }` → `{ type: "response", id, ok, body } | { type: "error", id, code, message, messageRef }`.
- Progress / streaming mid-flight: `{ type: "event", id, name, payload }`.
- Cancel: parent sends `{ type: "cancel", id }`; worker must respond within a bounded grace window then cleanly exit its thread pool.

Documents: [engine-host (arch §2.3)](docs/architecture/architecture-design.md), [Model Worker Protocol spec](docs/spec/model-worker-protocol-spec.md).

### 6.5 Portable `.baocut` bundle

ZIP archive. Contains:
- `video.json` — full `videoSchemaVersion`-ed video DTO.
- `media/<sha256>.<ext>` — every referenced asset, keyed by hash (matching what's in artifact store).
- `history.jsonl` — optionally, the receipts log so re-opening shows the undo stack.

Implementation: `crates/engine-host/src/package.rs`; spec: [docs/spec/video-format-spec.md §8](docs/spec/video-format-spec.md).

---

## 7. Skill System & Templates

### 7.1 Craft skills (`skills/`)
Loaded by Runtime's `SkillCatalog`. One skill = one directory containing `SKILL.md` and optional supporting files.

Built-in skills:
- `subtitle-workflow` — transcribe → translate → split → style → export.
- `talking-head-cut` — filler/retake detection + cut + seam smoothing.
- `narration` — script plan → synthesize → cut picture to narration.
- `polish-transcript` — LLM cue polish + gap stitching.
- `motion-graphics` — HTML composition authoring → bake → place.
- `shorts-segments` — chapter/shorts proposals from transcript.
- `video-blog`, `video-summary`, `video-chapters`, `video-production` — higher-level workflows.

Skill contract: markdown with structured sections (context, steps, tool allow-list, approval matrix). Runtime's `Harness` passes them into the agent engine as system-context documents. Implementations add nothing new to Runtime; they are *declarative* recipes over the tool catalog.

### 7.2 Agent skill (`agent-skills/baocut/SKILL.md`)
External-agent instructions for using BaoCut via CLI or MCP. A single source rendered by:
- `tools/sync-agent-skill.ts` → copies craft-skill guides from `skills/` into the agent skill's craft pages (never hand-edit those copies).
- CLI's `help` + MCP tool descriptions are built from the same catalog snapshot.

Install on an external agent:
```
baocut skill install    # drops BaoCut skill into detected agent skill dirs
baocut mcp install      # wires MCP server entry into agent MCP configs
```

### 7.3 Templates (`templates/`)
Home → "Create video" templates. One per directory. Required contents:
- `prompt.md` — scene-brief prompt + field definitions.
- `cover.jpg` + `preview.mp4` (optional) — UI thumbnails.
- `locales/` (optional) — per-language prompt variants.
- `template.json` (optional) — structured schema + defaults.

Loaded by Runtime's `TemplateCatalog` (`resolveBuiltinTemplatesDir()` → env → packaged resources → repo). User templates live in `<BAOCUT_HOME>/templates`. Spec: [docs/spec/template-spec.md](docs/spec/template-spec.md).

---

## 8. Build System & Tooling

All root commands are documented in `package.json`; the critical ones are below.

### 8.1 Toolchain requirements

| Tool | Min version | Purpose |
| --- | --- | --- |
| Node.js | 22.12+ (22.18+ recommended for packaging) | TypeScript source runs with `--experimental-strip-types`. Vite 7 requires Node 22. |
| Rust stable | current stable | Edition 2024, `wasm32-unknown-unknown` target. |
| CMake | latest | whisper.cpp / candle build dependencies (Windows / non-Apple). |
| Xcode (macOS arm64) | current | Metal compiler required for MLX build. `xcode-select --switch /Applications/Xcode.app/…`. |
| MSVC Build Tools (Windows) | C++ desktop workload + Windows SDK | Required for Rust MSVC + CMake. |
| LLVM + libclang (Windows) | current | Rust bindgen. Set `LIBCLANG_PATH` if the installer doesn't. |
| ffmpeg / ffprobe | on PATH | Media probe, transcode, audio prep, export. Not bundled. |

### 8.2 Root `package.json` scripts (reference)

| Script | What it does |
| --- | --- |
| `npm run doctor` | `tools/dev-check.mjs`: check Node/Rust/cargo targets/CMake/ffmpeg. Missing source-build prereqs → non-zero exit. |
| `npm run setup` | doctor + build engine (`build:engine`) + build WASM (`build:wasm`). Idempotent. |
| `npm run dev` | `predev=setup` → start Electron dev (Vite + Electron hot reload + auto Runtime). |
| `npm run dev:lite` | `predev:lite` runs doctor `--lite` (no Rust). Shell/UI only. |
| `npm run dev:designs` | Start prototype at `http://127.0.0.1:4331/#/home` (requires `npm --prefix designs/baocut ci` once). |
| `npm run build` | `prebuild=build:wasm + build:catalog + build:agent-skill` → electron-vite build. |
| `npm start` | electron-vite preview built output. |
| `npm run runtime` | Start Runtime only (TS source via `--experimental-strip-types`). |
| `npm run cli -- <args>` | Run the `baocut` CLI. `precli` rebuilds the offline tool-catalog snapshot. |
| `npm run build:engine` | `tools/build-engine.mjs`: cargo build of `engine-host`, `export-worker`, `speech-worker`, `model-worker`. Extra args after `--` go to cargo (e.g. `-- --release`). |
| `npm run build:wasm` | `tools/build-wasm.mjs`: `wasm32-unknown-unknown` build of `bindings/editor-wasm` + `bindings/preview-wasm`; runs optional `wasm-opt`, copies artifacts into `packages/*` locations. |
| `npm run build:web` | vite build for `apps/web` → `dist/`. |
| `npm run build:catalog` | Regenerate offline CLI tool-catalog snapshot (`tools/catalog-snapshot.ts`). |
| `npm run build:agent-skill` | Sync craft guides into `agent-skills/baocut/` (`tools/sync-agent-skill.ts`). |
| `npm test` | `pretest` builds catalog + agent-skill; then `vitest run` (unit + E2E with fake Codex driver, fake provider server, no Rust required for most suites). |
| `npm run typecheck` | `tsc -p tsconfig.json --noEmit` (strict, noUncheckedIndexedAccess). |
| `npm run package:mac` / `:win` / `:win:cuda` / `:win:vulkan` | Release packages (see §4.1). |
| `npm run check:file-fonts` | Hidden Electron window sanity-checks every bundled font loads + injects into preview WASM. Run after any build/layout change. |
| `npm run check:model-assets` | End-to-end path-resolver check for packaged `model-assets/`. |
| `npm run bench:preview` / `bench:panels` | Preview/panel performance benches (see [development-workflow §2](docs/development-workflow.md#2-验证)). |
| `npm run icons` | Render app icon variants from `tools/app-icon/` source. |

### 8.3 Build helper scripts (`tools/`)

| File | Job |
| --- | --- |
| `dev-check.mjs` / `dev-check.test.ts` | Doctor logic. |
| `build-engine.mjs` | Discovers cargo, chooses target dir, runs cargo, reports progress. Respects `BAOCUT_WORKER_FEATURES`. |
| `build-wasm.mjs` | Wrapper for `wasm-pack`-style builds; installs `wasm32-unknown-unknown` target if missing. |
| `cargo-path.mjs` | Cargo resolution: PATH, then `CARGO_HOME/bin`, then rustup siblings. |
| `catalog-snapshot.ts` + `.setup.ts` + `.test.ts` | Runtime tool-catalog snapshot used by CLI offline help + vitest global setup. |
| `i18n-scan.mjs` + `.test.ts` | Scans TypeScript/TSX/JS for Chinese text not in copy catalogs. Test-gated. |
| `rust-messages.mjs` + `.test.ts` | Lists all Rust `msg!(…)` uses and validates matching entries in the TS message catalogs. |
| `sync-agent-skill.ts` + `.test.ts` | Sync craft guides from `skills/` → `agent-skills/baocut/` craft pages. |
| `s2-styles.ts` + `s2-styles-client.ts` + `s2-styles-merge.ts` | React Spectrum S2 stylesheet pipeline. |
| `third-party-notices.ts` + `.test.ts` | Generates `THIRD_PARTY_NOTICES.md` and bundle license PDF. |
| `app-icon/` | Icon source + renderer. |
| `export-bench.ts`, `preview-bench.ts` | Bench harnesses. |
| `pdf-licenses.ts` | License PDF generator. |

### 8.4 Cargo build notes

- `--locked` is used by all release/packaging flows.
- `BAOCUT_WORKER_FEATURES`: comma-separated extra cargo features for `model-worker` in `build:engine` (e.g. `cuda,whisper-ggml-cuda`).
- `BAOCUT_GPU`: `off` / `0` / `cpu` / `no` force the worker to stay on CPU regardless of backend features.
- Profiles (see §5 intro): dev mode still optimizes render crates at O3, and debug candles tensor kernels are forced O3. Expect long first `cargo build`.
- Custom target dir: put `build.target-dir = "/Volumes/Fast/baocut-target"` in `.cargo/config.local.toml` (create it from the example). Keep it separate per worktree to avoid lock contention.

---

## 9. Running & Developing BaoCut

### 9.1 Quick-start (full)

```sh
# macOS prerequisites
xcode-select --install
brew install cmake ffmpeg
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
. "$HOME/.cargo/env"
rustup default stable
rustup target add wasm32-unknown-unknown
# Apple Silicon local models: install full Xcode once, launch once to accept license, then:
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
xcrun --find metal  # must print a path; if not: xcodebuild -downloadComponent MetalToolchain

# Clone & run
git clone https://github.com/jimliu/baocut.git
cd baocut
npm ci
npm run doctor          # exits non-zero on missing source-build prereqs; ffmpeg missing = warning
npm run dev             # setup + opens Electron window
```

Dev home is `.dev/baocut-home`. Data stays inside the repo, isolated from any packaged app.

### 9.2 Quick-start (lite / UI-only / no Rust)

```sh
npm ci
npm run dev:lite        # will warn what features are unavailable
```

Shell, home, Space browser, settings, conversation UI all work. Video editing, preview, export, and local inference are unavailable until you install the Rust toolchain and run `npm run dev`.

### 9.3 Prototype-first UI changes

```sh
npm --prefix designs/baocut ci
npm run dev:designs     # http://127.0.0.1:4331/#/home
```

Per [development-workflow §3](docs/development-workflow.md#3-多端同步): user-visible changes must be prototyped, verified, and approved before they land in `packages/ui`. The prototype and Electron shells share iconography and most tokens; prototype's `icon-sync.test.js` verifies byte-identical icon SVGs.

### 9.4 Running tests

```sh
# Fast unit tests (default: zh-Hans locale, sandboxed downloads, fake drivers & providers)
npm test

# Target a single file
npm test -- apps/cli/src/cli.test.ts
npm test -- tools/dev-check.test.ts

# Rust unit/integration (one crate)
cargo test -p speech-doc --locked
# Full workspace Rust
cargo test --workspace --locked
```

`vitest` global setup (`tools/catalog-snapshot.setup.ts`) rebuilds the CLI tool catalog before tests; the test env sets `BAOCUT_LOCALE=zh-Hans`, `BAOCUT_FONT_DOWNLOADS=off`, a temp `BAOCUT_DOWNLOADS_DIR`, and never hits real network APIs for suites that don't opt in.

### 9.5 Useful env vars (full list in [README.md §Environment variables](README.md#environment-variables))

| Variable | Example | Purpose |
| --- | --- | --- |
| `BAOCUT_HOME` | `.dev/baocut-home` | Runtime data root. |
| `BAOCUT_PROJECTS_DIR` | `~/Movies/BaoCut` | Where new projects live. |
| `BAOCUT_BIN_DIR` | `/Applications/BaoCut.app/Contents/Resources/bin` | Override worker binaries. |
| `BAOCUT_ENGINE_HOST` / `BAOCUT_EXPORT_WORKER` / `BAOCUT_MODEL_WORKER` | path | Point individual workers elsewhere. |
| `BAOCUT_MODELS_DIR` | `/External/models` | Where weights live (default: `<BAOCUT_HOME>/models`). |
| `BAOCUT_TEMPLATES_DIR` / `BAOCUT_SKILLS_DIR` / `BAOCUT_AGENT_SKILLS_DIR` | path | Override built-in template/skill/agent-skill roots. |
| `BAOCUT_LEGACY_ROOT` | `~/Library/Application Support/BaoCut/` | Migration source for v1/v2 projects. |
| `BAOCUT_LOCALE` | `en`, `zh-Hans`, `ja` | Force a language (tests default to `zh-Hans`). |
| `BAOCUT_ALLOWED_ORIGINS` | `http://localhost:5173,https://foo.example` | Extra CSP-origins for the WebSocket gateway. |
| `BAOCUT_RUNTIME_ENTRY` | path | What binary the CLI spins when no Runtime is running. |
| `BAOCUT_GPU` | `off` | Keep inference on CPU even if GPU features built. |
| `BAOCUT_WORKER_FEATURES` | `cuda,whisper-ggml-cuda` | Extra cargo features for `build:engine`. |
| `BAOCUT_FFMPEG` | `/opt/homebrew/bin/ffmpeg` | Force a specific ffmpeg. |
| `BAOCUT_<ID>_PATH` | `/Applications/Codex.app/Contents/MacOS/codex` | Override agent-engine binary path (Codex, Claude, Gemini, Cursor, Grok, Kimi). |

### 9.6 Debugging a running session

Per [development-workflow §5.3](docs/development-workflow.md#53-开发态数据与会话记录):

- Conversations: `.dev/baocut-home/store/conversations/conv_*.jsonl` — append-only; use the snippet in §5.3 to replay into a single JSON.
- Jobs: `.dev/baocut-home/store/jobs.jsonl` → `jq -c 'select(.op=="put")'` sorted by `.record.jobId`.
- Job outputs: `.dev/baocut-home/artifacts/<sha256>.<ext>` (strip the `sha256:` prefix).
- Logs: `.dev/baocut-home/logs/runtime.log`.
- To connect a CLI against the desktop-dev Runtime: `BAOCUT_HOME=.dev/baocut-home npm run cli -- <command>`.

---

## 10. Cross-cutting Concerns

### 10.1 i18n / Copy catalogs

- User-visible text **never** appears as string literals in code or JSX.
- Each module has `<module>-copy.ts` (English) + `<module>-copy.<locale>.ts` for each shipped locale. Defined via `defineMessages(en, { 'zh-Hans': zhHans, … })`; missing keys are compile-time errors.
- Runtime-emitted text, errors, and task descriptions use `defineCatalog('<area>', en, {…})` in `@baocut/protocol/src/messages/<area>/`, which yields `Localized` pairs (string + `MessageRef`).
- Rust worker text: `msg!("<area>.<name>", "English template {arg}", arg…)` → produces `(english_literal, MessageRef)`. `tools/rust-messages.test.ts` ensures the template string exactly matches the catalog entry in `packages/protocol/src/messages/<crate>/`.
- Scan gate: `tools/i18n-scan.mjs` + `.test.ts` catches Chinese strings in TS/TSX files that haven't been catalogued.
- Fallback order: exact locale → primary language → English.
- Shipped locales: `en, zh-Hans, zh-Hant, ja, ko, de, es, fr, it, nl, pl, pt-BR, ru, tr, vi` (see `@baocut/protocol` `LOCALES`).

### 10.2 Security & trust boundaries

- **Agent commands never drive shell directly.** Every action the agent can take goes through the Runtime tool catalog (`ToolCatalog`, `VideoTools`, `ModelTools`), routed through `AgentScope` + `AgentGrants` + `ApprovalService`.
- **Untrusted content is data, never instructions.** A fetched webpage or an auto-translated subtitle never becomes a prompt; the Harness isolates inputs to typed fields.
- **Credential separation.** Provider keys live in the credential store (Keychain/Credential Manager on desktop; encrypted file otherwise). Providers' `provider-fetch` always passes through a redactor that masks secrets in logs.
- **Code bundles are sandboxed.** `code-runtime` CompositionHost runs in Electron offscreen window with `file:` / `data:` only request allow-list; `bundle-inspect` performs a static scan for `http(s):` references before first load.
- **Web clients use one-time tokens.** `WebService` never accepts a connection that only knows the Runtime's bearer; browser URL carries a short-lived single-use token that is consumed on first WebSocket connect.
- **MCP service is opt-in.** Each pair of (MCP server + principal) must be enabled; permissions default to the narrowest matching grant.

### 10.3 Approval flow

- `ApprovalService` (in `@baocut/harness`) + `commandRule()` (in `@baocut/agent-drivers`) classify each tool call:
  - `auto`: approve.
  - `low`: auto within budget; escalate once.
  - `high`: user must click.
  - `deny`: never auto.
- `TaskContract` (see `@baocut/harness task-contracts.ts`) couples a scope + budget + actor; `NO_TASK_BUDGET` = emergency free-run (not for regular flows).
- Approval requests are surfaced to: Electron UI dialog, CLI stderr+prompt, MCP's approval protocol. All decisions durable in `grant-store.ts`.

### 10.4 Recovery & crash tolerance

- Job Manager: `JobLedger` append-only → on restart `job-recovery.recoveryAction()` walks pending jobs and decides: re-run from scratch, resume from staging, or ask user.
- Engine-host: single-writer SQLite with durable commits and a redo-log of ops. Runtimes that crash mid-op do not corrupt the store; the next engine-host startup completes or rolls back.
- Export-worker: cancelable, outputs atomic `.<name>.part` → rename, so a killed export never leaves a half-valid MP4.
- Conversation store: append-only JSONL with snapshots; corrupt suffix is preserved as `.corrupt-*` file and the remainder is still readable.

---

## 11. Specifications Reference

All hard contracts live under `docs/`. Treat them as the authority — the Code Wiki is the map, `docs/` is the territory.

| Document | Covers |
| --- | --- |
| [product/product-design.md](docs/product/product-design.md) | Product scope, UI surfaces (Home / Space / Editor), autonomy + permissions model, 12 end-to-end workflows, release road-map R0–R4, requirements register. |
| [architecture/architecture-design.md](docs/architecture/architecture-design.md) | Module ownership, process lifecycle, harness & drivers, storage layout, model routing, render pipeline, MCP/Web, code bundles, security, 14 key design decisions D01–D14. |
| [spec/video-format-spec.md](docs/spec/video-format-spec.md) | Time model TIME-01..08, sequences, clips, speech doc, subtitles, dubs, language versions, `.baocut` bundle. |
| [spec/command-protocol-spec.md](docs/spec/command-protocol-spec.md) | Wire envelopes, op transactions, receipts, undo, batching & preflight, event contracts & error codes. |
| [spec/model-worker-protocol-spec.md](docs/spec/model-worker-protocol-spec.md) | Runtime ↔ `model-worker` stdio JSON messages, bundle manifest, staging directory, `baocut.asr-result/v1`. |
| [spec/node-protocol-spec.md](docs/spec/node-protocol-spec.md) | LAN endpoints (`@baocut/nodes`), pairing + tokens, remote jobs & events, cleanup rules. |
| [spec/template-spec.md](docs/spec/template-spec.md) | Template layout, manifest, covers, per-locale variants, scene-brief prompts. |
| [spec/code-bundle-spec.md](docs/spec/code-bundle-spec.md) | `baocut/1` & `hyperframes/1` contracts, manifest, instance file, author obligations, bake contract. |
| [acceptance/acceptance-spec.md](docs/acceptance/acceptance-spec.md) | Test strategy, release gates, performance targets (M01–M12), UI + export + model acceptance matrix. |
| [glossary.md](docs/glossary.md) | Canonical naming. |
| [repo-conventions.md](docs/repo-conventions.md) | Placement, naming, icons, i18n rules for contributors. |
| [development-workflow.md](docs/development-workflow.md) | Spec-code-test sync, verification matrix by change area, prototype-first discipline, platform gates, worktree rules. |
| [docs/design/subtitle/README.md](docs/design/subtitle/README.md) | Subtitle & translation design — maps v2 speech-doc data model to v3. |
| [docs/design/timeline/README.md](docs/design/timeline/README.md) | Timeline semantics — maps v2 elements onto `crates/timeline` / video format. |
| [docs/design/agent-surface/README.md](docs/design/agent-surface/README.md) | CLI/MCP/BaoCut skill shared tool-catalog design. |
| [docs/macos-signing.md](docs/macos-signing.md) | Developer ID identities, notary profiles, restore & GitHub Actions Secrets backup. |

---

## 12. Commit Discipline (for contributors)

From [AGENTS.md](AGENTS.md) / [development-workflow §1](docs/development-workflow.md#1-规范与实现):

- Format: `type(scope): summary`. English. Types: `feat fix docs refactor perf test build ci chore revert`. Scope = lowercase-dashed feature (e.g. `preview`, `file-location`, `release`).
- One commit = one coherent intent. Tests/docs for the change ride with it.
- Squash/adjust commits before merging to `main` to remove trial-and-error history; never rewrite `main` or published tag history.
- **Do not push** without a separate explicit request in the current task.
- **Worktrees must be deleted** (or archive-tagged then removed) when the task completes — including `.claude/worktrees/agent-*`.
- Lockfiles: `package-lock.json` changes go with npm dependency changes; `Cargo.lock` with cargo dependency changes.

---

## 13. Quick-reading entry points (for new developers)

1. **Domain first.** Read `README.md` §"Why BaoCut" → §"Four ways in, one Runtime" → §"Repository layout".
2. **Architecture.** Skim `docs/architecture/architecture-design.md` §1 (overall architecture) + §13 (code organization).
3. **Protocol.** `packages/protocol/src/wire.ts`, `packages/protocol/src/methods.ts`, `packages/protocol/src/video.ts`. Gives you the nouns and verbs.
4. **Runtime.** `packages/runtime-core/src/runtime.ts` → `gateway.ts` → `handlers.ts` → `agent-tools/tool-catalog.ts` → `videos/engine-host.ts`.
5. **Video engine (Rust).** `crates/video-engine/src/lib.rs` → `ops.rs` → `store.rs` → `crates/engine-host/src/host.rs`.
6. **UI.** `packages/ui/src/app.tsx` → `packages/ui/src/host.ts` → `packages/ui/src/model/editor.ts` → `apps/desktop/src/renderer/main.tsx`.
7. **Render pipeline.** `crates/render-graph/src/lib.rs` → `crates/frame-render/src/lib.rs` → `crates/render-raster/src/lib.rs` → `crates/export-worker/src/render.rs` and `crates/subtitle-render/src/lib.rs`.
8. **Add a new long-running operation?** Pattern-match a pipeline in `packages/jobs/src/pipelines/` + `JobManager` admission in `job-admission.ts` + `job-application.ts` for applying results back.

---

_This wiki synthesizes the current state of the repository (3.1.0 / crate version 0.4.0). For authoritative definitions, always open the referenced `docs/` specification or the source files it points at._
