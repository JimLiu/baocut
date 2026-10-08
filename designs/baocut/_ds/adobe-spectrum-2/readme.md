# Adobe Spectrum 2 — token import for `designs/baocut`

Machine-checkable Spectrum 2 source of truth for the BaoCut editor redesign prototype.
It carries **token data and geometry specs only** — no React bundle, no component CSS: the
artboards are `.dc.html` Design Components that inline everything they render, so what this
package has to provide is the *numbers* and a way to prove the artboards still match them.

## Sources

| Source | Pinned at | What was taken |
|---|---|---|
| [adobe/react-spectrum](https://github.com/adobe/react-spectrum) `packages/@react-spectrum/s2` | `@react-spectrum/s2@1.6.0`, commit `34b330d` (2026-08-24) | Control geometry, radius ladder, type roles, focus ring, motion — read out of `style/spectrum-theme.ts`, `src/style-utils.ts`, `style/index.ts` (copies in `_import/`) |
| [`@adobe/spectrum-tokens`](https://www.npmjs.com/package/@adobe/spectrum-tokens) | `14.15.0` — the exact version S2 1.6.0 depends on | Every color, spacing, radius, height and type value in `tokens/` |

Both are Apache-2.0. Adobe Clean, Spectrum's real typeface, is proprietary and is **not**
here: the artboards render Source Sans 3 (Adobe's own open-source face, same humanist
skeleton) and list Clean ahead of it only where a licensed host would pick it up.

## Regenerating

```bash
cd _import
npm pack @adobe/spectrum-tokens@14.15.0 && tar xzf adobe-spectrum-tokens-*.tgz
node generate-tokens.mjs package/dist/json/variables.json
```

Bumping the version is a design decision, not a chore: diff `tokens/artboard-tokens.css`
before and after, and expect to re-run the conformance check over every artboard.

## Checking an artboard against it

The embedded palette uses the same `light-dark()` pairs as `tokens/colors.css`.
Select `color-scheme: light dark` for system appearance, or `light` / `dark` for
an explicit preference. Keep video content and style specimens on `light` so UI
appearance does not recolor user content. Regenerate the embedded block through
`_import/generate-tokens.mjs`; do not maintain a separate dark palette by hand.

```bash
node _ds/adobe-spectrum-2/check-conformance.mjs canvas/*.dc.html
```

It enforces four things and advises on a fifth:

1. **Token block** — every artboard embeds `tokens/artboard-tokens.css` verbatim between
   `/* @ds tokens: adobe-spectrum-2 */` and `/* @ds end */`. A published artboard has no
   network egress and cannot link a stylesheet, so the system travels inside the file and
   the checker diffs it back.
2. **Color** — every hex literal is a Spectrum token value, or is declared with a reason in
   `../_ds_conformance.json` (media stills, demo art, OS chrome).
3. **Type** — every `font-size` sits on the S2 ramp: 10 / 11 / 12 / 14 / 16 / 18 / 20 / 22 / 25 …
4. **Radius** — every `border-radius` sits on 0 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 10 / 16, or is a pill.
5. *(advisory)* **Control height** — rules that look like controls (radius + horizontal
   padding) whose height is off 20 / 24 / 32 / 40 / 48.

Any single line opts out with a stated reason, written on the line itself or the one
above it: `/* @ds-allow: it draws the macOS window, not an S2 surface */`.

## The rules the numbers don't carry

- **Shape**: buttons are pills; controls, fields and action buttons 8px; cards, popovers
  and toasts 10px; dialogs and modals 16px; checkboxes 4px. Nothing is square.
  (`Card.tsx` borderRadius `lg`, `Modal.tsx` `xl`, `Toast.tsx` `lg`.)
- **Press**: next color stop plus `scale(0.96)`. This press-down is an S2 signature.
- **Hover**: the colour moves exactly one stop along its scale (gray-100 → gray-200,
  accent-900 → accent-1000). Quiet surfaces gain a gray-100 fill.
- **Focus**: 2px `--focus-ring` outline with 2px offset — `outline`, never `box-shadow`.
- **Weight**: headings extra-bold 800, button labels bold 700, control labels medium 500,
  body regular 400. Line height 1.3 for UI, 1.5 for body.
- **Color restraint**: almost everything on screen is a gray. Accent blue marks the one
  action; the other hues are for status, badges and data-viz. No page-level gradients —
  gradients belong to media thumbnails and the `premium`/`genai` buttons only.
- **Icons**: S2 ships its own workflow set (`s2wf-icons` upstream, 20×20 grid, ~1.5px
  strokes drawn as fills, rounded terminals). This prototype draws its icons inline in that
  style instead of importing the set — a registered deviation, see `_ds_conformance.json`.
- **Copy**: sentence case, verbs on buttons, second person, no emoji in product UI.

## Index

| Path | Contents |
|---|---|
| `tokens/artboard-tokens.css` | The block artboards embed — the only file they consume |
| `tokens/colors.css` | Full palette, 19 hues, `light-dark()` pairs |
| `tokens/semantic-colors.css` | Aliases (`--accent-background-color-default`, status colors, shadows) |
| `tokens/layout.css` | Spacing, radii, border widths, control heights, icon sizes, focus ring |
| `tokens/typography.css` | Families, weights, line heights, the 10→73px ramp, role sizes |
| `tokens/tokens.json` | Flat machine-readable map — what the checker measures against |
| `components/control-geometry.json` | Control heights, radius ladder, type roles, motion, press — each with the S2 symbol it came from |
| `check-conformance.mjs` | The checker described above |
| `_import/` | Upstream sources as fetched, plus the generator |
