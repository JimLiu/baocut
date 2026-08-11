# On-screen text translation

Use `screentext` for text already baked into video pixels. It is separate from
spoken subtitles and watermarks. The CLI performs deterministic frame sampling,
OCR queue management, and placement; the Agent translates the queue.

## Queue, inspect, translate, apply

Read existing work before scanning:

```bash
bin/baocut screentext show "/path/demo.bcut" --summary --json
bin/baocut screentext scan "/path/demo.bcut" --lang zh-Hans --jsonl
bin/baocut screentext show "/path/demo.bcut" --pending --page 1 --json
```

`scan` extracts the deterministic sampling grid first, then sends frames to
Tesseract in bounded multi-page batches. Queue ordering and per-frame geometry
remain unchanged; a failed batch is reported with its first and last frame and
nothing is committed.

Process one page at a time. Open every returned PNG, reconcile OCR blocks with
the pixels, then write a temporary batch outside the project:

```json
{"items":[{"t":12.5,"blockId":"b1","trans":"加速科学发现"},{"t":12.5,"blockId":"b2","skip":true}],"model":"agent","targetLang":"zh-Hans"}
```

```bash
bin/baocut screentext translate "/path/demo.bcut" --file "/tmp/trans.json" --json
bin/baocut screentext apply "/path/demo.bcut" --json
```

Use `screentext add --at <times>` for selected frames. If OCR misses visible
text, use `insert` on an existing queued frame with measured geometry, font
size, alignment, and source-picture span; do not disguise it as a watermark.
Use `set` to correct one block or mark it skipped.

```bash
bin/baocut screentext set "/path/demo.bcut" --at 12.5 --block b1 \
  --text "Corrected source text" --json
bin/baocut screentext insert "/path/demo.bcut" --at 12.5 \
  --text "Missed source text" --x 50 --y 20 --w 40 --font-size 28 \
  --start 12.2 --end 15.6 --align center --json
```

`apply` is idempotent and writes `role=screentext` text elements. An explicit
`--duration <seconds|source>` overrides placement timing; otherwise automatic
blocks use the command default and manual inserts preserve their measured span.

## Verify and clear

```bash
bin/baocut screentext list "/path/demo.bcut" --json
bin/baocut frames "/path/demo.bcut" --at 12.4,12.5,15.6 \
  --tile --output "/tmp/screentext" --json
```

Check just before, during, and after representative windows, including the
source picture transition. `clear --elements` keeps the translated queue;
`clear --queue` keeps placed elements; no flag clears both. Confirm that scope
before clearing.
