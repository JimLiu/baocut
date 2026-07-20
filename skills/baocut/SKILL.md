---
name: baocut
version: 0.5.1
minAppVersion: 0.3.2
description: >-
  Drive BaoCut from the CLI to transcribe local media or supported media URLs,
  including podcast and generic HTML5 audio pages, while preserving useful
  source-page metadata and show notes with the project,
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

**Version compatibility.** The frontmatter pins this skill's `version` and the
oldest app it needs (`minAppVersion`); the wrapper passes both to the CLI,
which enforces the contract and stops with exit 3 + a printed update
instruction when either side is too old (`--help`/`--version` always run).
Relay that instruction — don't route around it; the exact recipes are in
known-errors.md.

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
| URL / HTML5 media-page metadata | inspect page → `auto <url>` → `project edit --notes` | url-metadata.md |
| 剪口播 / rough cut / B-roll | `cut detect` · `task start cleanup\|broll` | editing.md |
| Fix transcript or caption text | `subtitle find/set/replace` · `terms fix` | subtitles.md, transcript-quality.md |
| Fix line splits / re-align | `align list` · `task start align` | alignment.md |
| Speaker review / naming | `speakers show/view/…` | speakers.md |
| Re-run one stage, staleness | `task start <flow>` · `version list` | versions.md |
| Deliver SRT/VTT/ASS/MD/video | `export <pid> --…` | export.md |
| Anything errored or stuck | `doctor` · `task status/log` · `project repair` | known-errors.md, recovery.md |

**Read the reference for the part of the job you're doing** (same directory):
- [references/orchestration.md](references/orchestration.md) — the answer-worker
  pool (claim → answer → submit --next), contracts table, model tiering,
  liveness, prompt-caching economics. **Read this before driving any
  `auto` / `task start` run.**
- [references/commands.md](references/commands.md) — the full `auto` knob list,
  language-flag + JSON-envelope rules (M78), worker-pool/align-packing sizing,
  single-stage details (chapters, re-transcribe, autocorrect, `task watch`).
  **Read before composing any non-default command line.**
- [references/editing.md](references/editing.md) — talking-head video editing:
  the cleanup decision rules (fillers/retakes/pauses), cut review, the
  cleanup/broll LLM stages, B-roll sourcing & placement, edit verification.
  **Read this before any 剪口播 / rough-cut / B-roll job.**
- [references/transcript-quality.md](references/transcript-quality.md) — ASR
  model policy, Agent-driven polish, `PolishQuality`, term locking/fixing,
  Speaker routing and cleanup levels. **Read before promising corrected
  captions or rough cuts.**
- [references/alignment.md](references/alignment.md) — the two-phase
  translation model, fit/aim budgets, the targeted re-align loop
  (`align list` → `--groups`), `--from current|pristine`, repeat-align policy.
  **Read before any align / line-splitting work.**
- [references/subtitles.md](references/subtitles.md) — inspect/correct original
  cue or translated group text, cue-id reindexing/staleness, and reversible
  subtitle-only hide/restore (distinct from AV cuts).
- [references/speakers.md](references/speakers.md) — reviewing & fixing speaker
  identification, naming speakers, the evidence loop (show / view / frames).
- [references/versions.md](references/versions.md) — staleness, incremental
  re-translate, branches, benchmark cloning.
- [references/metadata.md](references/metadata.md) — resolving projects from
  natural language (`project search`), title/desc/notes grounding + backfill,
  speaker naming.
- [references/url-metadata.md](references/url-metadata.md) — URL preflight and
  persistence for podcast, article-hosted, generic, and HTML5 audio/video
  pages. **Read this before starting any URL run whose media is embedded in a
  webpage, especially a generic/HTML5 yt-dlp fallback.**
- [references/export.md](references/export.md) — SRT/VTT/ASS/markdown/video
  export, bilingual modes, time-range clipping.
- [references/recovery.md](references/recovery.md) — diagnostics (`task log` /
  `calls` / `report` / `audit`), the one-repair budget, audit-code → fix table,
  stalled workers, orphan projects, postmortems.
- [references/known-errors.md](references/known-errors.md) — literal error →
  cause → exact recovery recipes. **Check here FIRST when any command errors**,
  before improvising a workaround.
- [references/content-summary.md](references/content-summary.md) — how to write
  the viewer-first completion summary. **Read right before writing one.**

A plain local-file transcription/translation run needs ONLY orchestration.md
(plus commands.md if you deviate from defaults). A URL run also needs
url-metadata.md before `auto`; don't read the speaker/version/export docs until
the task actually calls for them.

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
  layout findings do NOT block Project completion. An audit FAIL is evidence,
  not a claim that the whole result is unusable: quote the exact count and
  bounded samples. When a user has inspected those disclosed findings and
  explicitly accepts them, mark Project mode complete **with known findings**;
  do not pretend the audit passed, auto-repair, or roll back an accepted result.
  That acceptance applies only to Project/Markdown use and does not silently
  waive a later timed-delivery gate. Report the project id, languages, and
  quality summary, then ask whether the user wants to open it or export
  SRT/VTT/ASS/Markdown/video. **STOP that turn.** Before their answer, do not
  run `finish-check`, export, start another task, or repair a presentation-only
  finding. If they answer "open", run
  `open 'baocut://project/<pid>'`; do not merely print the URL. If macOS reports
  that no app handles the URL, fall back to `baocut project open <pid>`.
- **Document export:** an explicit Markdown request uses the same content gate
  as Project mode, then writes only the requested document. Timed presentation
  findings do not block Markdown.
- **Timed delivery:** an explicit SRT/VTT/ASS, caption burn-in, final video, or
  other ready-to-use timed subtitle ask requires the full strict `audit` plus a
  parsed `finish-check` verdict before export. Read export.md and recovery.md;
  here presentation findings are blockers.
- **Talking-head editing:** keep the rough-cut and layering checkpoints in
  editing.md; an edit request does not inherit Project mode's early stop when
  the user explicitly asked for an end-to-end deliverable.

Audit categories and the bounded recovery policy live in recovery.md. A
post-terminal repair may use at most ONE targeted repair workflow / Agent task,
followed by ONE re-audit. Never recursively execute `finish-check.next[]`.

**Finish with a copyable viewer-first media card.** At every TERMINAL user-facing
report of a video/media task that produced usable spoken or on-screen content,
include the card even when the quality verdict is WARN, FAIL, needs review, or
blocked. Quality facts stay outside the card. Omit it only for non-terminal
progress, a run that produced no usable content, or BaoCut code-maintenance
reports. The fenced `markdown` block contains useful verified media metadata
and a brief 3–5-paragraph content summary in the user's language, after the
delivery/quality facts and before the next-step question. Read
content-summary.md right before writing it — it defines the sourcing rules,
metadata fields, exact output shape, and style.

## Quick start: one command, one loop

```bash
# Transcribe → polish → translate a media file behind ONE task:
baocut --json auto talk.mp4 --lang zh    # -> {"taskId":"t-…","projectId":"p7"}
# The positional also takes any yt-dlp-supported URL (M78):
baocut --json auto "https://www.youtube.com/watch?v=…" --lang zh
```

**Webpage-backed URL rule:** before `auto`, inspect the extractor metadata. If
yt-dlp reports `html5` / `HTML5MediaEmbed` / a generic fallback, or returns
missing, truncated, entity-encoded, or suspicious fields, read the rendered
source page itself. Pass the verified title and concise description into
`auto`, retain a structured page-facts draft in a temp file, and save it to the
project's searchable `notes` field at terminal. Never treat the fetch timestamp
as the publication date or silently discard an explicit episode timeline. The
exact field map and verification gate are in url-metadata.md.

Common knobs: `--source-lang X` · `--title X --desc "…"` · `--instructions` ·
`--speakers N` / `--no-speakers` · `--no-polish` · `--lang` is always the
TRANSLATE TARGET. The full knob list (align fit/packing, `--second-look`,
merged stages, timeouts, URL/yt-dlp details) and the JSON-envelope rules are
in commands.md. Every `--json` result carries a string `status`; mutating
commands reject malformed arguments — treat such an error as a command bug to
fix, never as a warning to ignore.

**Confirmed single-speaker subtitle-only ask? Skip diarization.** Speaker
identification is ON by default and costs ~4-5 minutes of local compute; pass
`--no-speakers` only when the user wants just subtitles/translation of a
single-speaker recording. Never use this shortcut for rough-cut, interview,
podcast, dialogue, or other multi-person work; it can always be added later
(`speakers reidentify`, see speakers.md).

**Start 3 persistent answer workers and leave the CLI's align packing at its
default** (sizing rationale and overrides in commands.md; drive strategy in
orchestration.md). Start the pool immediately after `auto` returns —
`task claim --timeout` safely waits through local transcription, so the first
analysis call no longer pays agent spin-up:

```bash
# workers: baocut --json task claim <taskId> --worker w1 --timeout 240
#          … answer … task submit <taskId> --call <id> --lease-id <leaseId> --file a.json --next --timeout 240
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
checkpoint its own turn) unless they asked for end-to-end. Cuts are SOFT
(skipped at playback, filtered at export; `--include-cuts` exports the raw
recording). Translation still covers cut words (cuts are AV-level) — cut
before translating if you want the token savings to matter to the user, not
the pipeline. Never surface word ids / cut ids / clip ids to the user — quote
the spoken content instead. The full decision rules, command sequence, review
loop, and B-roll workflow are in editing.md.

## Single stages

```bash
baocut --json transcribe <file|url|--project p7>   # no LLM; details in commands.md
baocut --json task start segment|polish|translate|align|chapters <pid> [--lang zh --stale-only …]
```

`transcribe --model` accepts local ids AND cloud stt ids (Volcano, ElevenLabs,
DashScope, OpenAI, custom — `baocut model list` shows connected state; keys
come from the app or `BAOCUT_API_KEY_<PROVIDERID>`). Cloud runs upload the
audio and poll — no live transcript stream; details in transcript-quality.md.

`task start` spawns the same kind of worker — same claim/submit loop.
`translate` runs + APPLIES polish first by default (skip: `--no-polish`) —
unless the transcript has manual edits since transcription (M107): then the
default flips to translating the edits as-is, with no chained re-segmentation
(`--polish` forces the full prerequisite anyway).
`--stale-only` refreshes only out-of-date paragraphs (versions.md).

Translation runs as two phases — whole-sentence translating, then splitting &
aligning ONLY over-fit sentences; the `align` flow (M68) redoes only Phase 2.
The budgets, `align list` → `--groups` targeted loop, and `--from` semantics
are in alignment.md. One rule worth stating here: **repeat align runs must be
`--groups`-targeted** — a full re-align costs the same as the original phase
and does not converge the over-fit residual.

## Quality gate & targeted repairs (M81)

Before a timed delivery, run the read-only gates:

```bash
baocut --json audit <pid> [--lang zh]          # subtitle quality/invariants; exit 2 on FAIL
baocut --json finish-check <pid> --for srt [--lang zh] [--strict]
                                               # ONE verdict: {ready, blockers, warnings, next}
```

`task report` measures performance; `audit` measures content quality.
`finish-check` aggregates status + audit + polishQuality + attention + the
selected export's preconditions; it exits 0 by default for polling — parse
`ready`; only `finish-check … --strict && export` is a real shell gate. For a
corrected transcript also require `polishQuality.status == PASS` (WARN means
the terms are re-polishable without a full rerun — transcript-quality.md).

When a mode-blocking finding has a supported local fix, spend the single
repair budget on that exact problem — never re-run the whole stage. In Project
mode, disclose bounded findings before mutation when human review can decide
whether they matter; an informed user acceptance ends the repair path. Do not
bundle several unrelated deterministic edits plus an Agent task and call them
one repair: mixed blocker classes without one supported action must be reported
before mutation. `next[]` is advisory: record the current version, run at most
ONE targeted action, re-audit once, then stop and ask if the blocker remains.
The audit-code → fix
table (`terms fix --map`, `task start polish --from-audit`, `timing repair`,
`speakers propose-names`, …) and the full budget policy live in recovery.md
and transcript-quality.md. Do not re-segment an already translated project,
run a full re-translation, or repeat `align` merely to clear flash/CPS/width
warnings without explicit user approval. In Project mode, presentation-only
findings consume NO repair budget: leave them for a later export request.

## Project metadata: title, description, notes, speaker names

When no exact project ID is supplied, resolve it first with
`baocut --json project search "<keyword>"` (matches metadata, transcript,
translations, chapters, speakers) and use the returned `projectId` everywhere;
keep title and ID together in user-visible prompts. Title + description ride
into EVERY LLM stage as grounding context, while searchable `notes` preserve
source-page facts, timelines, and useful links beside the transcript. Keep all
three real: pass `--title`/`--desc` up front when you know the content, act on
`project show` `attention` hints, and backfill with `project edit` (on an
existing project BEFORE `task start`; after an `auto` run at terminal). For a
webpage URL, follow url-metadata.md and verify `project show` returns the
canonical `url`, extracted `notes`, title, and description before auditing.
**Speaker naming rides the default flow:** diarization is on by default, and
"who the speakers are" is part of the analysis deliverable. At terminal, run
`speakers show <pid>` whenever speaker identification ran — do not rely on
`project show.attention` to reveal placeholders. For every "Speaker N", read
the URL metadata and adjacent same-speaker self-intro cues, then run
`speakers propose-names <pid>`. That command is heuristic and never applies a
rename; an empty candidate list is NOT evidence that the speaker is unknown.
Batch-rename a high-confidence identity supported by metadata plus transcript
or direct self-identification, including an introduction split across adjacent
cues, then re-run `speakers show` to verify. Finish this naming pass before the
quality/audit boundary, even if the result later needs review. Best-effort,
never a gate: leave genuinely ambiguous voices as placeholders and say so. The
full workflow is in metadata.md and speakers.md.

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
