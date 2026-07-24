# Translation alignment: fit budgets, targeted re-align, repeat policy

Read this before any align / re-align / line-splitting work.

## The two-phase translation model

Translation runs as TWO big phases: **Translating** (whole natural sentences,
1:1 source↔translation, natural target word order — long sentences allowed)
then **Splitting & aligning** (sentences over the one-line **fit** capacity are
split & re-aligned; a fitting sentence normally stays whole even when its
source spans several cues — many-to-one is the native model). The narrow
zero-LLM exception is a Latin target above its aim with a safe balanced target
seam, a compatible internal source sentence/semicolon/colon/dash seam, and at
least one second of speech on both sides. Ordinary source commas and cue edges
never trigger it.

Phase-2 budgets ride every align payload as `budgets: {s, t, f}`:

- `f` = fit (one-line trigger, default 16 for CJK, style-derived,
  `--align-fit 8-32` overrides). Measured on the delivery projection, so
  halfwidth Latin glyphs weigh half a cell and projected punctuation weighs
  nothing — a mixed-script line can hold more raw characters than `f` and
  still fit.
- `t` = the aim per piece when splitting (soft: an aim-to-hard span may stay
  whole). 14 for CJK, 30 for Latin targets.
- hard ceiling (blocking): 20 for CJK, 42 for Latin (aim × 1.4). Latin fit
  stays 42, so its old 42–58 "never blocking" tolerance band is gone: any
  Latin unit over 42 chars must be split or rewritten.

Reading speed (CPS) and aim-band width are recorded as advisory during
translate/align and gated at delivery by `baocut audit` / `finish-check` —
they never trigger align retries.

## The `align` flow (M68): redo ONLY Phase 2

Runs against an existing translation — no re-translation, only `align`-kind
prompts:

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

## Repeat align runs MUST be `--groups`-targeted

A full re-align re-reviews every over-fit sentence at the same cost as the
original align phase and does NOT converge the residual over-fit count (p809
A/B: 32 calls again, quality statistically unchanged, over-fit residual
wobbled 59→69) — most re-reviews just confirm the existing cuts. Repeat the
phase only scoped to the lines you actually want changed, or with
`--align-local` when presentation-metric drift is acceptable (p809: −38%
calls, −23% chars in; CPS/flash/term-neighbor counts wobbled slightly upward).

## `--groups` keys and `--from`

`--groups` (keys from `align list`) scopes the redo to those lines. Keys are
first-word ids, so a re-align or edit that moves a boundary changes them; the
flow resolves such stale keys to the group that contains the word today (see
`log --kind align-diag` for the remaps) and fails only when the word id no
longer exists at all — re-run `align list` for fresh keys in that case.

`--from current` (default) re-aligns the doc's translations as they stand
(manual edits survive; untouched groups stay byte-identical). `--from pristine`
restores the last FULL translate's Phase-1 sentence texts from
`ai/sentences-<lang>.json` (whole language; fingerprint-gated — a re-polish or
edit invalidates it, fall back to `--from current`). Re-align never flips
staleness.

## Benchmarks

For repeatable polish/translation benchmarks, clone one immutable version into
a clean project instead of retranscribing or reusing a mutable AI cache — the
full recipe (controlled A/B, `project clone --from-version`) is in
versions.md; the acceptance checklist is in orchestration.md.
