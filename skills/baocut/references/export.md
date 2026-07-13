# Export & open

```bash
baocut export <pid> --srt -o out.srt               # --vtt / --ass · --speakers · --no-style
baocut export <pid> --srt --translated --lang zh -o zh.srt   # translation only
baocut export <pid> --srt --bilingual --lang zh -o out.srt   # paired on source-cue timing
baocut export <pid> --markdown -o transcript.md    # --no-timestamps --no-speakers --no-chapters
baocut export <pid> --markdown --translated --lang zh -o zh.md   # or --bilingual
baocut export <pid> --video -o out.mp4 --res 1080  # --quality high · --format mp4|mov ·
                                                     # --trans-lang zh · --compress ·
                                                     # --no-subs (clean video) · --no-texts (no title overlays)
baocut project open <pid>                          # open in the GUI for the user
```

Subtitles and markdown share the three content modes: original (default),
`--translated` (translation only — untranslated cues/paragraphs fall back to
the source), or `--bilingual`. `--lang` picks which translated language when a
project carries more than one (defaults to the first available).

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
`--video` (burn-in, incl. `--trans-lang` bilingual), `--srt/--vtt/--ass`, and
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
baocut --json export <pid> --video --start 36:44 --end 1:05:06 --preview -o /tmp/cut  # inspect first
baocut export <pid> --video --start 36:44 --end 1:05:06 --trans-lang zh -o clip.mp4   # bilingual burn-in
baocut export <pid> --srt      --start 36:44 --end 1:05:06 --bilingual --lang zh -o clip.srt
baocut export <pid> --markdown --start 36:44 --end 1:05:06 --translated --lang zh -o clip_zh.md
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
