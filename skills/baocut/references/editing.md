# Timeline editing

Keep the two edit layers distinct:

- `cut` writes reversible source-local omissions. Its plain `--start/--end`
  values are source time; `--view` opts into that source's cut-collapsed media
  view. `--words` avoids manual time conversion.
- `clip` arranges kept media on the OUTPUT main track. `clip add/trim --in/--out`
  use the source's cut-collapsed media view. `clip split --at` and export windows
  use OUTPUT time.
- `element`, `broll`, `watermark`, `animation`, `frames`, and `screentext` use
  OUTPUT time. Prefer `--at-word` when a visual must follow speech.

Never derive one clock from another yourself. Read mapped values and ids from
`cut list`, `clip list`, and `source list`.

Every committed edit is journaled. If a requested change must be rolled back,
inspect `project log`, then use `project undo` / `project redo`; use
`project restore <seq>` only after confirming the exact history entry. When
undo reports an external change, re-read the project and repeat only if that
external edit is also meant to be undone.

## Reversible source cuts

Preview automatic cleanup before committing it:

```bash
bin/baocut cut detect "/path/demo.bcut" --dry-run --json
bin/baocut cut detect "/path/demo.bcut" --json
bin/baocut cut list "/path/demo.bcut" --src main --json
```

Match spoken text on whole-word boundaries and inspect before applying:

```bash
bin/baocut cut match "/path/demo.bcut" --query "take that again" \
  --whole-word --dry-run --json
bin/baocut cut match "/path/demo.bcut" --query "take that again" \
  --whole-word --action cut --json
```

For a known source range or word span:

```bash
bin/baocut cut add "/path/demo.bcut" --start 12.4 --end 13.1 --json
bin/baocut cut add "/path/demo.bcut" --words 'g12.0..g12.3' --json
bin/baocut cut restore "/path/demo.bcut" <cut-id> --json
```

Use `cut restore --all --src <srcId>` only when the requested scope is explicit.

## OUTPUT clip arrangement

```bash
bin/baocut clip list "/path/demo.bcut" --json
bin/baocut clip split "/path/demo.bcut" --at 18.2 --json
bin/baocut clip add "/path/demo.bcut" --file "/path/insert.mp4" \
  --in 2 --out 9 --at-end --json
bin/baocut clip trim "/path/demo.bcut" <clip-id> --in 2.5 --out 8.5 --json
bin/baocut clip move "/path/demo.bcut" <clip-id> --before <other-id> --json
```

`clip remove` is a true main-track deletion, unlike `cut restore`; confirm the
target ids from `clip list` first. A file passed to `clip add` registers its
source. Use `source remove <srcId> --yes` only after `source list` proves nothing
still references it.

An appended spoken source has its own transcript:

```bash
bin/baocut clip transcribe "/path/demo.bcut" --src <srcIdA>,<srcIdB> --jsonl
```

`--src` 接受一个 source id，也接受逗号分隔的多个 id；批量转录只启动一次 CLI，
默认 Qwen/Whisper pipeline 在该命令内复用同一份 ASR、VAD 与对齐器模型（每个源仍重置
VAD 流状态），并在全部 source 写入后统一刷新 Studio 投影。

Do not pass `--model` unless the user asked to override their configured model.
After structural edits, re-run `clip list`, then inspect representative OUTPUT
times with `frames` before adding visual layers.
