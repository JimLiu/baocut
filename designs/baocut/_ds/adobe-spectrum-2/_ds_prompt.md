# Binding style: Adobe Spectrum 2

Anything drawn for `designs/baocut` follows this. It is a visual constraint, not a
suggestion — `check-conformance.mjs` fails the build on the parts a machine can see.

## Reach for a token, never a hex

Colors come from the block the artboard already carries (`--gray-*`, `--blue-*`, `--red-*`,
`--orange-*`, `--green-*`, `--yellow-*`). If a value you want is not there, it is either the
wrong value or a new stop to add to `tokens/artboard-tokens.css` — not a literal to paste in.

The one exception is **content**: a video still, a template thumbnail, a waveform's render
color, the traffic lights on the window chrome. Those are pictures, not chrome, and they get
declared with a reason in `_ds_conformance.json`.

## The scales

- **Type** 10 / 11 / 12 / 14 / 16 / 18 / 20 / 22 / 25 / 28 / 32 … — 14px is the UI default,
  12px the label size, 11px the floor. No half-pixels, no 13, no 15.
- **Control height** 20 (XS) / 24 (S) / 32 (M) / 40 (L) / 48 (XL). Checkbox and switch bodies
  use the small scale: 14 / 16 / 18 / 20.
- **Radius** buttons are pills; 8px is the control default, scaled down for smaller controls
  (XS 6, S 7) and up for larger (L 9, XL 10); cards, popovers and toasts 10; dialogs 16;
  checkbox 4.
- **Spacing** 4 / 6 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48.
- **Motion** 150ms `cubic-bezier(0.45, 0, 0.4, 1)`, color and transform only. Press adds
  `scale(0.96)`. No bounces, no slides, no infinite loops outside genuine progress.

## The feel

Layered flat neutrals — pasteboard → base → layer-1 → elevated-with-shadow. Almost everything
on screen is a gray; the accent blue marks the one action a screen is for. Status hues appear
as a 100/200 surface under a 900/1000 text, never as a saturated block. Hover moves one stop
along a scale. Shadows only on things that float. No inner shadows, no page gradients, no
blur, no emoji.

Headings are extra-bold and tight (1.3); body is regular and open (1.5). Copy is sentence
case, second person, verbs on buttons — and in this prototype, Chinese product copy that
follows the same restraint.
