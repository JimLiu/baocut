# Subtitle Studio preview page

`bin/baocut` below means `"$BAOCUT_SKILL_ROOT/bin/baocut"`. This file covers
operating the browser preview; data structures, rendering algorithms, and
defaults live in code and are not duplicated here.

The page code is served live from this skill's `templates/` directory by
`bcut serve`; it is never copied into projects. After a skill update, a
browser refresh is enough to load the new page.

## Serving a project

Projects created with `project create` in the shared projects library are
registered globally and served automatically at `<url>/projects/<id>/` (see
[workflows.md](workflows.md)). For a project outside the library, mount it
explicitly:

```bash
bin/baocut serve --background
URL=$(bin/baocut serve --status | python3 -c 'import json,sys;print(json.load(sys.stdin)["url"])')
curl -fsS -X POST "${URL}__bcut/mount" -d '{"id":"<name>","path":"<abs project path>"}'
# page = ${URL}<name>/
```

## Service reuse

- All sessions share one server instance; never start a per-project or
  per-session server, and never hardcode a port — discover the real URL via
  `serve --status`. Open pages through that URL, not `file://`.
- When the page is unreachable, check `serve --status` first. If
  `running:false`, run `serve --background`: it starts a persistent server,
  waits for the health check, reuses a live same-root server on repeat runs,
  and restores prior mounts after a restart. Do not substitute shell `&` or
  `nohup`, and do not kill a port's owner without confirming the process.
- At every Agent task continuation, after an explicit model download, and
  before final handoff, run `serve --background` idempotently, re-read
  `serve --status`, and require HTTP 200 from the current project URL. If the
  port changed, discard the stale URL and report the newly discovered one.
- If `mount` returns 409 (id already used by another path), pick a different
  id instead of taking over an existing mount.
- Prefer reusing an existing browser tab with the same URL; without a built-in
  browser, report the URL to the user instead of opening an external one.

## Data boundary

- The project stores only Studio data, never page code.
- `transcript.json` and generated Studio data are CLI-managed; do not
  hand-edit them.
- Page edits live in a project overlay and are written back with
  `studio apply`.
- Styles are a display projection. The comma/period option also applies to
  SRT/VTT and MP4 for every language, but never rewrites the transcript,
  JSON, or Markdown exports. By default the preview and subtitle exports hide
  plain commas and periods in both the original and the translation while
  keeping question marks, exclamation marks, ellipses, and punctuation inside
  data tokens; switch "commas / periods" to visible in the style pane when
  the user wants verbatim punctuation.
- When the page and the CLI work at the same time, the CLI's conflict and
  skip reports are authoritative.

## Applying page edits

```bash
bin/baocut studio apply "/path/demo.bcut" --json
```

Apply pending page edits before running any polish, translate, or align
stage. After applying, read the JSON output's applied items, skip reasons,
and suggested actions; when an edit invalidates later AI results, re-run only
the affected stages as reported — never patch generated files directly.

## Page requests

Users may submit pending requests from the page. Handle only requests the
user explicitly initiated that are still pending; clear them through the
project's existing page/CLI flow when done. Do not fabricate requests or
bypass the CLI to rewrite the transcript.

## History and recovery

Prefer the page's history UI to restore a version, then run:

```bash
bin/baocut studio sync "/path/demo.bcut" --json
bin/baocut check "/path/demo.bcut" --json
```

Never restore, undo, or redo without an explicit user instruction.

## Video export from the page

The title bar's Export menu ("Export video · MP4") calls the current
`bcut serve` instance, burns the page's effective subtitle overlay, styles,
and animations into the project's source video, and downloads the result. The
CLI equivalent:

```bash
bin/baocut export "/path/demo.bcut" --to mp4 --json
```

Omitting `--mode` keeps the page's current original/translated/bilingual
mode; overriding a translated mode still requires `--lang`. Plain
comma/period visibility follows the page's current display option. MP4 export
uses the native media frameworks on macOS 14+ and Windows 11 (no libass
required); a single continuous main media exports directly, while cuts, speed
changes, or multi-segment/multi-source main tracks are first flattened with
the `ffmpeg` found on PATH. The first Linux release returns `unsupported`.

## Troubleshooting

- Page does not open: re-check the server and the project mount per
  "Service reuse".
- Media unavailable: check the media path with `project show`. For URL
  inputs, rerun the original `transcribe "<URL>" --project …` to reuse or
  complete the download. For a moved local file, relink it through BaoCut's
  project media entry point; do not hand-edit `project.json`.
- Timeline thumbnails missing: thumbnails need `ffmpeg` on the serve
  process's PATH (waveforms do not — they fall back to a pure-Rust decoder
  automatically); derived caches live in `<project>/cache/` and can be safely
  deleted — the page rebuilds them. An old serve process lacks these
  endpoints; restart serve to pick up the new binary (the page falls back to
  gradient placeholders on an old server, which is not a fault).
- Page content stale: run `studio sync`, then re-check the page.
- Edits not applied: run `studio apply` and read the skip reasons in the
  JSON.
- Video export fails: verify `project.json.media.path` still points to a
  readable video; for cuts, speed changes, or multi-segment/multi-source main
  tracks also confirm `ffmpeg -version` works on PATH. Audio-only projects
  cannot export MP4.
- AI stage issues: fall back to `project show`, `check`, and each command's
  returned `next` suggestions.
