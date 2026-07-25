# Element animation — entrances, exits, loops

Every animatable timeline element has exactly **three slots**: an entrance
(`in`), an exit (`out`), and a continuous `loop` that runs between them. The
three are time-exclusive — the loop only plays once the entrance has finished
and stops when the exit begins, so they can never fight over the same channel.

The preset catalogue is **frozen, not a user library**. Unlike `baocut style`,
there is nothing to save: a project stores the preset's id and version, so the
same document renders identically on every machine. Read elements.md first —
animation is addressed by the element ids `element list` prints.

## Strong rules — apply these before reaching for a preset

- **Never animate an element that is on screen for less than 0.6s.** Segments
  are squeezed so neither can exceed half the element's life, so a 0.5s
  entrance on a 0.8s element leaves the thing on screen at rest for a tenth of
  a second. It reads as a glitch, not as motion. Below ~0.6s, cut the animation
  or lengthen the element — do not shorten the animation to fit.
- **At most three looping elements on screen at once, and divide their
  strength.** Loops compete for attention and a screen of drifting objects
  reads as broken rendering. With N loops running together give each
  `--loop-strength` ≈ 1/√N (two loops → ~0.7, three → ~0.6). Prefer one loop
  on the element that matters and none on the rest.
- **To emphasise more, raise the strength — never stack presets.** There is one
  preset per slot by design. When an entrance is not punchy enough,
  `--in-strength 1.5`-style exaggeration is not available (strength is 0…1);
  instead pick a stronger preset (`pop`/`spin` over `fade`) or shorten the
  duration. Chaining two entrances onto one element is not expressible and
  faking it with a second stacked element is a bug, not a workaround.
- **Silence is a valid answer.** Subtitles, watermarks that must stay legible,
  and anything the viewer reads are usually better with no animation at all.

## Browse the catalogue — `animation list` / `show`

```bash
baocut --json animation list [--kind in|out|loop]
baocut --json animation show <presetId> [--kind in|out|loop]
```

- **in**: `fade rise drop slideL slideR pop zoomIn zoomOut spin blurIn` (0.4–0.55s)
- **out**: `fade sink rise slideL slideR shrink zoomIn zoomOut spin` (0.3–0.41s)
- **loop**: `float` (2.4s), `pulse` (2.0s), `sway` (2.8s), `jitter` (0.6s),
  `blink` (1.2s) — the period is one full cycle.

The slot catalogues differ: `drop` and `blurIn` are entrances only, `sink` and
`shrink` are exits only, and several ids (`fade`, `rise`, `spin`, `zoomIn`,
`zoomOut`, `slideL`, `slideR`) exist in both tables with different durations
and curves.
`show fade` with no `--kind` reports every table the id appears in. A preset
that is not in the named slot's table fails with `kind: "not_found"` — that
means "wrong slot", not "retry differently".

## Apply — `animation apply`

```bash
baocut --json animation apply <pid> --id <elId> --in rise --in-dur 0.5
baocut --json animation apply <pid> --watermark --in fade --loop float --loop-strength 0.6
baocut --json animation apply <pid> --screentext --in pop --out fade
baocut --json animation clear <pid> --all-text            # no flag = all three slots
baocut --json animation clear <pid> --id <elId> --loop    # just the loop
```

Selectors are the ones `element style` uses: `--id <elementId>` ·
`--manual` (title overlays) · `--screentext` · `--watermark` ·
`--all-text` (manual + screen-text). One selector per run; a batch run applies
the same preset to every match and the receipt lists the ids it touched.

**An element with no exit leaves by mirroring its entrance** at 0.75× the
duration — that is the default, not an absence. `--out none` is how you
suppress it; `--in none` and `--loop none` simply remove those slots. So
`--in rise` alone gives you `rise → sink`, and `--in rise --out none` gives you
an element that pops out of existence. An entrance with no counterpart in the
exit table names its own stand-in: `--in blurIn` leaves by `fade`, because
re-blurring on the way out reads as a focus pull rather than as an element
leaving.

Tuning flags: `--in-dur`/`--out-dur` (0.1–2.0s, snapped to 0.05),
`--loop-period` (0.2–6.0s), `--in-strength`/`--out-strength`/`--loop-strength`
(0…1, the panel's Strength slider), `--in-delay`/`--out-delay` (seconds).
Out-of-range values are **rejected, not clamped** (`kind: "invalid_arg"`), so a
receipt never reports a duration you did not ask for.

**Tuning never invents a slot.** `--in-dur 0.6` on an element with no entrance
changes nothing, and it will not freeze a derived exit into place either — a
mirrored exit keeps tracking its entrance, so lengthening the entrance
lengthens the exit with it. Pass a preset when you mean to create a slot.

## Shorthand — `element set`

```bash
baocut --json element set <pid> <elId> --anim-in pop --anim-in-dur 0.4 \
  --anim-out fade --anim-loop pulse --anim-loop-period 2
```

Same semantics on one element, mixable with the geometry/timing flags in the
same call. The strength and delay knobs and every batch selector live only on
`animation apply`.

## What can animate

Video, text, image, sticker and shape elements. **Audio lanes and motion
scenes reject animation flags** with `kind: "unsupported"` — there is nothing
to move. Subtitle cues are not elements: their per-word entrance is part of the
subtitle style (`baocut style`), not this group.

## Read it back, and what export does with it

`element list --json` carries an `anim` summary on every row, reported **as it
renders**: a duration left at the preset default shows the preset's own number,
and a mirrored exit is shown with `derived: true` rather than as nothing. The
human listing shows it as `anim rise→sink* · float`, where `*` marks the
mirror.

Animation is a BaoCut-side effect. **Video export bakes it in** — nothing is
lost. **Editable-project export does not carry it**: CapCut, Premiere,
Resolve, Final Cut, Shotcut and Kdenlive all receive static elements, and the
preflight warns per element with the slots it dropped (`"Logo": the animation
(in rise, out sink (mirrored), loop float) does not transfer to CapCut project
export`). Relay that list — it is what the person has to rebuild by hand in the
other editor.

Verify like any visual edit: re-read `element list`, and for composite proof
render stills with `broll preview --at t1,t2` — it composites every overlay
layer with the animation applied at that instant. Preview times are **timeline
seconds**, so to look inside an entrance take the element's own `start` and add
a fraction of the duration (`start` 12, `--in-dur 0.5` → `--at 12.15,12.35`).
A still at the element's midpoint proves geometry, not motion; one at `start`
exactly is the first frame of the entrance, where most presets are invisible.
