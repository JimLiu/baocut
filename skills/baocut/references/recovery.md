# Lifecycle, diagnostics & recovery

```bash
baocut task status <taskId>              # progress / phase / pending / oldestPendingSec / elapsedSec
baocut task list [<pid>]                 # all tasks
baocut task resume <taskId>              # respawn a stalled/dead worker (page checkpoints — no re-asking)
baocut task cancel <taskId>              # kill the run
baocut task log <taskId> [--tail N]      # worker output, timestamped (errors, progress)
baocut task calls <taskId>               # every request: kind, attempt, workClass, answered?,
                                           #   sizes, createdAt/claimedAt/answeredAt,
                                           #   queueWaitSec/activeSec, lint rejections
baocut task report <taskId>              # postmortem: per-kind spans, workClass counts,
                                           #   queue-wait & active p50/p95, chars in/out
baocut --json audit <pid> [--lang L]      # read-only quality: source/target flash, coverage,
                                           #   stale/width/pins/timing/pipeline evidence
baocut logs <pid>                        # list the project's LLM audit files
baocut logs <pid> --kind align-diag --pair g16.0   # per-pair engine decisions (why rejected/retried)
baocut finish-check <pid> [--lang L]      # M81: aggregate acceptance verdict (always exit 0)
baocut timing repair <pid> [--dry-run]    # M81: re-fit zero/negative-duration words (never stale)
baocut task watch <taskId> [--jsonl]      # M81: follow a run to terminal, one line per change
baocut project repair <pid>              # fix an orphan status (see below)
```

`task report` is the performance record; `audit` is the quality record;
`finish-check` is the **timed-delivery router** — it runs audit, polishQuality,
attention, and export preconditions and returns `{ready, blockers, warnings,
next[]}`. It always exits 0, so parse `ready`; never shell-chain it to export.
`next[]` is advisory, not a queue to drain.
Audit never writes the project and returns exit 0 for PASS/WARN, exit 2 for FAIL
(exit 1 is command/input failure). Inspect the failing sections against the
requested completion mode instead of treating every exit 2 alike.

## Completion gates and the one-repair budget

Use these categories after the initial task reaches terminal:

- **Content/structure blockers:** source loss or duplicate coverage; missing,
  extra, empty, or stale translation; source-stamp mismatch; missing locked
  terms; adjacent duplicate target content; term/source coverage mismatch;
  boundary/semantic rebind corruption; broken pins; duplicate/empty words; or
  non-finite, negative, regressing, and otherwise invalid core timing. These
  block Project, Markdown, and timed delivery.
- **Presentation blockers:** source/target flash, `prc.cps`, projected width,
  line-count/unsafe-layout, punctuation-projection, mergeable/splittable
  grouping, and similar reading-layout findings. They block SRT/VTT/ASS and
  captioned video, but NOT a content-sound Project or Markdown export.

Project mode runs `audit` once, reports presentation debt without repairing it,
and asks the user whether to export. Timed delivery runs `audit` plus
`finish-check` and requires the full verdict to be ready.

Across post-terminal verification, allow at most ONE targeted repair workflow
and at most ONE Agent task. Before mutating, run `version list` and record the
current branch tip. A deterministic local mutation may be paired with its
required incremental refresh, but do not start a second Agent task. Re-audit
once. If a blocker remains, stop and ask the user; if content coverage, source
fidelity, pins, or timing regresses, restore the recorded version before asking.
Spend no repair budget unless the selected local action plausibly addresses the
blocking samples. In particular, target `align` cannot repair `source-flash`;
when mixed blockers have no single safe local fix, report them immediately.
Never recursively execute `next[]`, re-segment a translated project, run a full
re-translation, or repeat align solely for presentation findings without
explicit user approval.

New M81 audit codes and their fix: `polish-introduced-zero-duration` /
`zero-duration-words` / `cleanup-filler-zero-duration` → `baocut timing repair
<pid>`; `polish-residual-term` (WARN) → `terms fix --map` or `task start polish
--from-audit`. With `--lang`, it audits that translation;
without it, every non-empty stored translation language is included.

Read the audit JSON by section:

- `polishQuality`: structured evidence from `ai/polish-quality.json` — page
  retries, alignment recovery, fallback pages/sentences and analysis-confirmed
  residual term variants. WARN is not content loss, but it blocks a claim that
  the transcript is polished; prefer `terms fix` or `task start polish
  --from-audit` inside the one-repair budget. Do not default to a full rerun.

- `source` / `translations`: current reading-time flash counts, width maxima,
  target missing/extra/empty/stale coverage and source-stamp consistency;
  `mergeableFragmentCount` is an unnecessary seam between short groups, while
  `splittableOverAimCount` is the inverse defect — an over-aim group for which
  the production splitter can still find a safe, natural, balanced seam (M71:
  a seam whose half has less than one second of real speech is NOT counted —
  that is an evidence-backed reading-time merge, not debt; delivery CPS stays
  a separate quality signal). Both
  are FAIL quality gates; their sample arrays carry the actionable text/key;
  `boundaryDriftCount` (M70, FAIL) proves against `ai/align-rebind-<lang>.json`
  that no rekeyed target seam crossed a source sentence boundary — post-M70
  applies must show 0; `boundaryDriftAuditAvailable:false` (WARN) means the
  artifact is missing or predates the current transcript, never a clean zero;
  M71 semantic seam gates over the same artifact:
  `largeIntraSentenceRebindCount` (FAIL — a rekeyed seam moved ≥2 words even
  inside one sentence; measurable on M70 artifacts too, so pre-M71 projects
  can FAIL here until re-aligned) and `rebindMovedContentWordCount` (FAIL — a
  1-word rekey moved a content word; only whitelisted function words may
  move), `lockedSeamMoveCount` (FAIL — a reviewer/reading-merge seam moved at
  all; needs M71 provenance), `semanticRebindAuditAvailable:false` (WARN — the
  artifact predates M71 seam provenance; locked-seam/flash-merge audits
  unavailable), `flashMergeCrossSentenceCount` (WARN — reading-time merges
  that crossed a Phase-1 sentence, evidence-backed but worth a look),
  `termSourceCoverageMismatchCount` (FAIL — a protected target term whose
  normalized source words sit in the NEIGHBOR group, the p788 "OpenCode"
  defect). For timed delivery, `task start align <pid> --lang <L> --from
  pristine` may be the single repair when no narrower supported repair exists;
  otherwise report the blocker instead of starting a broad run;
  M72 gates: `adjacentDuplicateCount` (FAIL — adjacent groups carrying the
  same normalized translation, the smoking gun of a mis-keyed subset apply;
  report it unless one bounded repair can safely correct it) and
  `target-flash-complete-sentence` (WARN — a complete short CJK sentence kept
  deliberately because both merges are sentence-blocked; the reading-time
  repair never welds across 。？！ anymore). `mergeableFragmentCount` also
  exempts semicolon/colon/dash seams — compaction preserves them (RALN-002);
  `suspectSentenceEndCount` (WARN) is the artifact-free heuristic — a
  sentence-final target group whose source range ends mid-sentence, possibly
  legitimate restructuring;
- `pins`: orphan or structurally inconsistent cue/translation/paragraph pins;
- `timing`: duplicate/empty words, invalid or regressing intervals, overlaps
  and zero-duration words;
- `pipeline`: safely attributable align calls, recuts/rewrites, second looks,
  retries and fallbacks; `fallbackCount:null` means attribution was unsafe,
  not zero;
- `topIssues`: the most severe concrete ids/timestamps/text to inspect first.

For an exact `zh` target, `translations[]` also reports the strict PRC
delivery projection independently of the semantic 14/20-character grouping
gate: `deliveryMaxCps` is 9, `deliveryCpsViolationCount` measures projected
non-whitespace characters over the real display window, and the width/line/
unsafe-layout counts enforce 32 visual cells × 2 lines. Deterministic format
violations and missing locked glossary targets are FAIL; an edge `、` or an
ambiguous straight quote is WARN. `punctuationProjectionEnabled:false` is a
FAIL for strict delivery even though the UI may intentionally preview literal
punctuation with its Display toggle off. Use `topIssues` codes prefixed `prc.`
to locate the exact group; for timed delivery, spend the single repair budget
only when a local fix exists, then re-audit once.

Flash lines are FAIL for timed delivery because they are unreadable at the
stored timing; they are presentation debt, not a Project-mode blocker.
Zero-duration words are WARN when other timing invariants remain valid. In a
controlled A/B, pre-existing flash/zero-duration counts may be classified as
baseline debt, but they must be recorded and must not increase or acquire new
samples. A baseline FAIL is never converted to PASS by comparison alone.

- "project … is busy" → another run owns it; wait or `task cancel` the stale one.
- A project stuck at "transcribing"/"queued" with NO live run and no
  resumable task (a killed `baocut transcribe` leaves no task record) →
  `baocut project repair <pid>`: recovers the doc if the run actually
  finished, otherwise marks it error so you can re-transcribe. `project show`
  prints a hint when it sees this state.
- "model not installed" → `baocut model download <id>` (ASR ids also fetch aligner + VAD;
  the speaker model downloads itself whenever identification needs it).
- A worker that dies mid-run resumes from page checkpoints via `task resume` —
  completed pages are never re-asked.
- An ANSWER worker (your subagent) that dies mid-claim is self-healing: its
  lease expires (default 1800s) and the call becomes claimable again — the
  surviving workers absorb it; respawn a replacement when you notice.
- Reading files under `~/Library/Application Support/BaoCut/` is always safe;
  never WRITE there while the app or a worker runs.


## Edit artifacts & audit fields (M79/M80)

- `ai/cuts.json` — soft-cut provenance (detect | cleanup | manual, per-cut
  reason + timestamp). `cut list` joins reasons from it; audit WARNs
  `cut-provenance-unavailable` when cuts exist without it.
- `ai/broll-suggestions.json` — the broll stage's rows (open | attached |
  dismissed) + words fingerprint; `broll suggestions` reads/curates it.
- audit `edits` section repairs:
  - `cut-partition-broken` / `cut-mid-word-boundary` → `cut restore` the
    offending clip, re-add with `cut add` (word-edge snapping fixes it).
  - `cleanup-fixed-filler-residual` (FAIL, audible 呃/额 left) → `task start
    cleanup <pid>`. Each residual row now carries wordId/time/speaker/cue.
  - `cleanup-filler-zero-duration` (WARN, M81) → near-zero ASR-noise filler the
    cut mechanism can't remove (`uncutBecauseZeroDuration`); `baocut timing
    repair <pid>` then `cut detect <pid>`. NOT a missed cut.
  - `cut-heavy-removal` (>40%) → confirm an intentional highlight/short
    version with the user; otherwise restore.
  - `broll-missing-asset` → re-attach with `broll update <id> --file …`.
  - `broll-rect-out-of-bounds` → `broll update <id> --rect "x,y,w"`.
  - `broll-inside-cut` → the cut swallowed the span; move the item or
    restore the cut, then `broll preview` again.
  - `broll-overlap` / `broll-edge-intrusion` / `broll-flash` → retime with
    `broll update --at/--start --end`.
- Versions: every cut/broll mutation snapshots ("Clean up audio", "Rough
  cut", "Cut added", "Restore cuts", "B-roll added/updated/removed") —
  `baocut version list/restore` recovers any state.
