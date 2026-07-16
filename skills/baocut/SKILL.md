---
name: baocut
version: 0.3.0
minAppVersion: 0.3.0
description: >-
  Drive BaoCut from the CLI to transcribe local media or supported video URLs,
  polish transcripts through Agent workers, create/translate subtitles, review
  speaker diarization, edit one talking-head source with reversible pause/filler/
  retake cuts and B-roll attachments, and export SRT/VTT/ASS/Markdown/video.
  Use for transcription, captions, subtitle correction/translation, speaker
  identification, talking-head cleanup, rough cuts, B-roll and final export,
  including Chinese requests such as 转写、加字幕、改字幕、翻译字幕、识别说话人、
  剪口播、去口癖、删停顿、粗剪、加 B-roll、导出成片，and whenever working in
  the BaoCut repository. Not for motion graphics, music, multicam, generated
  video or arbitrary multitrack compositing. The CLI never calls an LLM API;
  persistent Agent workers answer its claim/submit task protocol.
---

# BaoCut CLI

Drive the BaoCut transcription/subtitle pipeline headlessly. The binary is
`baocut`, from the BaoCut macOS app: run the `baocut` the app puts on your PATH,
or the full path `/Applications/BaoCut.app/Contents/MacOS/baocut-cli` (this skill
also ships `bin/baocut`, which resolves that path and checks the app is installed).
Every command supports `--help`; add `--json` (global, before the command)
whenever you parse output — always do when scripting.

**Requirements — macOS + the BaoCut app.** This skill only runs on macOS and
drives the BaoCut app's bundled CLI. If `baocut` is not found, or a command
reports the app is missing, tell the user to install BaoCut for Mac from
https://baocut.app — the skill cannot run without it.

**Version compatibility.** The frontmatter above pins this skill's `version` and
the oldest BaoCut app it needs (`minAppVersion`). When you run `baocut` through
this skill's wrapper it passes both to the CLI, which enforces the contract:
- app older than `minAppVersion` → the CLI stops (exit 3) and asks the user to
  update BaoCut at https://baocut.app — this is a **required** app upgrade;
- this skill older than the CLI supports → the CLI stops (exit 3) and asks the
  user to update the global skill: `npx skills add JimLiu/baocut -g -a claude-code codex -y`;
- a newer skill or app merely available → a one-line stderr note, work continues.

`--help` and `--version` always run so you can diagnose. If you hit an exit-3
version block, relay the printed instruction — don't route around it.

You are the **orchestrator**. The LLM pipeline stages (segment / polish /
repunct / translate / align) run inside a background worker process that asks
YOU for each model answer. Never read prompt or answer text into your own
context — prompt bodies live in files; you pass file paths around.

The main pipeline, end to end:

```
transcribe → polish → translate → align → (cuts / B-roll) → export
└────────── one `auto` task ──────────┘
```

Route by job — entry command and the reference to read first:

| Job | Entry command | Read first |
|---|---|---|
| Transcribe / translate / captions | `auto <file\|url> [--lang zh]` | orchestration.md |
| 剪口播 / rough cut / B-roll | `cut detect` · `task start cleanup\|broll` | editing.md |
| Fix transcript or caption text | `subtitle find/set/replace` · `terms fix` | subtitles.md, transcript-quality.md |
| Speaker review / naming | `speakers show/view/…` | speakers.md |
| Re-run one stage, staleness | `task start <flow>` · `version list` | versions.md |
| Deliver SRT/VTT/ASS/MD/video | `export <pid> --…` | export.md |
| Anything errored or stuck | `doctor` · `task status/log` · `project repair` | known-errors.md, recovery.md |

**Read the reference for the part of the job you're doing** (same directory):
- [references/orchestration.md](references/orchestration.md) — the answer-worker
  pool (claim → answer → submit --next), contracts table, model tiering,
  liveness, prompt-caching economics. **Read this before driving any
  `auto` / `task start` run.**
- [references/editing.md](references/editing.md) — talking-head video editing:
  the cleanup decision rules (fillers/retakes/pauses), cut review, the
  cleanup/broll LLM stages, B-roll sourcing & placement, edit verification.
  **Read this before any 剪口播 / rough-cut / B-roll job.**
- [references/transcript-quality.md](references/transcript-quality.md) — ASR
  model policy, Agent-driven polish, `PolishQuality`, Speaker routing and
  cleanup levels. **Read before promising corrected captions or rough cuts.**
- [references/subtitles.md](references/subtitles.md) — inspect/correct original
  cue or translated group text, cue-id reindexing/staleness, and reversible
  subtitle-only hide/restore (distinct from AV cuts).
- [references/speakers.md](references/speakers.md) — reviewing & fixing speaker
  identification, naming speakers, the evidence loop (show / view / frames).
- [references/versions.md](references/versions.md) — staleness, incremental
  re-translate, branches.
- [references/export.md](references/export.md) — SRT/VTT/ASS/markdown/video
  export, bilingual modes, time-range clipping.
- [references/recovery.md](references/recovery.md) — diagnostics (`task log` /
  `calls` / `report` / `audit`), stalled workers, orphan projects, postmortems.
- [references/known-errors.md](references/known-errors.md) — literal error →
  cause → exact recovery recipes. **Check here FIRST when any command errors**,
  before improvising a workaround.

A plain transcription/translation run needs ONLY orchestration.md — don't read
the speaker/version/export docs until the task actually calls for them.

## Choose the completion mode first

Classify the user's requested deliverable BEFORE starting. Do not infer a timed
subtitle export from the words "transcribe" or "translate":

- **Project mode (the default):** a request that only asks to transcribe,
  polish, correct, or translate is complete when the result is safely stored in
  the BaoCut Project. At terminal, run `task report`, `project show`, and ONE
  read-only `audit` for content/structure evidence. Require source fidelity,
  translation coverage/staleness/stamps, locked terms, pins, and core word
  timing to be sound; `polishQuality` must PASS when polished/corrected text was
  promised. Source/target flash, CPS, wrapping, line-width, and other delivery
  layout findings do NOT block Project completion. Report the project id,
  languages, and quality summary, then ask whether the user wants to open it or
  export SRT/VTT/ASS/Markdown/video. **STOP that turn.** Before their answer,
  do not run `finish-check`, export, start another task, or repair a
  presentation-only finding.
- **Document export:** an explicit Markdown request uses the same content gate
  as Project mode, then writes only the requested document. Timed presentation
  findings do not block Markdown.
- **Timed delivery:** an explicit SRT/VTT/ASS, caption burn-in, final video, or
  other ready-to-use timed subtitle ask requires the full strict `audit` plus a
  parsed `finish-check` verdict before export. Read export.md and recovery.md;
  here presentation findings are blockers.
- **Talking-head editing:** keep the rough-cut and layering checkpoints below;
  an edit request does not inherit Project mode's early stop when the user
  explicitly asked for an end-to-end deliverable.

Audit categories and the bounded recovery policy live in recovery.md. A
post-terminal repair may use at most ONE targeted repair workflow / Agent task,
followed by ONE re-audit. Never recursively execute `finish-check.next[]`.

## Quick start: one command, one loop

```bash
# Transcribe → polish → translate a media file behind ONE task:
baocut --json auto talk.mp4 --lang zh    # -> {"taskId":"t-…","projectId":"p7"}
# The positional also takes any yt-dlp-supported URL (M78) — the video
# downloads first ("Fetching video" phase), lands in ~/Downloads named after
# its title (--save-dir overrides), and the project auto-seeds title/desc
# from the video metadata:
baocut --json auto "https://www.youtube.com/watch?v=…" --lang zh
```

URL sources need `yt-dlp` on PATH (`brew install yt-dlp`); a bad URL fails
fast (metadata is probed before anything persists). Common knobs (details in
`baocut auto --help`): `--source-lang X` ·
`--model qwen3-asr-0.6b` · `--title X` · `--desc "…"` · `--instructions "…"` · `--tone formal` ·
`--speakers N` / `--no-speakers` · `--no-polish` · `--no-autocorrect` ·
`--save-dir <dir>` · `--align-batch N` · `--align-concurrency N` ·
`--second-look semantic|targeted|retranslated|off` (`semantic` is the default:
only rewrites declaring mistranslation/omission are re-checked; `targeted`
restores the legacy every-rewrite + risky-recut audit; use `off` only for an
explicitly latency-first run) ·
`--align-fit 8-32` (one-line capacity that triggers Phase-2 splitting; default
derives from the project's bilingual subtitle style — 16 for CJK) ·
`--align-local` (accept clean deterministic drafts with zero agent calls;
problem/risky drafts still get reviewed) ·
`--line-length short|standard|long|16-200` (display-width budget 32/42/56; also
on `task start`) · `--reply-timeout S` (max wait per model answer, default
1800) · `--page-budget N` (experimental page size in chars, ≥ 500).

**Language flags (M78, everywhere):** `--lang` is always the TRANSLATE TARGET;
the source language is `--source-lang` (transcribe/auto/project edit).
**JSON envelope (M78):** every `--json` result carries a string `status` —
`"ok"`, `"error"`, `"rejected"` (submit lint), or a richer state
(`"prompt"`/`"claimed"`/`"done"`/`"stalled"`…); action results reference their
project as `projectId` (the old `"ok": true/false` booleans and bare-`id` keys
are gone). Core workflow and mutating commands reject unknown, duplicated,
missing-value, and extra positional arguments; treat any such error as a command
bug to fix, never as a warning that can be ignored.

**Confirmed single-speaker subtitle-only ask? Skip diarization.** Speaker identification is ON by
default and costs ~4-5 minutes of local compute. When the user only wants
subtitles/translation, the recording is single-speaker, and speaker boundaries
are irrelevant, pass `--no-speakers`. Never use this shortcut for rough-cut,
interview, podcast, dialogue, or other multi-person work;
it can always be added later (`speakers reidentify`, see speakers.md).

**Start 3 persistent answer workers and normally leave the CLI's four-way
align packing at its default** (see orchestration.md). `--align-concurrency`
also changes request packing: forcing it to 3 creates fewer but larger prompts,
which measured slower on the same-video benchmark because model tail latency
dominated the brief fourth-request queue. Override it to 1 for a single-worker
recovery, or match a larger pool only when those workers really exist.

Then drive it (full strategy in orchestration.md). Start the persistent pool
immediately after `auto` returns — `task claim --timeout` safely waits through
local transcription, so the first analysis call no longer pays agent spin-up:

```bash
# workers: baocut --json task claim <taskId> --worker w1
#          … answer … task submit <taskId> --call <id> --lease-id <leaseId> --file a.json --next
# root: baocut --json task status <taskId>  # observe waitingOn + queue ownership
```

`task wait` / `task claim` return `status` = `prompt`/`claimed` (work to do) or
`done` · `review` (`--no-apply` runs: `task review` then `task apply`) ·
`stalled` (worker died: `task resume <taskId>`) · `failed` (read
`task log <taskId>`). The `transcribe` phase of `auto` emits progress only —
no prompts until the first LLM stage.

## Talking-head edit (口播剪辑) — M79/M80

Two iron rules: **A-roll timing finalizes before any visual layer or caption
burn-in**, and **confirm the rough cut with the user before layering** (each
checkpoint its own turn) unless they asked for end-to-end. Full decision rules
in editing.md.

```bash
# Quality-first: finalize Agent polish before changing A-roll timing.
baocut --json auto talk.mp4                             # qwen3-asr-0.6b → Agent polish
baocut --json task report <taskId>
baocut --json audit p7                                  # polishQuality must PASS
baocut --json task start cleanup p7 --cleanup-level standard
# latency-first one-task shortcut remains available: auto talk.mp4 --rough-cut
baocut --json cut list p7                 # review — soft cuts, fully reversible
baocut --json cut restore p7 clip-12      # disagree with one? restore it (--all resets)
baocut --json audit p7                    # edits section must be clean
# optional B-roll: suggest → source footage YOURSELF → attach → verify
baocut --json task start broll p7
baocut --json broll add p7 --file shot.png --suggestion bs1
baocut --json broll preview p7 --at 63    # composite proof BEFORE reporting placed
baocut export p7 --video --output final.mp4  # cuts + B-roll apply by default
```

Cuts are SOFT (skipped at playback, filtered at export; `--include-cuts`
exports the raw recording). Translation still covers cut words (cuts are
AV-level) — cut before translating if you want the token savings to matter to
the user, not the pipeline. Never surface word ids / cut ids / clip ids to
the user — quote the spoken content instead.

## Single stages

```bash
baocut --json transcribe talk.mp4          # -> {projectId} (no LLM)
baocut --json transcribe "https://youtu.be/…" --no-speakers   # URL works here too
baocut --json transcribe --project p7      # re-transcribe from the project's own source
                                             # (REBUILDS the doc; auto-forks a branch;
                                             # a URL project re-downloads if its file is gone)
baocut --json task start segment|polish|translate|align <pid> [--lang zh --stale-only …]
baocut --json task start chapters <pid> [--target N] [--title-style short|descriptive|keywords]
```

`task start` spawns the same kind of worker — same claim/submit loop.
`translate` runs + APPLIES polish first by default (skip: `--no-polish`);
`--stale-only` refreshes only out-of-date paragraphs (versions.md).
`chapters` generates/replaces chapter titles (an unsegmented doc runs the
segment stage first); a later re-polish flips a non-blocking `chapters-stale`
attention hint — re-run the flow to refresh titles.

Translation runs as TWO big phases: **Translating** (whole natural sentences,
1:1 source↔translation, natural target word order — long sentences allowed)
then **Splitting & aligning** (ONLY sentences over the one-line **fit**
capacity are split & re-aligned; a fitting sentence stays whole even when its
source spans several cues — many-to-one is the native model). Phase-2 budgets
ride every align payload as `budgets: {s, t, f}` — `f` = fit (one-line trigger,
default 16 for CJK, style-derived, `--align-fit` overrides; measured on the
delivery projection, so halfwidth Latin glyphs weigh half a cell and projected
punctuation weighs nothing — a mixed-script line can hold more raw characters
than `f` and still fit), `t` = the 14-char
aim per piece when splitting (soft: an aim-to-hard span may stay whole), 20 =
the hard ceiling (blocking). Reading speed (CPS) and aim-band width are
recorded as advisory during translate/align and gated at delivery by
`baocut audit` / `finish-check` — they never trigger align retries. The
`align` flow (M68) redoes ONLY Phase 2 against an existing translation — no
re-translation, only `align`-kind prompts:

```bash
baocut --json align list <pid> --lang zh [--fit 8-32]  # over-FIT lines (keys, seams, overHard, fitChars echoed)
baocut --json task start align <pid> --lang zh [--groups k1,k2] [--from current|pristine] \
    [--align-fit 8-32] [--align-local]
```

The efficient targeted loop: `align list` returns ONLY the over-fit sentences
(with seam previews and a ready-made `next` command); start the align task
scoped with `--groups`; several persistent workers claim/submit the pairs in
parallel; `task submit` lints each answer and the apply writes the results
back. `--align-local` lands clean deterministic drafts without any agent call
(drafts with measured problems or mechanically risky cuts still get one
review).

**Repeat align runs must be `--groups`-targeted.** A full re-align re-reviews
every over-fit sentence at the same cost as the original align phase and does
NOT converge the residual over-fit count (p809 A/B: 32 calls again, quality
statistically unchanged, over-fit residual wobbled 59→69) — most re-reviews
just confirm the existing cuts. Repeat the phase only scoped to the lines you
actually want changed, or with `--align-local` when presentation-metric drift
is acceptable (p809: −38% calls, −23% chars in; CPS/flash/term-neighbor counts
wobbled slightly upward).

`--groups` (keys from `align list`) scopes the redo to those lines. Keys are
first-word ids, so a re-align or edit that moves a boundary changes them; the
flow resolves such stale keys to the group that contains the word today (see
`log --kind align-diag` for the remaps) and fails only when the word id no
longer exists at all — re-run `align list` for fresh keys in that case.
`--from current` (default) re-aligns the doc's translations as they stand
(manual edits survive; untouched groups stay byte-identical), `--from pristine`
restores the last FULL translate's Phase-1 sentence texts from
`ai/sentences-<lang>.json` (whole language; fingerprint-gated — a re-polish or
edit invalidates it, fall back to `--from current`). Re-align never flips
staleness.

For repeatable polish/translation benchmarks, clone one immutable version into a
clean project instead of retranscribing or reusing a mutable AI cache — the full
recipe (controlled A/B, `project clone --from-version`) is in versions.md.

Older projects can be back-filled with the M56 CJK autocorrect pass:
`baocut autocorrect <pid>|--all [--dry-run]` (each changed project gets a
restorable "Autocorrect" version snapshot).

Before a timed delivery, run the read-only quality gate:
`baocut --json audit <pid> [--lang zh]`. `task report` measures performance;
`audit` measures subtitle quality/invariants — including source-content loss
and duplicate coverage against the current branch's transcription ancestor,
residual target fragments that can still be safely compacted, and over-aim
target groups that still have a natural balanced split —
and exits 2 on FAIL. For an A/B speed claim, follow the controlled comparison
checklist in orchestration.md — faster is never accepted by timing alone.
For a corrected transcript, also require `polishQuality.status == PASS`; WARN
means the terms are re-polishable WITHOUT a full rerun (see below).

## Fix problems without a full rerun (M81)

When a mode-blocking `audit`/`project show` problem has a supported local fix,
spend the single repair budget on that exact problem — don't re-run the whole
stage:

```bash
baocut --json finish-check <pid> --for srt [--lang zh] [--strict]
                                                # ONE verdict: {ready, blockers, warnings, next}
```

`finish-check` aggregates status + audit + polishQuality + attention + the
selected export's preconditions. It exits 0 by default for polling; parse its
`ready` field. `--strict` exits 2 when not ready, so only
`finish-check … --strict && export` is a real shell gate. Its `next[]` list is advisory:
select at most one targeted action, record the current version first, run it,
then re-audit once. If the blocker remains, keep the sound result and ask the
user how to proceed. Restore the recorded version only if content/coverage/
pins/timing regressed. Do not start a second repair task automatically.

- **Wrong ASR term** (克拉克→Claude Code, Grab→grep…): `baocut terms fix <pid>
  --map "克拉克=Claude Code,Grab=grep" [--dry-run]` rewrites the source in place
  (ids/timings preserved, integrity-gated) and LOCKS the terms. It changes the
  source, so re-align the translation: `task start translate <pid> --lang zh
  --stale-only`.
- **Lock terms up front**: `--terms-file <f>` on `transcribe`/`auto`/`task start
  polish|translate` — one line per term `canonical = variant1 | variant2`.
  Locked terms are authoritative (never respelled) and always residual-checked.
- **Residual after polish** (`polishQuality` WARN, `polish-residual-term`):
  `baocut task start polish <pid> --from-audit` re-polishes ONLY the affected
  paragraphs (also `--ranges w1-w2` / `--terms "v=c"`). Needs an already
  polished+segmented doc.
- **Zero-duration words** (`zero-duration-words`, `cleanup-filler-zero-duration`,
  `polish-introduced-zero-duration`): `baocut timing repair <pid> [--dry-run]`
  (or `--all`) re-fits unhealthy word timings; never marks anything stale.
- **Placeholder speaker names**: `baocut speakers propose-names <pid>` suggests
  names from self-intro/invitation cues + analysis entities (never auto-applies).
- **Watch a long run** instead of polling: `baocut task watch <taskId>
  [--jsonl]` streams one compact, independently parseable JSON object per state
  change until terminal.

Do not re-segment an already translated project, run a full re-translation, or
repeat `align` merely to clear flash/CPS/width warnings without explicit user
approval. In Project mode, presentation-only findings consume NO repair budget:
leave them for a later export request.

## Project metadata: title, description, speaker names

Find a project by metadata or reconstructed document text before inspecting it
(`baocut --json project list` enumerates every project when you just need ids):

```bash
baocut --json project search "launch plan"
baocut --json project search "Claude Code" --limit 20 --match-limit 5
```

Search is case-insensitive and literal, matching the GUI across project/source
metadata, transcript, every translation language, chapters, speakers, and
on-screen text. Results are ranked like the GUI and report `total` separately
from the bounded `returned` project/match rows. For find/replace inside one
project, read subtitles.md; never hand-edit or globally rewrite `doc.json`.

Title + description ride into EVERY LLM stage as grounding context
(`--no-media-context` opts out), so keep them real — **proactively**:

- Know the content up front (the user described it, a video title, …)? Pass
  `--title`/`--desc` on `auto`/`transcribe` so the run's OWN polish/translate
  already have the context.
- `--json project show <pid>` returns `attention` hints when metadata is
  missing: a filename-ish title, no description, or placeholder "Speaker N"
  names. Act on them, don't just relay them.
- Backfilling: read the transcript (`export --markdown`, or what you already
  saw answering the analysis call — its summary is a ready-made source), then
  `baocut project edit <pid> --title "…" --desc "…"`. The description is
  2–4 plain sentences on what the recording is about (people, products,
  topics) — background context, never copied into subtitles. On an EXISTING
  project do this BEFORE `task start polish|translate`; after an `auto` run
  do it at terminal (the worker holds the project lock while running, so
  metadata edits must wait).
- Name the speakers the content identifies — batch form, one save:
  `baocut speakers rename <pid> s1="Ada Lovelace" s2=Host`. Only
  high-confidence names; evidence rules in speakers.md.

## Ground rules

- **A successful submit/exit-0 is not verification.** Re-read the evidence for
  the chosen completion mode. Project/Markdown mode uses `project show` plus
  one `audit`, while timed delivery additionally parses `finish-check.ready`
  and may re-parse the exported sidecar. `audit` exit 2 can be presentation-only
  and therefore non-blocking in Project mode; inspect the failing sections.
  Report what the evidence shows, not only what the commands returned.
- **Pipeline verification vs formal edit.** A benchmark may run its declared
  acceptance gate autonomously, but a bare transcription/translation stops at
  Project completion and must NOT export or chase presentation findings. A
  formal talking-head edit still stops after the rough cut for a human
  checkpoint (see editing.md) unless the user asked for end-to-end.
- **Polish is CLI-orchestrated Agent work.** Never hand-edit `doc.json`, apply
  global search/replace, or treat ASR output as polished. Analysis/polish/
  repunct calls must be drained through `task claim` + `task submit --next`.
- **Write your answer/scratch files to a temp directory** (e.g. `$TMPDIR` or a
  dedicated scratch dir), NEVER the repo/cwd — `task submit --file` takes any
  path, and stray `*.json` drafts in a repo root end up in commits.
- **Destructive project deletion is explicit:** only run `baocut project delete
  <pid> --yes` when the user actually requested permanent deletion.
- The BaoCut GUI may stay open — never ask the user to close it; it picks up
  CLI writes live, and the worker streams phase/progress into it (M58), so a
  stalled run is user-visible. Keep workers fed; `task resume` promptly.
- One mutating run per project: a transcribe/worker holds a project-level
  lock; a second run on the SAME project fails with "project … is busy".
- Reading files under `~/Library/Application Support/BaoCut/` is always
  safe; never WRITE there while the app or a worker runs.
- Expect the saved doc's punctuation/spacing to differ slightly from your
  submitted answers on CJK projects — that's the M56 autocorrect normalizer,
  not a lint failure.
- If your environment needs authorization to spawn parallel subagents, ask
  ONCE up front, not per batch. Do not drain a media pipeline inline in the
  orchestrator: prompt/answer history accumulates across stages and large align
  payloads can exhaust the orchestrator's context. When parallel workers are
  unavailable, request authorization for ONE lean persistent answer worker and
  set `--align-concurrency 1`; if delegation is unavailable, pause before the
  LLM stages instead of loading their prompt files into the root context.
