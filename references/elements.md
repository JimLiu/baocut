# Elements, B-roll, and watermarks

Elements are canonical `text`, `image`, `video`, or `audio` items on OUTPUT-time
tracks. Use role facades for `broll`, `watermark`, and `screentext`; they still
write the same element truth.

## Inspect and add

```bash
bin/baocut element list "/path/demo.bcut" --json
bin/baocut element add "/path/demo.bcut" --kind text --text "Chapter 2" \
  --start 12 --end 16 --rect '50,15,60' --json
bin/baocut element add "/path/demo.bcut" --kind image --file "/path/chart.png" \
  --at-word g42.0 --role broll --mode pip --json
```

`--rect` is `x,y,w` in canvas percentages. A media file is registered as a
source; `--src <srcId>` reuses an existing source. For video/audio, use
`--src-start`, `--rate`, `--muted`, and `--volume` only when requested.

For normal B-roll defaults and role-safe operations:

```bash
bin/baocut broll add "/path/demo.bcut" --file "/path/cutaway.mp4" \
  --start 20 --end 26 --mode fullscreen --json
bin/baocut broll list "/path/demo.bcut" --json
bin/baocut broll update "/path/demo.bcut" <element-id-1>,<element-id-2> \
  --start 21 --end 25 --json
bin/baocut broll preview "/path/demo.bcut" <element-id> --output "/tmp/broll" --json
```

Add a full-duration watermark with exactly one of `--text` or `--file`:

```bash
bin/baocut watermark add "/path/demo.bcut" --text "ACME" \
  --rect '88,92,18' --opacity 0.55 --json
bin/baocut watermark add "/path/demo.bcut" --file "/path/logo.png" \
  --rect '90,90,14' --json
```

## Focused changes

```bash
bin/baocut element set "/path/demo.bcut" <element-id-1>,<element-id-2> \
  --x 52 --y 20 --w 48 --opacity 0.9 --json
bin/baocut element style "/path/demo.bcut" --id <element-id> \
  --patch '{"fontSize":48,"color":"#ffffff"}' --json
```

Use `--patch` only with fields confirmed by `spec.timelineSchema`; unknown or
kind-invalid fields are rejected. `element set`, `element remove`, `broll
update`, and `broll remove` accept one selector or a comma-separated list. Each
batch is one history transaction and is atomic: if any selector is missing,
ambiguous, duplicated, or has the wrong role, nothing is written. Removal is a
true deletion, so list and confirm every id first.

## Visual verification

```bash
bin/baocut frames "/path/demo.bcut" --at 12,15.9,16.1 \
  --tile --output "/tmp/demo-frames" --json
```

Inspect frames just before, during, and after an element window. Re-read the
element afterward; do not treat a successful write as proof of composition.
