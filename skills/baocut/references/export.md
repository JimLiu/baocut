# Export & open

## Export is opt-in

A bare "transcribe" / "translate" request ends with the completed BaoCut
Project. Report the project id and content-quality evidence, then ask whether
the user wants to open the Project or export translated/bilingual SRT, VTT,
ASS, Markdown, or video. Wait for that answer; do not guess a format or create
an artifact in advance.

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
baocut project open <pid>                          # open in the GUI for the user
```

Subtitles and markdown share the three content modes: original (default),
`--translated` (translation only — untranslated cues/paragraphs fall back to
the source), or `--bilingual`. Both require `--lang`, and that translation must
already exist. Video also uses `--lang` for bilingual burn-in (`--trans-lang`
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

## Clip a time range (video · subtitles · markdown)

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
