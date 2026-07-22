# Export & open

## Open the Project in BaoCut

After the user confirms they want to open a completed Project, use the installed
app's URL scheme. Substitute the real project id; do not merely print the link:

```bash
open 'baocut://project/<pid>'
```

The URL opens an existing Project in either a cold or already-running BaoCut
app. If `open` reports that no application handles the URL (for example, an
older or unpackaged development build), fall back to
`baocut project open <pid>`. A running editor may ask the user to confirm before
switching projects.

## Export is opt-in

A bare "transcribe" / "translate" request ends with the completed BaoCut
Project. Report the project id and content-quality evidence, then ask whether
the user wants to open the Project or export translated/bilingual SRT, VTT,
ASS, Markdown, video, or an editable project for CapCut, Premiere Pro,
DaVinci Resolve, Final Cut Pro, Shotcut, or Kdenlive. Wait for that answer;
do not guess a format or create an artifact in advance.

For an explicit Markdown export, require the Project-mode content/structure
gate from SKILL.md; timed flash/CPS/width findings do not block it. For
SRT/VTT/ASS or captioned video, run the timed-delivery gate for the requested
target and parse `finish-check.ready` before exporting. The default check exits
0 for polling; `--strict` exits 2 when not ready, so only the strict form is safe
to shell-chain.

```bash
baocut export <pid> --srt --output out.srt          # --vtt / --ass · --speakers
baocut export <pid> --ass --no-style --output out.ass
baocut export <pid> --srt --translated --lang zh --output zh.srt   # translation only
baocut export <pid> --srt --bilingual --lang zh --output out.srt   # paired on source-cue timing
baocut export <pid> --markdown --output transcript.md  # --no-timestamps --no-speakers --no-chapters
baocut export <pid> --markdown --translated --lang zh --output zh.md   # or --bilingual
baocut export <pid> --video --output out.mp4 --res 1080  # --quality high · --format mp4|mov ·
                                                     # --lang zh · --compress ·
                                                     # --no-subs (clean video) · --no-texts (no title overlays)
baocut export <pid> --capcut --install --open          # CapCut 8.7 local draft (Beta)
baocut export <pid> --capcut --output out-capcut       # portable folder; media copied
baocut export <pid> --premiere --output edit-premiere.xml
baocut export <pid> --resolve --output edit-resolve.fcpxml
baocut export <pid> --final-cut-pro --output edit-final-cut-pro.fcpxml
baocut export <pid> --shotcut --output edit-shotcut.mlt
baocut export <pid> --kdenlive --output edit-kdenlive.kdenlive
```

## Editable editor projects (Beta)

All six targets share BaoCut's projected editable timeline: main video, source
in-points, reviewed cuts, constant speed, B-roll/image overlays, independent
audio, basic transforms/opacity, free text, watermarks, and
original/translated subtitle lanes. Unsupported visible element kinds block
the export; use `--allow-lossy` only after reviewing the returned `warnings[]`
and `omitted[]`. `missing-media` and `empty-output` always block.

Before a delivery, run the target-specific gate:

```bash
baocut --json finish-check <pid> --for capcut --lang zh --strict
baocut --json finish-check <pid> --for premiere --lang zh --strict
baocut --json finish-check <pid> --for resolve --lang zh --strict
baocut --json finish-check <pid> --for final-cut-pro --lang zh --strict
baocut --json finish-check <pid> --for shotcut --lang zh --strict
baocut --json finish-check <pid> --for kdenlive --lang zh --strict
baocut --json export <pid> --capcut --install --open --bilingual --lang zh
```

The single-file targets reference original media and never launch an editor:

```bash
# Premiere Pro: Final Cut Pro 7 XML
baocut --json export <pid> --premiere --output talk-premiere.xml

# Resolve: FCPXML by default; FCP7 is the explicit legacy interchange
baocut --json export <pid> --resolve --output talk-resolve.fcpxml
baocut --json export <pid> --resolve --interchange fcp7 --output talk-resolve.xml

# Final Cut Pro: current 1.10 by default, with an optional event name
baocut --json export <pid> --final-cut-pro --fcpxml-version 1.9 \
  --event-name "Interview" --output talk-final-cut-pro.fcpxml

# MLT-based targets
baocut --json export <pid> --shotcut --profile source --output talk-shotcut.mlt
baocut --json export <pid> --kdenlive --profile canvas \
  --bin-layout flat --output talk-kdenlive.kdenlive
```

The selector flags are mutually exclusive. The five single-file writers share
`--name`, `--start/--end`, `--lang`, `--translated`/`--bilingual`,
`--no-subs`, `--no-texts`, `--no-broll`, `--no-watermark`, `--no-audio`,
`--ratio`, `--res`, `--include-cuts`, and `--allow-lossy`. Omit the extension
and BaoCut adds the target's required one; supply the wrong explicit extension
and the command rejects it. Resolve legacy requires `.xml`, not `.fcpxml`.

Successful JSON returns `format`, `interchange`, `path`, `laneCount`,
`segmentCount`, `warnings`, `omitted`, and `lossy`. CapCut additionally returns
`capcutVersion`. Do not infer a format from the display name; the stable tokens
are `capcut`, `premiere`, `resolve`, `final-cut-pro`, `shotcut`, and `kdenlive`.

### CapCut-specific destination behavior

Install mode references original media by default. Add `--media copy` for a
self-contained installed draft. Folder export always copies and hashes media,
uses relative paths, and refuses to overwrite its destination. Transfer and
register a portable folder on another Mac with:

```bash
baocut --json capcut install ./out-capcut --open
```

Use `--drafts-dir DIR` only for a custom CapCut drafts root. Installation is
allowed while CapCut is running: BaoCut validates the draft in staging, then
publishes it as an atomic new folder without editing CapCut's project index.
Return to CapCut's home screen or reopen it if the draft does not appear
immediately. Installation remains version-gated to CapCut 8.7.x;
`--allow-untested-version` is an explicit compatibility override. `--ratio`
accepts `original` or `W:H`, and the usual range/content switches plus
`--no-subs`, `--no-texts`, `--no-broll`, `--no-watermark`, and `--no-audio`
select what transfers.

Subtitles and markdown share the three content modes: original (default),
`--translated` (translation only — untranslated cues/paragraphs fall back to
the source), or `--bilingual`. Both require `--lang`, and that translation must
already exist.

**Export-only style override.** `--style <styleId|name>` (SRT/VTT/ASS and
video, not markdown) renders THIS export with a saved style while the project
keeps its own look. A `--bilingual` sidecar and a video that burns a
translation need a `set` record; every other export takes a `line` record —
the CLI rejects a wrong-kind style instead of healing it. Resolve ids with
`baocut style list`; details in [styles.md](styles.md). Video also uses `--lang` for bilingual burn-in (`--trans-lang`
remains a compatibility alias). `--output` is canonical; `-o` remains shorthand.
Rows hidden with `baocut subtitle hide` are omitted from timed sidecars and
burned-in video without removing AV time. Transcript Markdown remains literal.
Read [subtitles.md](subtitles.md); restore rows before timed export with
`baocut subtitle restore` when they should return.

Timed-text translation-only SRT/VTT/ASS uses the translation model's own
groups and time spans: one target group is emitted once even when it covers
several source cues. A missing target falls back to the source text for that
whole group. Original and bilingual sidecars stay on the source-cue grid.

For exact target language `zh`, sidecar and burned-in subtitle presentation
share the PRC delivery policy: projected commas/periods become spaces when the
project Display toggle is on, deterministic wrapping is limited to two lines
of 32 visual cells, and glossary targets are kept indivisible. The stored
translation and Markdown export remain literal/editable. A punctuation-only
projected event is omitted (SRT numbering remains continuous); it is never
resurrected as a literal punctuation event.

Speaker names/labels are omitted on a project whose speakers were never
identified (M69 — `speakers show` says `"identified": false`); an explicit
`--speakers` prints a stderr note pointing at `speakers reidentify`.

## Clip a time range (video · subtitles · markdown · editable projects)

`--start A --end B` (seconds or `mm:ss`/`h:mm:ss`) exports just that window; the
output rebases to 0 (video `0…B−A`, sidecar cue #1 at `00:00:00`). Works with
`--video` (burn-in, incl. `--lang` bilingual), `--srt/--vtt/--ass`, and
`--markdown` (all incl. `--translated`/`--bilingual`).

Description timestamps ("36:44 - Build memory") are imprecise, so A/B are
**snapped OUTWARD** to the nearest silence / sentence boundary with a `--buffer`
pad (default 0.3s) so speech finishes — start moves back to the sentence it lands
in, end forward to the next pause (a time landing in a segment gap ends at the
prior speech, never bleeding into the next talk). The snap is printed; `--no-snap`
keeps A/B exact.

**Validate before rendering** — `--preview` writes composite PNG(s) (video
filmstrip · speaker bands · waveform · word labels · silence markers · requested
vs snapped cut lines) and exits without encoding. LOOK at them: confirm each cut
lands in silence / at a speaker change, then export (or adjust A/B, or
`--no-snap` with an exact time you read off the composite).

```bash
baocut --json export <pid> --video --start 36:44 --end 1:05:06 --preview --output /tmp/cut  # inspect first
baocut export <pid> --video --start 36:44 --end 1:05:06 --lang zh --output clip.mp4   # bilingual burn-in
baocut export <pid> --srt      --start 36:44 --end 1:05:06 --bilingual --lang zh --output clip.srt
baocut export <pid> --markdown --start 36:44 --end 1:05:06 --translated --lang zh --output clip_zh.md
```


## Edits at export (M79/M80)

Soft cuts and B-roll apply BY DEFAULT on every export: cut regions drop out
of the video, SRT/VTT/ASS timecodes retime to the edited output (a
wholly-cut cue is omitted with continuous numbering; markdown stays literal),
and B-roll composites between the picture and the caption burn-in.

- `--include-cuts` exports the full recording, cuts ignored.
- `--no-broll` skips compositing the attachments.
- `--start/--end` windows still address TIMELINE time; with cuts applied the
  output duration is the window's kept-span length.
- Sidecars exported before a cut/restore are stale — re-export after edits.
- Sidecars and videos exported before a subtitle set/hide/restore are also
  stale — re-export timed deliverables after subtitle-row edits.

The CLI rejects options that do not apply to the chosen output kind instead of
silently ignoring them. `--compress` is explicit and requires ffmpeg; omit it
for the normal single-pass encoder. `--preview` must be paired with `--video`.
