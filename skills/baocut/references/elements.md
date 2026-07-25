# Timeline elements & watermarks (M110)

The unified element model: every overlay is a `TimelineElement` on a track —
Media/B-roll (`tr-broll`), text overlays (`tr-text`), one track per watermark
(`tr-wm-*`), free sticker/shape lanes (`tr-el-*`), audio lanes (`tr-au-*`).
The subtitle track and the main video are NOT elements: subtitles are managed
by `baocut subtitle` / `baocut style`, the main video by `baocut cut`.

## Inspect — `element list`

```bash
baocut --json element list <pid>
# → rows: {id, kind, role, track, start, end (null = video end), x/y/w,
#          scale, rot, opacity, fx, mask, mode, text/name/path, hidden}
```

Always list first — every edit below is addressed by the element `id`.

`element set` / `element remove` also accept a **unique id prefix** or a
**unique element name** (case-insensitive) in place of the full id, so a CLI-
minted id like `el-mfz3k9q1a0q7x` can be typed as `el-mfz`. Resolution order is
exact id → unique prefix → unique name. A token matching several elements fails
with `kind: "ambiguous"` rather than picking one; the message reports the match
count and a few example ids (not all of them — a captioned project carries one
text element per line, so matches run into the hundreds). Narrow it with a
longer prefix or the full id. Track ids (`tr-wm-el-101`) never resolve; address
the element, not its lane.

## Edit anything — `element set`

```bash
baocut --json element set <pid> <elId> --x 30 --y 70 --scale 1.2 --rot -5
baocut --json element set <pid> <elId> --opacity 0.4 --hidden on
baocut --json element set <pid> <elId> --start 12 --end 20     # or --end none
baocut --json element set <pid> <elId> --grayscale on --blur 3 --brightness -0.2
baocut --json element set <pid> <elId> --mask ellipse          # or none
baocut --json element set <pid> <elId> --volume 0.5 --muted off
baocut --json element set <pid> <elId> --text "@newname"       # text elements
```

Flags are **capability-gated** per element kind (the app's own rules): fx/mask
apply to video/image only, volume/muted to video/audio, text to text elements;
a wrong flag errors with the kind named — that error means "wrong element",
not "retry differently". `--end none` (= to the end of the video) exists only
on watermark/sticker/shape/audio lanes; Media and text overlays need concrete
ends. B-roll placement fields beyond these (PiP rect, fit, bg, src-start)
stay on `broll update`.

`element set` also carries the animation shorthand (`--anim-in pop
--anim-in-dur 0.4 --anim-out fade --anim-loop pulse`); the catalogue, batch
selectors and strength knobs are `baocut animation`. Read animation.md before
using either — it opens with the rules for when NOT to animate.

## Remove — `element remove`

```bash
baocut --json element remove <pid> <elId>    # drops its lane when it empties
# → {projectId, removed, kind, trackRemoved}
```

`removed` is the element's own id, not the token you passed — when a prefix or
name resolved it, that field is how you learn which element actually went.

## Watermarks — `watermark add`

```bash
baocut --json watermark add <pid> --text "@yourname" [--x 85 --y 10 --w 22]
baocut --json watermark add <pid> --file logo.png --x 15 --y 15 --w 12
baocut --json watermark add <pid> --text "内部资料" --tile on --opacity 0.3
```

- **Never use a watermark to translate text already visible in the video.**
  Slides, signs, labels, lower-thirds and burned-in captions belong to the
  `screentext` queue. If OCR misses a visible label, use `screentext insert`
  with explicit geometry and timing; see screentext.md.
- Text items get the GUI's signature look (transparent background, slim
  stroke); font/color edits are panel/prototype work, not CLI flags.
- Image assets are copied into the project (`media/watermark/`), so the
  source file can be a temp path. Non-image files are rejected.
- Defaults: top-right (85/10), w 22%, opacity 0.6, whole video; `--start/--end`
  makes it timed. `--tile on` repeats the stamp across the frame.
- Everything after creation is `element set` / `element remove` on the
  returned id (one watermark per lane; role `watermark` in `element list`).

## Verify like any visual edit

An exit-0 set is not proof. `element list` re-read is the state check; for a
composite proof render a frame the same way B-roll verification does:
`export --video --start A --end B --preview` (or `broll preview --at t`, which
composites ALL overlay layers, watermarks included). The GUI picks up CLI
writes live — never ask the user to close it.
