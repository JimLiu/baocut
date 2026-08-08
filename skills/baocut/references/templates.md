# Overlay templates and the data layer

A template (`bcutTemplate` 0.1) is a reusable foreground: caption slot, segment
rail, progress bar, station logo. It is a `.bctpl` directory that is installed
into a project and bound from `data.json`. One project binds at most one
template. The template never carries audio, camera, or caption content — only
layout and styling for the host's own captions and segments.

`data.json` (`bcutData` 0.1) is the project's data layer and the file you edit.
It holds render parameters and display overrides only: words, translations, and
cut intent stay in `transcript.json` / `timeline.json` and are still written by
BaoCut commands.

## Install and inspect

```bash
bin/baocut template list --project "/path/demo.bcut" --json
bin/baocut template install "/path/silicon101.bctpl" --project "/path/demo.bcut" --json
bin/baocut template lint "/path/demo.bcut/templates/silicon101.bctpl" --json
```

`install` copies the package into the project's `templates/` (use `--global` for
the cross-project library; same id, project wins). Ready-made packages live in
the repository's `examples/templates/`. `template pack` validates a package and
can copy a distributable clone; `template compile` regenerates `template.json`
from `template.bcut.tsx` and is only needed when you author a template.

## Bind it from data.json

```jsonc
{
  "bcutData": "0.1",
  "template": {
    "src": "silicon101",
    "params": { "logo": { "src": "assets/logo.svg" }, "accent": "#f26522" },
    "window": { "start": "8.0", "end": "120.0" }
  }
}
```

- `src` is a template id or a project-relative path such as
  `templates/silicon101.bctpl`.
- `params` must match the package's declared parameters; a missing or
  wrongly-typed parameter is a lint error, so read the package README first.
- `window` is optional and narrows the time range in which the template shows.
- Hand-editing the whole file is legal. Keep the `bcutData` key.

## Segments: the rail's data source

The rail reads a segment table, not chapters directly. With no `segments` key
the table is derived automatically — subtitle projects follow
`transcript.json` chapters through the timeline mapping, animated projects
follow their scenes — so cuts and retimes stay in sync with no extra step.

Materialize it only when you want to edit titles or add entries:

```bash
bin/baocut segments import "/path/demo.bcut" --json     # chapters -> linked entries
```

That writes `segments: [{ "from": "<chapterId>" }, …]`. Linked entries keep
taking their time span from the chapter at every compile, so there is no
re-sync step; add `"title"` to a linked entry to show a shorter label in the
rail without touching the transcript. A free-form entry is
`{ "title", "start", "end"? }` in output-timeline seconds (word anchors such as
`"~main:g3.7"` also work). Once `segments` exists it is the only source, so
`--force` is required to overwrite it.

## Minimal flow for a subtitle project

```bash
bin/baocut template install "<repo>/examples/templates/silicon101.bctpl" \
  --project "/path/demo.bcut" --json
# edit data.json: add the "template" object above
bin/baocut segments import "/path/demo.bcut" --json     # optional, only to edit titles
bin/baocut lint "/path/demo.bcut" --json
bin/baocut render "/path/demo.bcut" --t 12 --png "/tmp/tpl-12.png" --json
bin/baocut render "/path/demo.bcut" -o "/tmp/out.mp4" --json
```

Pass the project directory, not a single file: only that path carries
`data.json` and the template binding. `serve` shows the composited picture in
Studio and `render` writes it into the output; `frames` renders the timeline
picture without the template, so use `render --t … --png` to check a template.
Always confirm one frame before exporting — the rail, the caption slot, and the
logo are the three things worth looking at.

## Boundaries

- Never hand-edit `template.json` inside a package; it is a compile product.
  Fix `template.bcut.tsx` and recompile.
- Templates cannot reference host scene ids, cannot carry non-visual tracks, and
  must match the host aspect ratio in their `for` list; violations are lint
  errors, not warnings.
- Lint codes worth knowing: `template-param-missing` / `-type`,
  `template-aspect-mismatch`, `template-multiple`, `segment-orphan-link` (a
  linked chapter disappeared, entry dropped), `template-empty-segments` (no
  segments, so the rail is not rendered), `segment-title-overflow` (write a
  shorter `title` on the linked entry).
- Rendering stays a pure function of document and data, so one project plus
  several data files gives several branded cuts:
  `render <project> --data-file skins/clientA.json -o out/clientA.mp4`.
