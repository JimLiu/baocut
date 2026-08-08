# Core workflows

`bin/baocut` below means `"$BAOCUT_SKILL_ROOT/bin/baocut"`.

## Start a transcription/translation task

Always follow this order: create the project in the shared library, start the
preview server, then run the pipeline.

### 1. Create the project in the shared projects library

```bash
bin/baocut --json project dir
# → {"data":{"dir":"…/BaoCut/projects", …}}
bin/baocut --json project create "<dir>/My Talk.bcut" --media "/path/input.mp4"
```

`project create` registers the project globally, so the BaoCut App lists it
immediately. Keep the returned `data.project.id` — it is the preview route id.
For a video URL, pass the URL as `--media`; the pipeline downloads it later.

### 2. Start the preview server and share the URL

```bash
bin/baocut --json serve --background
bin/baocut --json serve --status
# → {"running":true,"url":"http://localhost:<port>", …}
```

The project page is `<url>/projects/<id>/` (tabs: `subtitle`, `transcript`,
`translation`). Open it in the agent's built-in browser to watch progress and
verify results, and print the same URL for the user — it works in any local
browser. `--background` manages the server lifecycle; never keep it alive with
shell `&`. Registered projects are served without extra flags; `serve --status`
reports the actual port when the default one was taken.

### 3. Run the pipeline

```bash
bin/baocut auto "<dir>/My Talk.bcut" --llm agent --jsonl
```

Add one or more translations:

```bash
bin/baocut auto "<dir>/My Talk.bcut" --llm agent \
  --lang zh-Hans --lang en --jsonl
```

For a video URL whose downloaded media must live in a specific directory, keep
the registered project created in step 1 but pass the URL again as the pipeline
input. Supply `--download-dir` on this first pipeline run:

```bash
bin/baocut doctor --url-only --json
bin/baocut auto "https://www.youtube.com/watch?v=…" \
  --project "<dir>/My Talk.bcut" \
  --download-dir "/path/to/downloads" \
  --llm agent --lang zh-Hans --jsonl
```

`auto` does not export. It resumes valid prior stages and protects manually
edited transcripts unless a force flag is explicitly selected. Progress events
stream on stdout and mirror into the project, so the App and the preview page
show the same live progress. URL connections use bounded yt-dlp retries; if a
CDN is unreachable the command now fails with a diagnostic instead of waiting
on operating-system TCP timeouts indefinitely.

## Explicit stages

```bash
bin/baocut transcribe "/path/input.mp4" --project "/path/demo.bcut" --jsonl
bin/baocut polish "/path/demo.bcut" --review --jsonl
bin/baocut review list "/path/demo.bcut" --json
bin/baocut review accept "/path/demo.bcut" polish --json
bin/baocut translate "/path/demo.bcut" --lang zh-Hans --review --jsonl
```

`transcribe` takes any container ffmpeg can decode and does its own 16 kHz mono
downmix, so never pre-extract a WAV. On a 9 GB / 96-minute 4K source that decode
costs about 34 s and reports continuous progress; the run is dominated by the
model instead. `--model moss-transcribe-diarize` measures around 5–6× realtime
on Apple Silicon (900 s of audio in 151 s) and is the only local model with
speaker diarization, so budget on the order of 20 minutes for a 96-minute
source. The default `qwen3-asr-0.6b` is several times faster without speakers.

Before accepting a review, inspect its diff and preview from `review list`. Use
`review reject` when the candidate changes meaning or timing intent.

Stage order is enforced, not advisory: a full first translation runs on the
polished transcript. If a polish candidate is still pending, `translate` stops
with a `conflict` envelope and hands you the `review accept` command — rerunning
polish there would burn the same tokens twice and still lose the candidate. If
the transcript was never polished and has no pending candidate, `translate`
polishes first on its own and reports `data.autoPrerequisites`. A hand-edited
transcript is translated as-is with a warning. Re-aligning (`--align-only`),
targeted reruns (`--sentences`), and incremental top-ups of an existing target
language are exempt, because polishing mid-stream invalidates translations that
already landed; `--no-pre-polish` opts out explicitly. An exemption suppresses
the block, not the notice: an exempt run still evaluates the gate and, when the
transcript is unpolished or a candidate is pending, reports it as a
`polish 前置:` entry in `data.advisories` while still exiting `ok`. Paragraph segmentation
costs no extra call — polish emits it in the same pass. `auto` stops on the same
pending candidate; accept it, or state an intent with `--polish` (discard the
candidate and polish again) or `--no-polish`.

The first translation for a target language creates
`ai/brief-<lang>.json`. Check its glossary before a large rerun; user edits to
the glossary or style guide are preserved while the transcript, analysis, and
instruction fingerprints still match. Set `locked:true` only for target terms
that must appear verbatim. Useful controls are:

```bash
bin/baocut translate "/path/demo.bcut" --lang zh-Hans --tone formal --jsonl
bin/baocut translate "/path/demo.bcut" --lang zh-Hans --no-brief --jsonl
bin/baocut translate "/path/demo.bcut" --lang zh-Hans --rebuild-brief --jsonl
```

`--no-brief` keeps the source-side analysis context but skips the bilingual
brief. `--rebuild-brief` deliberately replaces the editable brief from current
inputs; use it only after reviewing or backing up intentional glossary edits.
Tone is part of the brief cache key. Changing `--tone` also builds a fresh
brief, so back up intentional glossary or style-guide edits before changing it.

## Subtitle Studio

```bash
bin/baocut studio sync "/path/demo.bcut" --json
bin/baocut serve --background
```

The preview page code is served live from this skill's `templates/`
directory; projects store only Studio data. After browser edits, use
`studio apply` rather than editing generated projection files — and apply
pending page edits before starting any polish, translate, or align stage.
For a live transcript view during transcription, use the command's JSONL
output together with `studio sync --live-jsonl`. Run the command's `--help`
for the exact current arguments.

For service reuse, mounting out-of-library projects, page requests, history
recovery, punctuation display rules, and preview troubleshooting, read
[studio.md](studio.md).
