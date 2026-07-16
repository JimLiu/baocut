# Command usage: `auto` knobs, single stages, JSON envelope

Read this before composing any non-default command line. `baocut <cmd> --help`
is authoritative when a flag here looks stale.

## `auto` knobs

The positional accepts a local media file or any yt-dlp-supported URL (M78) —
the video downloads first ("Fetching video" phase), lands in `~/Downloads`
named after its title (`--save-dir` overrides), and the project auto-seeds
title/desc from the video metadata. URL sources need `yt-dlp` on PATH
(`brew install yt-dlp`); a bad URL fails fast (metadata is probed before
anything persists).

- `--source-lang X` — transcription language (see language flags below).
- `--model qwen3-asr-0.6b` — ASR model (policy in transcript-quality.md).
- `--title X` · `--desc "…"` · `--instructions "…"` · `--tone formal` —
  grounding context for every LLM stage (see metadata.md).
- `--speakers N` / `--no-speakers` — diarization control.
- `--no-polish` · `--no-autocorrect`.
- `--save-dir <dir>` — where a URL download lands.
- `--align-batch N` · `--align-concurrency N` — see worker-pool sizing below.
- `--second-look semantic|targeted|retranslated|off` — `semantic` is the
  default: only rewrites declaring mistranslation/omission are re-checked;
  `targeted` restores the legacy every-rewrite + risky-recut audit; use `off`
  only for an explicitly latency-first run.
- `--align-fit 8-32` — one-line capacity that triggers Phase-2 splitting;
  default derives from the project's bilingual subtitle style — 16 for CJK
  (semantics in alignment.md).
- `--align-local` — accept clean deterministic drafts with zero agent calls;
  problem/risky drafts still get reviewed.
- `--no-merged-stages` — M102: force separate analysis/brief calls even on a
  single-page document; by default a short doc folds analysis into the polish
  call and brief into the translate call, two fewer serial round-trips.
- `--line-length short|standard|long|16-200` — display-width budget 32/42/56;
  also on `task start`.
- `--reply-timeout S` — max wait per model answer, default 1800.
- `--page-budget N` — experimental page size in chars, ≥ 500.

## Language flags & JSON envelope (M78)

- `--lang` is always the TRANSLATE TARGET; the source language is
  `--source-lang` (transcribe/auto/project edit). This holds everywhere.
- Every `--json` result carries a string `status` — `"ok"`, `"error"`,
  `"rejected"` (submit lint), or a richer state
  (`"prompt"`/`"claimed"`/`"done"`/`"stalled"`…); action results reference
  their project as `projectId` (the old `"ok": true/false` booleans and
  bare-`id` keys are gone).
- Core workflow and mutating commands reject unknown, duplicated,
  missing-value, and extra positional arguments; treat any such error as a
  command bug to fix, never as a warning that can be ignored.

## Worker-pool sizing & align packing

Start 3 persistent answer workers and normally leave the CLI's four-way align
packing at its default (drive strategy in orchestration.md).
`--align-concurrency` also changes request packing: forcing it to 3 creates
fewer but larger prompts, which measured slower on the same-video benchmark
because model tail latency dominated the brief fourth-request queue. Override
it to 1 for a single-worker recovery, or match a larger pool only when those
workers really exist. Align wave packing additionally self-clamps to the
worker pool actually observed on the task (M101), so a short single-wave video
no longer serializes a fourth request behind 3 workers.

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

## Misc

- Older projects can be back-filled with the M56 CJK autocorrect pass:
  `baocut autocorrect <pid>|--all [--dry-run]` (each changed project gets a
  restorable "Autocorrect" version snapshot).
- Watch a long run instead of polling: `baocut task watch <taskId> [--jsonl]`
  streams one compact, independently parseable JSON object per state change
  until terminal.
