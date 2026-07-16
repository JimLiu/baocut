# Subtitle text: inspect, find, replace, correct, retime, split, merge, hide, restore

Use `baocut subtitle` for deterministic edits to already-transcribed subtitle
rows. It is the supported alternative to hand-editing `doc.json`.

## Two address units

Original and translated text intentionally use different row grids:

- Original subtitles use derived **cue ids** such as `q-w123`.
- Translations use **group ids** such as `w123`, because one translated line can
  span several original cues. `--lang` is always the target language and switches
  `subtitle list/set` to this group grid.

Always obtain ids from the matching list command:

```bash
baocut --json subtitle list <pid>
baocut --json subtitle list <pid> --lang zh
baocut --json subtitle list <pid> --start 01:10 --end 01:30 --limit 20
baocut --json subtitle show <pid>                 # read-only alias of list
```

`subtitle show` never restores hidden rows. Mutations are explicit through
`subtitle restore`; use `show` safely for inspection.

Do not strip or add the `q-` prefix yourself. The CLI rejects a cue id combined
with `--lang` and a group id without `--lang`, with the exact recovery command.

## Correct text

```bash
baocut --json subtitle set <pid> q-w123 --text "Correct source text."
baocut --json subtitle set <pid> w123 --lang zh --text "修正后的译文。"
```

An original edit can change token ids and cue boundaries. Treat the JSON
`reindexed` array as authoritative and discard every cached cue id for that old
row. The result also reports `stale`, `staleLanguages`, and actionable `next`
commands. Staleness is computed from the saved document, not guessed in advance.

Editing a translated cell does not refresh its source stamp. If it was already
stale it remains stale, matching the GUI; decide explicitly whether to keep the
manual text or run the reported `task start translate … --stale-only` command.

Empty or whitespace-only `--text` is rejected. Hiding is the reversible way to
suppress a row.

## Find and replace

Use the editor's own matcher and mutation paths across four explicit domains:

```bash
baocut --json subtitle find <pid> --query "launch" --scope transcript
baocut --json subtitle find <pid> --query "launch" --scope subtitle --case-sensitive
baocut --json subtitle find <pid> --query "发(布|行)" --scope translation --lang zh --regex
baocut --json subtitle replace <pid> --query "colour" --with "color" --scope both --lang zh --whole-word --dry-run
baocut --json subtitle replace <pid> --query "colour" --with "color" --scope both --lang zh --whole-word
```

`transcript` searches paragraph text, `subtitle` searches original cue text,
`translation` searches one target language's group text, and `both` matches the
Translate tab's source-cue + target-group domain. Translation and both require
`--lang`; transcript is the default. Matching is literal and case-insensitive
unless `--case-sensitive`, `--whole-word`, or `--regex` is passed. Regex changes
only the matched ranges: `--with` is always literal and does not expand `$1`.

`find` is read-only and reports UTF-16 ranges plus bounded rows (`--limit`,
default 200). `replace` applies every match as one reversible manual version;
run `--dry-run` first when the scope or regex is broad. Source edits preserve
word timing and translation anchors, then report any `staleLanguages` and exact
stale-only refresh commands. Translation-only edits preserve the existing
source stamp, including pre-existing staleness. Re-run `find` after a source
replacement because paragraph, cue, and group ids may have been reindexed.

## Retime, split, merge cue rows

```bash
baocut --json subtitle retime <pid> q-w123 --start 01:10.2 --end 01:13
baocut --json subtitle split <pid> q-w123 --at 71.4        # nearest word gap
baocut --json subtitle split <pid> q-w123 --at w125        # AFTER that word
baocut --json subtitle merge <pid> q-w123 [--with next|prev]
```

- **retime** linearly remaps the cue's word times into the new window (pass
  `--start` and/or `--end`; the omitted one keeps its value). Text, cue ids and
  translations are untouched — overlapping a neighbour is only a `warnings`
  entry, and `audit` remains the timing gate.
- **split** cuts at a WORD boundary only (a time snaps to the nearest gap
  between words). The translation group stays whole, so translations are NOT
  invalidated; the first half keeps the old cue id.
- **merge** joins the cue with its neighbour (same speaker only; a speaker
  boundary is rejected). When the boundary is also a translation-group
  boundary, the two groups' translations join under the surviving group and
  that group flips `stale` for every stamped language — run the reported
  `next` stale-only re-translate command.

All three return the same JSON shape as `set`: treat `reindexed` as the
authoritative post-edit id list and discard every cached cue id in the touched
range (`removed` lists ids that no longer exist). Each change is one manual
version snapshot — `baocut version restore` undoes it.

## Hide subtitles without cutting media

```bash
baocut --json subtitle hide <pid> q-w123,q-w456
baocut --json subtitle hide <pid> --start 01:10 --end 01:30
baocut --json subtitle list <pid> --hidden
baocut --json subtitle restore <pid> q-w123
baocut --json subtitle restore <pid> --all
```

Time windows select cue midpoints. Hidden rows disappear from live subtitle
display, timed sidecars, and burned-in video, while audio and video continue
unchanged. Transcript Markdown remains literal because hiding a subtitle row is
not deleting transcript content. `subtitle restore` reverses the state and
every mutation creates a manual version snapshot.

This differs from `baocut cut`: a cut removes AV time and retimes later output;
subtitle hiding removes only text and never changes duration. Use `cut restore`
for AV cuts and `subtitle restore` for subtitle-only hiding.

Before delivery, re-run the completion gate for the requested mode and re-export
any sidecar or video made before a set/replace/hide/restore operation.
