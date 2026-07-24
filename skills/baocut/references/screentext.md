# On-screen text translation (M-screentext)

Translate text **burned into the video picture** — slide bullets, lower-thirds,
signage, hard-subs — as distinct from spoken subtitles (`subtitle`/`align`) or
overlay watermarks (`element`/`watermark`). Vision OCR reads frames into a
per-project **work queue**; **you** (the Agent) translate the queue; `apply` turns
every translated block into a positioned `text` element on the canonical text
track, so the stage and export render it in place.

**The CLI never calls an LLM.** Building the queue and placing elements are local,
deterministic work. Translation is always yours — no command in this group knows
how to produce one.

No transcript required — on-screen text is independent of speech (a silent screen
recording is a real case). Audio-only projects fail: there's no video to read.

## The three steps

```
① baocut screentext scan <pid>              build the queue (or `add` picked frames)
② show --pending --page i → look at the PNGs → translate --file    ← repeat per page
③ apply → list / preview → element set      place, then fine-tune
```

Everything lives in `screentext.json` at the project root: the OCR'd frames, each
block's geometry, and each block's translation state. It is a **work-order cache**,
not part of the document — losing it costs an OCR pass, never a placed element.

**Queue first.** Any "translate the on-screen text" request starts with

```bash
baocut --json screentext show <pid>
```

If `totals.pending > 0` the queue already exists (the user built it in the GUI, or
a previous run left work) — go straight to ②. Only scan when the queue is empty.
This is what lets the GUI's one-line prompt and a proactive whole-video request run
the same instructions.

## ① Build the queue

```bash
# The whole clip, one sample every 5s — the proactive "translate everything" case:
baocut --json screentext scan <pid> --target-lang zh-Hans

# A range, sampled finer (fast-changing lower-thirds):
baocut --json screentext scan <pid> --start 60 --end 180 --step 2

# Frames the user located — the passive "this slide" case:
baocut --json screentext add <pid> --at 12.5,48,131
```

- **`scan` dedups across frames for you.** A caption that stays up over many samples
  is queued **once**, at the frame it first appeared, with its `span` derived from
  the sampling grid (`span.source:"scan"`). Frames whose every block is already
  queued add nothing (`duplicateFrames`), so re-scanning a wider range later is safe
  and cheap. Empty frames are not queued at all.
- **`add` is the precise one.** It re-OCRs each frame and probes each block's real
  on-screen interval (`span.source:"detected"`, dozens of extra OCR passes — that's
  why `scan` doesn't do it). `--no-span` skips the probe. Re-adding a time re-reads
  the frame but **keeps the translations** of blocks whose text didn't change.
- Budgets: `add` ≤ 30 frames, `scan` ≤ 240. Over budget, the error names the
  `--step` that would fit.
- Shared knobs (`--help` has the full list): `--size N` (frame long edge, 480–4096,
  default 1600), `--source-lang en-US,zh-Hans` (OCR hints, default auto),
  `--min-confidence C` (default 0.3), `--target-lang L` (recorded on the queue).

Drop frames you don't want with `screentext remove <pid> --at <t>[,<t>…] | --all`
(deletes their PNGs too; already-placed elements are untouched).

## ② Translate — look at the PICTURE, not just the OCR text

```bash
baocut --json screentext show <pid> --pending          # page 1 of the work list
baocut --json screentext show <pid> --pending --page 2 # …until page > totalPages
```

`--pending` pages over only the frames that still need work and lists only their
pending blocks. A page is **5 frames** by default and reports `totalPages`.

```jsonc
{"totals":{"frames":9,"blocks":31,"pending":22,"translated":9,"skipped":0,"applied":0},
 "page":1,"pageSize":5,"totalPages":2,
 "frames":[{
   "t":12.5, "png":"/…/screentext/t00012.50.png", "width":1600, "height":900,
   "state":"pending",
   "blocks":[{
     "blockId":"b1",
     "text":"Accelerating\nscientific discovery",   // may be multi-line
     "bbox":{"x":50,"y":18,"w":62},                  // center x %, y from top %, width %
     "rot":0, "estFontSize":41,                      // 540 short-edge reference space
     "conf":0.97, "colors":{"fg":"#ffffff","bg":"#101418"},
     "span":{"start":11.9,"end":16.4,"source":"detected"},
     "state":"pending"                               // pending|translated|skipped|applied
   }]}]}
```

Block rows are exactly what the queue stores, plus the derived `state` — there is
no second shape to reconcile.

**Read each frame's `png` together with its blocks.** OCR text alone loses layout
and context — a heading, a chart axis label, and a caption read very differently,
and OCR mis-splits, drops glyphs, or invents them on anti-aliased edges. Open the
PNG (you can view images), match each `blockId` to what you see, and translate for
meaning and register.

- **Paging discipline:** view a page's PNGs, translate that page, write it back,
  then fetch the next page. Never pull the whole queue into context and write back
  once at the end — long videos blow the context and a failure loses everything.
- **The picture wins.** When OCR misread the source, correct it with `--src` (or
  the file's `"src"`) before translating; the correction is what lands in the
  element's provenance.
- **`skip` is the way to say "leave this alone"** — a logo wordmark, a bare URL,
  on-screen code, UI chrome, and the garbage rows OCR produces from
  half-rendered text. Skipping records the decision, so the next page (or the next
  run) never asks about that block again. This replaces v1's "just don't emit it".
- Keep terminology consistent with the project's locked terms and notes
  (`project show`; transcript-quality.md) and with the spoken-subtitle translation —
  the same product or name must read identically on screen and in the captions.
- Preserve a line break only when it's meaningful (a two-line title); let long runs
  re-wrap.

Write the page back in one call (never write JSON into the repo root):

```jsonc
// $TMPDIR/trans.json
{"items":[
  {"t":12.5,"blockId":"b1","trans":"加速科学发现"},
  {"t":12.5,"blockId":"b2","trans":"研究报告","src":"Research report"},  // OCR fix + translation
  {"t":12.5,"blockId":"b3","skip":true},                                 // logo — leave it
  {"t":48.0,"blockId":"b1","trans":"第三季度路线图"}
 ],
 "model":"claude-…","targetLang":"zh-Hans"}
```

```bash
baocut --json screentext translate <pid> --file "$TMPDIR/trans.json"
```

All-or-nothing: an unknown `(t, blockId)` rejects the whole file, so a typo can't
half-land. For a single block, `screentext set <pid> --at 12.5 --block b1
[--trans "…"] [--skip on|off] [--src "…"]` does the same thing without a file.
Re-translating an already-applied block drops it back to `translated` — run
`apply` again to update the element.

## ③ apply — place the translations

```bash
baocut --json screentext apply <pid>              # every translated block
baocut --json screentext apply <pid> --at 12.5    # …or just some frames
```

Every translated, non-skipped block becomes a `text` element **at the source text's
own position, width and rotation**, sized from `estFontSize`, in the subtitle
default style over a **translucent black plate (65%) with a black stroke** so it
stays legible on any footage and buries the source text underneath. Its
`text-align` follows the source block's own alignment when the OCR'd lines agree on
an edge, and otherwise the script's natural direction (Arabic/Hebrew right, the rest
left). Its `span` times it. Skipped and untranslated blocks are passed over and
reported as `pending`.

- **Idempotent:** a block whose `(frameT, blockId)` already has an element replaces
  it in place. Re-running after a correction is safe — no double-placing.
- The translation sits **over** the untranslated original, which is the honest
  reading of "translate the picture". The plate hides ordinary source text; a
  larger or brighter original can still peek out. Fix individual collisions with
  `element set` (below), not by re-scanning.

## Batch confirmation

A whole-video scan is a batch mutation. After ① and before ③, report the queue
summary — frame count, block count, a few sample strings, the target language — and
confirm the scope with the user. Skip the checkpoint only when they asked for
end-to-end.

## Review, fix, undo

```bash
baocut --json screentext list <pid>       # every placed element: id, span, geo, text, srcText
baocut --json screentext clear <pid> --elements   # unplace, keep the translations
baocut --json screentext clear <pid> --queue      # drop the queue + PNGs, keep the elements
baocut --json screentext clear <pid>              # both (default)
```

Placed items are ordinary `text` elements tagged `ai.op="screentext"` on the
canonical text track; `list`/`clear` match on that tag. Fine-tune one with
`baocut element set <pid> <elId> …` (elements.md) — nudge a collision, resize,
retime, or `--hidden on` a bad block — instead of re-running the whole scan.
`clear --elements` keeps every translation in the queue, so re-placing is one
`apply` away.

## Verify like any visual edit

Exit-0 is not proof. `screentext show` / `screentext list` is the state re-read; for
a composite proof render a frame the overlays land on — `broll preview --at <t>` or
`export --video --start A --end B --preview` composite ALL overlay layers (a queue
frame's `t` is exactly the time to preview). Confirm the translation sits where
the source text is and reads correctly. The GUI picks up CLI writes live — never ask
the user to close it.
