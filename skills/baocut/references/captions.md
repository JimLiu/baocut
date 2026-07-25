# Designed Captions

Designed Captions are BaoCut's native, seek-safe word-level motion layer. They
use the real transcript's stable word ids and timing, render identically in the
Stage and burned-video compositor, and never execute HTML, JavaScript, GSAP, or
a browser. They are orthogonal to `style`: static font/background/look stays in
the style slot; caption motion sits on top and `caption clear` restores the
unchanged Basic animation.

## Preconditions and boundaries

- The project needs a reliable original transcript with word timing. Karaoke
  exposes poor ASR timestamps immediately; when timing looks loose, align/fix
  the transcript before designing the motion.
- v1 animates original words only. `--line trans` is rejected. In a bilingual
  burned video, the original may animate while the translated line stays
  static; never fabricate target-word timing.
- SRT/VTT/ASS and editable-project exports cannot carry this motion. Deliver it
  through burned video. Sidecar subtitles remain ordinary timed text.
- Plans are scratch artifacts: write them to a temporary directory, never the
  repository or project package, and never edit `doc.json`.

## Catalogue and CJK selection

Always read the live catalogue first:

```bash
baocut --json caption catalog
baocut --json caption show caption-highlight
```

| Style | Best for | CJK |
|---|---|---|
| `caption-clip-wipe` | clean explainers, precise timing | good |
| `caption-highlight` | bright footage, educational/social | good |
| `caption-pill-karaoke` | friendly karaoke/read-along | good |
| `caption-neon-glow` | dark footage, music/tech | good; preview bright scenes |
| `caption-neon-accent` | punchy social/tech | good; preview bright scenes |
| `caption-gradient-fill` | polished brand/editorial | good |
| `caption-editorial-emphasis` | quotes, interviews, key claims | good with word-id emphasis |
| `caption-weight-shift` | restrained editorial rhythm | fallback: CJK often uses two weights |
| `caption-matrix-decode` | short tech reveals | fallback: CJK uses monospaced ideographs |
| `caption-particle-burst` | sparse hero moments | good |
| `caption-emoji-pop` | playful vertical/social | fallback: supply Chinese emoji overrides |
| `caption-glitch-rgb` | short tech/gaming hits | good; keep sparse |
| `caption-texture` | tactile editorial/brand | good |
| `caption-blend-difference` | changing light/dark footage | good |
| `caption-kinetic-slam` | one-word impact/full-screen beats | fallback; use short phrases |
| `caption-parallax-layers` | layered social/editorial | good |

For Chinese, do not use English stop-word/long-word heuristics as semantic
truth. The deterministic plan is only a draft; read the actual cue and choose
the meaningful phrase by stable word id.

## Parameters

- `--accent #RRGGBB`: brand/highlight/neon/particle color.
- `--intensity 0...100`: effect amplitude, not duration. Start around 55–65.
- `--speed 0.35...2`: duration multiplier; 1 is the authored rhythm.
- `--seed N`: freezes procedural glitch, matrix and particle geometry.
- Emphasis roles are `normal`, `emphasis`, and `hero`. Default one emphasis per
  group; hero is rare. Optional `color` and `emoji` belong to a word override.

## Required workflow

1. Inspect the catalogue and representative transcript cues. Shortlist two or
   three styles by tone, aspect, background and script; recommend one. If the
   user named a style, use it directly.
2. Generate a deterministic draft:

   ```bash
   plan="$(mktemp -t baocut-caption-plan).json"
   baocut --json caption plan <pid> caption-highlight \
     --accent '#FFD43B' --intensity 60 --output "$plan"
   ```

3. Edit only palette/tunables and a small number of entries in `overrides`.
   Preserve `wordId` and `anchorText`; never alter timing or copy transcript text
   into a second source of truth. Keep one emphasis per group and at most one
   hero per paragraph.
4. Apply, validate, and preview against real video frames:

   ```bash
   baocut --json caption apply <pid> --plan "$plan"
   baocut --json caption validate <pid>
   baocut --json caption preview <pid> --at auto --output /tmp/captions.png
   ```

   Look at the contact sheet. Check completeness, safe bounds, contrast,
   punctuation/CJK grouping, highlight plate fit and procedural restraint.
   Make at most one targeted correction, then repeat validate + preview.
5. For final burned delivery, run the normal timed-video gates, then export.
   `--caption` is an export-only override and does not mutate the project:

   ```bash
   baocut --json finish-check <pid> --for video --strict
   baocut export <pid> --video --caption caption-highlight --output out.mp4
   ```

`caption clear <pid> [--ctx both]` removes only the Designed Caption look. It
does not erase the underlying Basic word animation or document emphasis table.
The GUI's current-cue inspector clears only the listed cue, never hidden marks
elsewhere in the document.

## Validation and recovery

`caption validate` exits 0 when valid and 2 when invalid. It rejects missing or
unknown frozen recipe versions, translated-word animation, invalid timing,
orphan/stale word overrides, bad roles and missing bundled assets. Density and
contrast findings are warnings; `--strict` promotes them to blockers.

On a stale plan, regenerate it and reapply semantic selections. On a missing
recipe/asset, use an installed catalogue entry or update BaoCut—do not silently
degrade. On unsupported translated content, animate the original and leave the
translation static. Error-to-recovery literals also live in known-errors.md.
