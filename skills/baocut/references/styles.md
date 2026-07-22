# Subtitle styles

`baocut style` drives the same style library the app's picker shows: built-in
presets (code, immutable) plus the user's saved customs (shared storage — a
style saved in the GUI is applicable from the CLI and vice versa). Styles are
LOOKS: applying one never moves the subtitle on screen and never changes the
wrap/punctuation delivery policy.

Two record kinds, mirroring the app:

- **line** — ONE line's look: style + word animation + entrance. Built-in ids
  look like `HEADLINE`; customs like `lp-…`.
- **set** — a bilingual PAIR: both lines + order + gap + background mode.
  Built-in ids are `set-<presetId>`; customs `bs-…`.

Every command accepts a style id or a (unique, case-insensitive) name; a
built-in line and its derived set share a title, so pass `--kind line|set` or
use the id when a name is ambiguous. Always use ids when scripting.

A project styles two contexts independently: `sub` (the standalone original —
Transcript/Subtitle tabs, mono video) and `bi` (the bilingual stack —
Translate tab, bilingual export). `style current <pid>` reports both, with
`· edited` when the look drifted from the record it came from.

## Read

```bash
baocut --json style list [--kind line|set] [--custom]
baocut --json style show <styleId|name> [--kind line|set]   # full style schema
baocut --json style current <pid>
```

## Choose a style for a project

```bash
baocut style apply <pid> set-CHILL              # a set styles the bilingual stack
baocut style apply <pid> HEADLINE               # line → standalone original (default)
baocut style apply <pid> HEADLINE --ctx both    # line → both contexts; --ctx bi · --line trans
```

Single-line project (no translation planned): apply a line style, default ctx.
Bilingual delivery: apply a set, or steer lines individually with
`--ctx bi --line orig|trans`. Applying writes the doc (version snapshot
included) and the GUI picks it up live.

## Edit and save preferred styles

`style edit` changes the PROJECT's live look; `style save` keeps it as a
custom record; `style update` overwrites an existing custom. Built-ins never
change.

```bash
baocut style edit <pid> --patch '{"fontSize":40,"fontColor":"#FFD43B"}'   # schema = style show --json
baocut style edit <pid> --anim Color --transition magic-pop               # anims: None|Color|Highlight|Bounce|Paint|Reveal
baocut style edit <pid> --ctx bi --gap 10 --order orig --bg-mode shared   # stack knobs (bi only)
baocut style save <pid> --name "Brand look"              # whole bilingual pair (set)
baocut style save <pid> --kind line --name "Caption"     # one line (--ctx/--line steer)
baocut style update <styleId> --from <pid>               # re-capture from a project
baocut style update <styleId> --patch '{"fontSize":33}'  # direct field edit
baocut style rename <styleId> --name "…"
baocut style delete <styleId>                            # customs only; --json echoes the record
```

`--patch` merges over the current style and REJECTS unknown keys — read the
schema from `--json style show` first rather than guessing field names.
Transitions: `none | magic-fade | magic-pop | magic-flip`
(`--transition-speed 0-100`). The translation line cannot take `--anim` (no
per-word timing).

## Export-time override

`baocut export … --style <styleId|name>` styles one export without touching
the project — see [export.md](export.md) for the kind rules (bilingual → set,
otherwise line).

## Rules

- Applying/editing a style mutates the project document — the usual one
  mutating run per project applies (the project lock).
- Do not spend repair budget or re-run pipeline stages to change looks;
  styling is presentation, free to change any time, and never blocks Project
  completion.
- Choosing a style for the user unprompted is over-reach: apply one when the
  user asked for a look (or approved a suggestion), otherwise leave the
  default.
