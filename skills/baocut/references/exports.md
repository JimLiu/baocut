# Quality checks and exports

Run the target-aware quality gate first:

```bash
bin/baocut check "/path/demo.bcut" --strict --for mp4 --lang zh-Hans --json
```

Export examples:

```bash
bin/baocut export "/path/demo.bcut" --to srt -o "/path/demo.srt" --force --json
bin/baocut export "/path/demo.bcut" --to vtt -o "/path/demo.vtt" --force --json
bin/baocut export "/path/demo.bcut" --to ass --mode bilingual --lang zh-Hans \
  -o "/path/demo.ass" --force --json
# 一次生成 demo.zh-Hans.ass 与 demo.ja.ass
bin/baocut export "/path/demo.bcut" --to ass --mode bilingual --lang zh-Hans,ja \
  -o "/path/demo.ass" --force --json
bin/baocut export "/path/demo.bcut" --to json -o "/path/demo.json" --force --json
bin/baocut export "/path/demo.bcut" --to markdown -o "/path/demo.md" --force --json
bin/baocut export "/path/demo.bcut" --to mp4 -o "/path/demo.mp4" \
  --mode bilingual --lang zh-Hans --force --jsonl
# 只烧录译文；个别未翻译句组会回退原文，不会留下无字幕空档
bin/baocut export "/path/demo.bcut" --to mp4 -o "/path/demo.zh-Hans.mp4" \
  --mode translated --lang zh-Hans --force --jsonl
```

Editable project exports all consume one resolved OUTPUT-time plan:

```bash
bin/baocut export "/path/demo.bcut" --to premiere -o "/path/demo.xml" --json
bin/baocut export "/path/demo.bcut" --to resolve -o "/path/demo.fcpxml" --json
bin/baocut export "/path/demo.bcut" --to final-cut-pro -o "/path/demo.fcpxml" --json
bin/baocut export "/path/demo.bcut" --to shotcut -o "/path/demo.mlt" --json
bin/baocut export "/path/demo.bcut" --to kdenlive -o "/path/demo.kdenlive" --json
bin/baocut export "/path/demo.bcut" --to capcut -o "/path/demo.capcut" --json
```

`--start/--end` are OUTPUT times and rebase the exported project to zero. Use
`--no-subs`, `--no-texts`, `--no-broll`, `--no-watermark`, or `--no-audio` only
when the requested deliverable excludes those lanes. Read the returned
`blockers`, `warnings`, `omitted`, and `lossy` arrays. Do not claim full fidelity
or add `--allow-lossy` when any unsupported property remains; only continue
after the user explicitly accepts the reported loss.

CapCut folder export is portable and never overwrites an existing destination.
Direct installation is separate:

```bash
bin/baocut export "/path/demo.bcut" --to capcut --install --editor capcut --json
```

The install modes `--media reference|auto|copy` trade disk usage for media
portability. Do not choose a copying mode on the user's behalf. `--open` is an
explicit external side effect and requires the user's request.

SRT/VTT and MP4 share Subtitle Studio's current comma/period display option —
plain commas and periods in the original and the translation are hidden by
default for every language; switch the style pane to visible first when the
user wants verbatim punctuation. JSON/Markdown and the transcript always keep
the full text (see [studio.md](studio.md)).

Select `--mode original`, `translated`, or `bilingual`; translated modes require
`--lang`. In translated mode, sidecars and MP4 fall back each untranslated sentence
group to its source cues. `--lang` accepts a comma list; multi-language
text/JSON/MP4 exports insert the BCP-47 tag before the extension and preflight every
output before writing any of them. MP4 uses the same resolved subtitle render plan as
BaoCut's preview, so do not replace it with browser screenshots or native text overlays.
