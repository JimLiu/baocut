---
name: baocut
description: >-
  BaoCut-only operator for the installed `bcut` CLI and `.bcut` projects.
  Implicitly trigger only when the request explicitly names BaoCut or `bcut`,
  targets a `.bcut` project or BaoCut Subtitle Studio, or continues a BaoCut
  workflow already established in the conversation. Do not trigger solely for
  generic audio or video, transcription, subtitles, translation, editing,
  animation, review, rendering or export, FFmpeg, or another NLE. Once
  triggered, execute and verify the requested BaoCut transcription, subtitle or
  timeline, overlay, review, render, or export workflow. Being inside the
  BaoCut source repository is not itself a trigger; ordinary code and
  documentation tasks follow repository instructions unless they also operate
  the product or a `.bcut` project.
metadata:
  version: "1.0.11"
  minAppVersion: "1.0.11"
---

# BaoCut

Use the bundled resolver for every command. On macOS/Linux:

```bash
BAOCUT_SKILL_ROOT="<this-skill-directory>"
"$BAOCUT_SKILL_ROOT/bin/baocut" --json version
```

On Windows, run the native PowerShell resolver (WSL is not required):

```powershell
$env:BAOCUT_SKILL_ROOT = "<this-skill-directory>"
& "$env:BAOCUT_SKILL_ROOT\bin\baocut.ps1" --json version
```

## Mandatory startup version gate

Run this gate once at the start of every BaoCut task, before `spec`, `doctor`,
any project command, or reuse of an existing `bcut serve`:

1. Explicitly run the platform resolver's `--json version` command above and
   retain its `appVersion` and `commit`. A successful resolver handshake, a
   compatible `spec`, `doctor`, or `serve --status` is not an update check.
2. Immediately read and execute [references/updates.md](references/updates.md):
   fetch the published appcast and compare its version numerically with the
   local `appVersion`. Only an unavailable appcast may be reported as skipped.
3. When the appcast is newer, update the standalone skill and let its refreshed
   resolver download, verify, and cache the pinned CLI before continuing. Do
   not merely report the update or keep using the compatible old CLI. Never
   overwrite a development checkout or an App-bundled skill; use the supported
   source/App update path documented in the reference instead.
4. After any CLI update, run the refreshed resolver with `serve --background`,
   then `serve --status`. This idempotent start replaces an older same-root
   service, restores its mounts, and must report the refreshed CLI's
   `appVersion` and `commit`; also require HTTP 200 from its health endpoint.
   Discard any URL discovered before the restart.

Only after this gate may capability preflight and the requested work begin.

The resolver locates the right CLI on its own — never call `bcut` directly:

- An explicit `BAOCUT_CLI` (or `BCUT_EXECUTABLE` / `BAOCUT_BIN`) override wins.
- In a BaoCut development checkout (this skill directory inside the source
  tree) it uses the workspace build — newest of release/debug — or runs the
  sources via `cargo run` when nothing is built yet. It prints a
  `development checkout detected` note to stderr in that case.
- In a released install it uses the CLI embedded in BaoCut.app, in either
  `/Applications` or `~/Applications`; every App release ships with its
  matching `baocut-cli`, so App and CLI versions always move together.
- Then a `bcut` on PATH.
- Then the cached CLI this skill pinned earlier, under
  `${XDG_CACHE_HOME:-~/.cache}/baocut/cli/<version>-build.<build>/bcut`.

On Windows, `bin/baocut.ps1` uses the same explicit overrides,
development-checkout build, and PATH lookup first. It then checks cached
`<version>-build.<build>` CLIs newest-first — by version *and* build, because
the handshake only reports the marketing version and cannot tell two builds
apart — and compatibility-checks them locally. Only when no compatible cache
exists does it find the newest stable `baocut-v<version>-build.<build>` GitHub
Release that includes `windows-cli-release.json`, downloads its x64 Windows
archive, verifies the manifest-pinned SHA-256, and caches `bcut.exe` under
`%LOCALAPPDATA%\BaoCut\cli\<version>-build.<build>\bcut.exe`. "Newest" is the
highest `<version>`/`<build>` parsed from the release tags, not the first entry
the API returns: Windows assets are appended to an already-published macOS
release, so creation order does not track build order. The Windows
archive is currently an unsigned preview, so SmartScreen, Smart App Control,
or enterprise policy may warn about or block it; SHA-256 proves download
integrity, not publisher identity.

A compatible cache normally ends the search, so a rebuild published under the
same marketing version is not picked up on its own — nothing local announces
it, since the Windows skill ships no CLI pin and `--json version` carries no
build number. Set `BAOCUT_SKILL_CLI_UPDATE_CHECK=1` to let the cache path
compare against the newest release and adopt a higher build; unset, that path
stays entirely offline, and any failed check silently keeps the cached CLI.
`BAOCUT_SKILL_NO_DOWNLOAD=1` still wins over this opt-in.

Setting `BAOCUT_VARIANT=cuda13` switches the whole Windows resolution to the
GPU variant: the handshake additionally requires backend `candle-cuda`, the
cache directory gains a `-cuda13` suffix, and downloads use the release's
`windows-cli-cuda-release.json` and `…-x86_64-pc-windows-msvc-cuda13.zip`
asset, extracting the bundled CUDA runtime DLLs next to `bcut.exe`. This is an
explicit opt-in — the resolver never probes for a GPU. It requires an NVIDIA
GPU with compute capability 8.0+ (Ampere / RTX 30 series or newer) and driver
>= 580; no CUDA Toolkit install is needed, and without a compatible GPU the
CLI falls back to CPU inference. If no release ships the CUDA asset yet, the
resolver fails with a clear message instead of silently using the CPU build.

The resolver then checks the CLI contract and minimum BaoCut App version
before it runs the requested command.

If nothing above resolves, or the resolved CLI is older than
`metadata.minAppVersion`, the resolver downloads the CLI pinned by this
skill's `cli-release.json` — the standalone release archive built from the
same commit as the matching App. It verifies the archive's SHA-256 against
the pin before extracting anything, unpacks `bcut` and its co-located
`mlx.metallib` into the cache, and reruns the full contract and version
handshake against the downloaded binary. Any failure exits 3 with the manual
download URL. The download carries no `com.apple.quarantine` attribute and the
Developer ID signature lives in the binary itself, so the cached CLI runs
without a Gatekeeper prompt. The resolver exports the packaged Metal library
path before executing the cached CLI, so local MLX transcription never depends
on a metallib left behind on the release build machine.

Two deliberate exceptions never trigger the download: an explicit
`BAOCUT_CLI`-style override and a development checkout. Both are chosen on
purpose, so a failing handshake there must be fixed at the source — update the
override or rebuild the workspace — rather than silently shadowed by a release
binary. Set `BAOCUT_SKILL_NO_DOWNLOAD=1` to disable the download entirely;
`BAOCUT_SKILL_NO_DEV=1` disables development-checkout detection.

The skill copy bundled inside BaoCut.app has no `cli-release.json`, because an
App install always ships its own matching CLI beside it.

If the resolver exits 3, follow its guidance instead of bypassing the check.

## Choose the workflow

- For transcription, polish, and translation, create the project in the shared
  projects library first, start the preview server, then run the pipeline;
  read [references/workflows.md](references/workflows.md).
- For a complete local pipeline, use `auto`; read
  [references/workflows.md](references/workflows.md).
- For an Agent-backed AI stage with pending calls, immediately read and follow
  [references/agent-tasks.md](references/agent-tasks.md). Its on-demand worker
  rules — pool sized from the actual page plan (translate uses
  `ceil(source words / 2200)`; align also enforces at most 40 items and a
  complexity budget, all capped by real slots), per-stage worker tiers (mid-tier for
  translate/polish, high-reasoning tier for align and repair), hand-written
  align answers with no scripted cutting and no unchanged resubmits — and its
  consolidated-repair rules (including what `refine-align --only-hard` really
  dispatches) are execution requirements, not optional tuning.
- For the Subtitle Studio browser preview — serving and mounting projects,
  applying page edits, page requests, history recovery, punctuation display,
  or preview troubleshooting — read
  [references/studio.md](references/studio.md). The page code itself is this
  skill's `templates/` directory, served live by `serve`.
- For source cuts, OUTPUT clip arrangement, appended media, or rough cutting,
  read [references/editing.md](references/editing.md).
- For overlays, B-roll, watermarks, text styles, or debug frames, read
  [references/elements.md](references/elements.md).
- For overlay motion, read [references/animation.md](references/animation.md).
- For reusable foreground templates — caption slot, segment rail, progress bar,
  station logo — and the `data.json` data layer that binds them, read
  [references/templates.md](references/templates.md).
- For text baked into video frames, read
  [references/screentext.md](references/screentext.md).
- For delivery, run `check --strict` and then use the export recipes in
  [references/exports.md](references/exports.md).
- For granular project edits, discover the installed surface with `spec` and
  command `--help`; do not infer commands from older BaoCut releases.
- For checking whether this skill or the CLI has a newer release, verifying
  skill/CLI version consistency, or helping the user update, read
  [references/updates.md](references/updates.md).

## Optional completion accounting

- Keep stage timing and call accounting disabled by default. Enable it only
  when the user explicitly requests stage timing, call counts, performance
  statistics, or a run summary containing them. Do not collect baselines or
  add an accounting table otherwise.
- When enabled, start a run ledger before the first long or mutating command.
  If the project may use `--llm agent`, snapshot `task status <project> --json`
  and retain the existing `(task, callId)` pairs as the baseline.
- Record wall-clock start and finish times for every workflow stage that
  actually runs. For `auto`, split the ledger at JSONL `stage` transitions;
  keep per-language work distinct (for example `translate:zh-Hans` and
  `align:zh-Hans`) and include repair, quality-check, and export stages when
  they run. Mark reused or skipped stages explicitly instead of assigning
  invented durations.
- After the producer's terminal event, read `task status` once more. Diff
  `completedCalls` against the baseline, group the new accepted calls by their
  stage/kind, and count repair or retry calls in the stage that caused them.
  Unless the user defines another meaning, “calls” means new Agent/LLM calls,
  not shell or CLI invocations. Follow the timing rules in
  [references/agent-tasks.md](references/agent-tasks.md#report-timing-without-double-counting).
- When enabled, end the task with a compact table containing `Stage`, `Wall
  time`, `New calls`, and `Result`, followed by end-to-end wall time and total
  new calls. Use `0` for stages that made no Agent/LLM call and `unobserved`
  when timing evidence is unavailable. Never sum overlapping `queueMs`,
  `workerMs`, or `totalMs` values and present the result as elapsed wall time.

## Shared projects library and multi-client sync

- New transcription/translation projects belong in the shared projects
  library so the BaoCut App sees them immediately. Resolve it with
  `"$BAOCUT_SKILL_ROOT/bin/baocut" --json project dir` (macOS default:
  `~/Library/Application Support/BaoCut/projects`); create projects there with
  `project create` unless the user names another location.
- For URL media, never invent or derive a `--download-dir`. Omit the flag unless
  the user explicitly names a one-off destination; the CLI then honors the
  shared `download.dir` setting. When it is absent, Windows uses the user's
  system Downloads known folder; other platforms fall back to `<project>/media`.
- After any URL-media run downloads or reuses a video, read its actual path from
  `data.media` in a `transcribe` result or from
  `--json project show <project>` at `data.manifest.media.path`. Tell the user
  that exact path explicitly; do not merely say that the download completed.
- Progress is shared state: the App, the browser preview, and other CLI
  sessions all observe the same project registry and per-project progress
  files. A transcription started from this skill shows up — with live
  progress — in the App and at the preview URL; do not duplicate work you can
  already observe.
- After starting a transcription, always surface the preview URL (see
  [references/workflows.md](references/workflows.md)): open it in the
  agent's built-in browser to verify, and print it for the user so they can
  open the same page in their own browser.

## Safety and truth sources

- Treat `transcript.json` `words[]` as the persistent text/time truth. Use BaoCut
  commands or Subtitle Studio apply operations; do not hand-edit word atoms,
  fingerprints, stage stamps, `trans`, or `transAlign`.
- Translation alignment is target-first: freeze natural target-language display
  pieces before mapping them to consecutive sentence-word spans. Never copy,
  infer, or preserve original subtitle cue boundaries for this purpose; the
  local Agent and Cloud Model follow the same contract.
- Treat `timeline.json` as command-owned truth. Source-local cuts and OUTPUT
  clips are separate layers; overlays live on OUTPUT time. Do not hand-edit the
  timeline, AI provenance, revisions, or fingerprints.
- Preserve input media. A normal pipeline writes into a `.bcut` project and does
  not modify the source file. Feed the original container directly; `transcribe`
  decodes and resamples it itself, so extracting a WAV first only repeats work
  the command already does.
- Prefer `--json` for short commands and `--jsonl` for long commands. JSONL
  cancellation is one stdin line: `{"cmd":"cancel"}`.
- AI `--review` output is only a candidate. Inspect it, then explicitly run
  `review accept` or `review reject`.
- A successful polish is not the end of a named multi-speaker task while
  placeholder labels remain. After accepting any polish review, follow
  [the confirmed-speaker sync](references/workflows.md#sync-confirmed-speaker-names-after-polish):
  apply only evidence-backed identities with `speakers rename`, preserve
  ambiguous labels, and report every unresolved speaker id.
- Run `check --strict` before claiming a deliverable is ready. Exit 2 means the
  quality gate found unresolved work; exit 3 means a compatibility or worker
  handoff condition.
- Re-read state after every edit. Exit 0 proves the mutation committed, not that
  its visual timing or composition is correct; use list commands and `frames`,
  `broll preview`, or `animation preview` as appropriate.

## Capability preflight

```bash
"$BAOCUT_SKILL_ROOT/bin/baocut" --json spec
"$BAOCUT_SKILL_ROOT/bin/baocut" doctor --quick --json
```

Complete the mandatory startup version gate before running this preflight.

Do not treat a `missing` ffmpeg/ffprobe in the doctor report as a blocker and
do not preinstall them. They are on-demand, task-level dependencies: common
workflows (transcription, waveforms, single continuous main-media export) run
without them, and the tasks that do need them (URL download merging, complex
timeline flattening, BCF video encoding) fail at the point of use with a clear
error — install only when such a task actually asks for it.

In a development checkout, long local `transcribe` and `auto` commands require
an optimized CLI. When only a debug build is current, the resolver runs
`scripts/dev/prepare-bcut.sh` before continuing instead of silently accepting
roughly 2x slower inference. Set `BAOCUT_ALLOW_DEBUG_INFERENCE=1` only for an
intentional debugger/profiler run. For an Agent-backed AI pipeline, pass
`--llm agent` explicitly; this prevents a stale `BCUT_LLM_DEFAULT` from
silently selecting a provider that has no usable key.

When the resolver reports a version or handshake problem, follow
[references/updates.md](references/updates.md) and do not bypass the refreshed
CLI handshake.

Use `spec` as the machine-readable source of supported commands and flags. Keep
project paths quoted and use BCP-47 language tags such as `zh-Hans`, `en`, or
`ja`. This skill requires CLI spec `>=1.11,<2.0`; if a recipe and `spec` differ,
stop and follow the compatibility error rather than guessing.
