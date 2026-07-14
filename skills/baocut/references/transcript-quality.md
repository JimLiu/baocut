# Transcript quality: ASR → Agent polish → cleanup

Use this reference for any job that promises a corrected transcript, polished
captions, or a rough-cut video. The default speech model remains
`qwen3-asr-0.6b`; transcript correctness comes from the CLI/Agent polish loop,
not from silently swapping ASR models or editing `doc.json` by hand.

## Quality-first sequence

For talking-head editing, interviews, podcasts, or multi-person recordings:

1. Run `baocut auto <media> --align-concurrency 3` **without** `--rough-cut`.
   Keep speaker identification on; pass `--speakers N` when the count is known.
2. Feed the task with the persistent Agent worker pool. Analysis, polish and
   repunct requests must all be claimed and answered — the CLI never supplies
   semantic corrections itself.
3. Read `task report`, `project show`, and `audit`. Require
   `polishQuality.status == PASS` before cleanup/export.
4. If polish is WARN, run a FULL `task start polish <pid> --instructions …`
   and drain it with the same Agent pool. There is no sentence-only targeted
   polish command: “targeted” means precise instructions and evidence, not a
   hidden partial-mutation path.
5. Only then run `task start cleanup <pid> --cleanup-level standard`.

Pure subtitle/translation tasks may use `--no-speakers` when the recording is
confirmed single-speaker and speaker labels/boundaries are irrelevant. Never
apply that shortcut to rough-cut, interview, podcast, or dialogue work.

## What the Agent must do

`analysis.json` supplies canonical terms plus exact `observedVariants` found in
the ASR text. A polish answer must:

- cover every source word once and in order;
- correct contextual variants such as `Cloud Code → Claude Code`;
- preserve repetitions and fillers (those belong to cleanup, not polish);
- add punctuation and semantic sentence/paragraph boundaries;
- never summarize or replace a page with shorter prose.

`task submit` runs the engine's own 70% atom-LCS map gate. A rejection is local:
fix the named coverage problem with the same lease. Do not respond to a drift
problem by copying the source unchanged — retain coverage AND apply known term
corrections.

## PolishQuality gate

The latest CLI polish writes `ai/polish-quality.json`; `task status/report`,
`project show`, and `audit` expose it. WARN means one or more of:

- Agent retries occurred;
- a page exhausted retries and used alignment recovery;
- a page/sentence fell back to original words;
- an analysis-confirmed ASR variant remains;
- a resumed run lacks measurements for its already-finished prefix.

WARN is safe for data integrity but not sufficient evidence for polished
delivery. Re-run full polish with precise instructions, then audit again.

## Cleanup levels

| Level | Pause threshold | Surviving pause | LLM posture |
|---|---:|---:|---|
| `conservative` | 0.8s | 0.30s | Legacy behavior; ambiguity means keep |
| `standard` | 0.7s | 0.25s | Remove isolated/repeated padding; preserve logic and tone |
| `tight` | 0.6s | 0.20s | Brisk delivery; remove more non-semantic softeners, never facts/connectors |

The audit checks residual fixed hesitation fillers (M81: 呃/额 only — 嗯/啊 moved
to the LLM stage) after a cleanup artifact exists and only for words not already
soft-cut. AUDIBLE residuals (≥0.05s) are FAIL; near-zero-duration ASR-noise
tokens are a `cleanup-filler-zero-duration` WARN (fix: `timing repair` then
`cut detect`), not an unfixable FAIL. Context-dependent words
(`就是/然后/呢/其实/对/嗯/啊` etc.) are Agent-review candidates, never an automatic
failure or unconditional word-list deletion.

## Fixing terms without a full re-polish (M81)

A `polishQuality` WARN whose only issue is residual terms does NOT require a
40-minute rerun:

- `baocut terms fix <pid> --map "克拉克=Claude Code,Grab=grep"` — deterministic
  in-place source rewrite (ids/timings preserved, integrity-gated), LOCKS the
  terms, flips the residual gate; then `task start translate <pid> --lang zh
  --stale-only` since the source changed.
- `baocut task start polish <pid> --from-audit` — re-polish ONLY the paragraphs
  carrying residual variants (or `--ranges`/`--terms`).
- `--terms-file <f>` on transcribe/auto/polish/translate locks terms up front
  (`canonical = variant1 | variant2`, authoritative, always residual-checked) —
  the real fix for the "term misheard, polish couldn't correct it" loop.
- Content-aware ASR: a term-heavy `--desc`/`--terms-file` makes `auto`/`transcribe`
  suggest `--model qwen3-asr-1.7b` (`modelHint` in the JSON) — the 0.6b default
  mishears code-switched technical terms.

## Acceptance evidence

Before reporting a polished/edited result, apply the completion mode in
SKILL.md. Project mode checks the content fields below without running
`finish-check`; a timed/edited deliverable additionally parses
`finish-check <pid>` and its `{ready, blockers, warnings, next}` verdict:

- `polishQuality.status == PASS` (or residual-only WARN cleared via `terms fix`);
- no `polish-residual-term` / `polish-introduced-zero-duration` findings;
- edits audit has no AUDIBLE fixed-filler residual, mid-word boundary, or
  partition FAIL;
- `speakers show` agrees with the recording when speaker work is in scope;
- quote notable cuts as spoken content, never internal ids.
