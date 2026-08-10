---
name: baocut
description: Drive BaoCut's local CLI for transcription, subtitle and timeline editing, source cuts, clip arrangement, overlays, B-roll, watermarks, animation, on-screen-text translation, review, quality checks, rendered output, and editable projects for CapCut, Premiere Pro, DaVinci Resolve, Final Cut Pro, Shotcut, or Kdenlive. Use whenever the user asks to operate a .bcut project or produce these BaoCut deliverables.
metadata:
  version: "1.0.4"
  minAppVersion: "1.0.4"
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
`<version>-build.<build>` CLIs newest-first and compatibility-checks them
locally. Only when no compatible cache exists does it find
the newest stable `baocut-v<version>-build.<build>` GitHub Release that includes
`windows-cli-release.json`, downloads its x64 Windows archive, verifies the
manifest-pinned SHA-256, and caches `bcut.exe` under
`%LOCALAPPDATA%\BaoCut\cli\<version>-build.<build>\bcut.exe`. The Windows
archive is currently an unsigned preview, so SmartScreen, Smart App Control,
or enterprise policy may warn about or block it; SHA-256 proves download
integrity, not publisher identity.

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

- For transcription and translation, create the project in the shared
  projects library first, start the preview server, then run the pipeline;
  read [references/workflows.md](references/workflows.md).
- For a complete local pipeline, use `auto`; read
  [references/workflows.md](references/workflows.md).
- For an Agent-backed AI stage with pending calls, immediately read and follow
  [references/agent-tasks.md](references/agent-tasks.md). Its worker-pool and
  consolidated-repair rules are execution requirements, not optional tuning.
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
  shared `download.dir` setting and falls back to `<project>/media` only when
  that setting is absent.
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

In a development checkout, do not start a long local transcription while the
resolver warns that it selected a debug build. Run
`scripts/dev/prepare-bcut.sh` once, then repeat the preflight so the release
binary is selected. For an Agent-backed AI pipeline, pass `--llm agent`
explicitly; this prevents a stale `BCUT_LLM_DEFAULT` from silently selecting a
provider that has no usable key.

When the resolver reports a version or handshake problem, or the user asks
about updates, follow [references/updates.md](references/updates.md). That
check is advisory and never blocks the requested work.

Use `spec` as the machine-readable source of supported commands and flags. Keep
project paths quoted and use BCP-47 language tags such as `zh-Hans`, `en`, or
`ja`. This skill requires CLI spec `>=1.11,<2.0`; if a recipe and `spec` differ,
stop and follow the compatibility error rather than guessing.
