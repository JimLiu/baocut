# Talking-head video editing (M79 soft cuts + M80 B-roll)

## The model

- **Cuts are SOFT**: `Clip.cut` regions on the timeline — reversible,
  reviewable, previewed by playback (skip-cuts), applied at export. Nothing is
  destructive until an export renders a file. `cut restore` undoes any cut;
  every mutating command snapshots a version.
- **B-roll items** live on `doc.broll`: local image/video assets composited
  between the video and the captions — `fullscreen` (cutaway replaces the
  talking head) or `pip` (picture-in-picture keeps the speaker visible).
- Words/translations are untouched by cuts (AV-level edit): captions retime at
  export through the same kept-span map as the picture, so they can never
  desynchronize.
- Hiding a subtitle row is not a cut: `baocut subtitle hide` suppresses only
  displayed/exported text and keeps AV duration intact. See
  [subtitles.md](subtitles.md); reverse it with `subtitle restore`, not
  `cut restore`.

## Order of execution + checkpoints

Finalize Agent polish (`polishQuality` PASS) → speech timing (cuts) → visual
layers (B-roll) → captions/translation/export last. Never place B-roll or
export captions against pre-cut timing —
an upstream change forces redoing everything downstream.

When driving for a user (not an explicit "run end-to-end"), confirm at each
step, **one checkpoint per turn**:
1. After the rough cut: report N cuts / old → new duration, quote the notable
   removals AS SPOKEN CONTENT (never `wN`/`clip-N`/cut ids — those are your
   addresses, meaningless to the user), wait for approval.
2. Before B-roll: confirm fullscreen vs PiP once if not implied, and confirm
   sourcing (below).
3. After placement: show the `broll preview` composite.
4. Before the final export: confirm target (res / language / burn-in).

## Deterministic pass — `cut detect`

```bash
baocut --json cut detect <pid> [--dry-run] [--min-pause 0.8] [--compress-to 300ms]
         [--no-pauses|--no-fillers] [--filler-lang auto|en|zh] [--fillers a,b]
         [--max-gap 3.0] [--trim-chapter-starts]
```

Applies soft cuts directly (`--dry-run` proposes only). Defaults follow the
talking-head editing standards:
- Pauses ≥ 0.8s **compress to ~0.3s — never zero out** (`--compress-to` keeps
  that much of the ORIGINAL silence at that spot; it never invents silence).
  Sentence-final boundaries keep ~0.4s; pauses > 3s are protected as
  deliberate beats (`--max-gap`).
- User thresholds always win: "only pauses over 1s, keep at least 0.5s" →
  `--min-pause 1 --compress-to 500ms` (or `0.5s`; explicit units are preferred).
- Fillers: the FIXED hesitation sounds cut by list (um/uh/er/ah/呃/额 — M81:
  zh hard list is now ONLY 呃/额); soft phrases ("you know", "那个"…) only when
  punctuation-isolated.

**The two-category filler rule.** Category 1 (above) is safe for the
deterministic pass — pure hesitation only (um/uh/er/ah/呃/额). Category 2 —
`so, like, 然后, 就是, 嗯, 啊, 那个, 那, 对, 所以, 但是` — must NEVER be removed by
word list; it belongs to the LLM cleanup stage, which keeps any instance
carrying sequence, continuation, contrast, cause, reference, response,
acknowledgement, emphasis or natural tone. **嗯/啊 are Category 2** (M81 moved
them out of the hard list): they double as responses/acknowledgements
("嗯。" = "mm-hm"), so cut them only as pure hesitation, judged by speaker turn
and context — and `audit` never FAILs on a normal "嗯。". Examples:
- "um, I think this solves it" → cut `um`.
- "It works like a checklist" → KEEP `like` (comparison).
- "The upload failed, so we retried" → KEEP `so` (cause/effect).
- "然后我们再看第二点" → KEEP `然后` (sequence).
- "It's, like, really hard" → isolated hesitation → cut.

## LLM rough cut — `task start cleanup`

`baocut --json task start cleanup <pid>` (or fold into the pipeline with
`auto <file> --rough-cut` — it runs after polish, before translate). Same
claim/submit worker loop; the `cleanup` contract carries indexed word tokens
with gap marks (`·1.4s·`) and already-cut `⌫word⌫` markers. The worker
auto-applies as soft cuts and records provenance in `ai/cuts.json`.
For quality-first work prefer the separate command with
`--cleanup-level standard`; the one-task `auto --rough-cut` form cannot pause
between polish quality review and cleanup.

Answering cleanup calls — the retake decision path:
1. Is it really a retake (several attempts at the SAME intended idea)? Not
   intentional emphasis, rhetoric, or a second pass adding information.
2. Define the complete version to keep — a lead-in, connector, subject or
   setup is NOT filler when the kept content depends on it.
3. Cut only the failed/covered part, starting at the failure point, not at
   earlier useful setup the kept take doesn't repeat.
4. Prefer the later complete attempt, never mechanically — keep the earlier
   attempt's unrepeated setup. Never stitch fragments of different attempts
   into one artificial sentence.

Conservative-boundary principle: remove defects without changing meaning;
prefer small local cuts over whole sentences; **when unsure whether a cut
harms meaning, logic or listening flow — do not cut.** Over-cleaning (chopped
sentences, glued rhythm) is the worse failure; cutting > 40% of a page warns.

## Review & verification loop

```bash
baocut --json cut list <pid> [--kind silence|filler|badTake|manual]
                                        # every cut + kind/reason/excerpt
baocut --json cut restore <pid> <ids|--all>
baocut --json cut add <pid> --start A --end B     # manual; snaps to word edges
                                        # (or --words wA..wB; --note "…" records why)
baocut --json audit <pid>               # edits section: FAIL on partition
                                          # breaks / mid-word boundaries;
                                          # WARN on >40% removal, no provenance
```

A successful command is not verification: after applying cuts, `cut list` +
`audit` before reporting; spot-check a suspicious boundary with
`export --video --start A --end B --preview`.

## B-roll workflow

1. `baocut --json task start broll <pid>` — the suggestion stage writes
   `ai/broll-suggestions.json` and NEVER touches the doc. Rules baked into the
   contract: never inside the first/last 3s; a dense jump-cut cluster gets ONE
   long covering cutaway; spans 1.5–20s; no overlaps.
2. **Source footage yourself — BaoCut never downloads it.** In preference
   order: (a) the video itself — `baocut frames <pid> --at t` extracts
   stills natively, `export --video --start A --end B` cuts a clip; (b) files
   the user provides — ask at the B-roll checkpoint; (c) your OWN tools if the
   environment has web/stock search or image generation — download to a temp
   dir, then attach. If none is available for a suggestion, report it with its
   reasoning and skip it; never fabricate an asset path.
3. Attach per adopted suggestion:
   `baocut --json broll add <pid> --file shot.png --suggestion bs1`
   (or `--at <t> [--dur <d>]` / `--start A --end B`; `--mode fullscreen|pip`,
   `--rect "x,y,w"` = PiP center-% + width-%, `--fit cover|contain`,
   `--bg blur|black`, `--src-start <t>` = where playback starts inside a video
   asset, `--radius N` PiP corner radius, `--name "…"` display label). Defaults:
   images → pip 4s, videos → fullscreen ≤8s. `broll update <pid> <brId>` takes
   the same placement flags (plus `--file`) to adjust in place.
4. Placement rules (PiP): pick the largest low-information rectangle — avoid
   the speaker's face/gestures, the caption band, existing overlays. Any
   readable text/logo in the SOURCE must survive the fit: aspect-mismatched
   sources use `--fit contain` (blurred backdrop), never blind cover.
5. **Verify EVERY placement** before reporting it done:
   `baocut --json broll preview <pid> --at <midpoint>` renders the exact
   export composite (same compositor); `--at` takes a comma list, `--tile`
   grids them into one image, `--size N` sets width, `--no-subs` drops the
   caption layer, `--output/-o <dir>` picks the destination. An attached asset
   is not proof it renders. `audit` gates the rest: missing assets, out-of-bounds rects,
   B-roll buried inside a cut, overlapping cutaways (FAIL); first/last-3s
   intrusion, <1.5s flash cutaways (WARN).

## Captions & export

Burn-in and translation come AFTER cuts are final. On a translation job,
prefer `auto <file> --rough-cut --lang zh` (cuts land before translate), or
run cleanup before `task start translate`. Export applies cuts + B-roll by
default; `--include-cuts` / `--no-broll` opt out; SRT/VTT/ASS retime to the
edited output (a wholly-cut cue drops with continuous numbering). Sidecars
exported BEFORE a cut are stale — re-export.

## Known failure modes

- Over-cleaning: category-2 fillers removed by list; a retake's unrepeated
  setup deleted; sentences glued ("…time to. | To build…"). Keep when unsure.
- Reporting word ids / cut ids / suggestion ids to the user.
- Placing B-roll, then restoring cuts underneath it — re-verify with
  `broll preview` (audit's `broll-inside-cut` catches the worst case).
- Skipping `broll preview` and shipping a PiP over the speaker's face or the
  caption band.
- Exporting with a stale pre-cut SRT next to a cut video.
