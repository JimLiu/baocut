# Core workflows

`bin/baocut` below means `"$BAOCUT_SKILL_ROOT/bin/baocut"`.

## Start a transcription/translation task

Always follow this order: preflight the environment once, create the project in
the shared library, start and verify preview, explicitly prepare a missing
model, re-check preview, run the pipeline, then verify preview once more.

### 0. Preflight once; request one install approval when needed

For URL inputs on Windows, calculate a read-only dependency plan first:

```powershell
& ".\bin\prepare-url-deps.ps1" -Mode Plan
```

If `packages` is non-empty, show that single combined plan and obtain explicit
user approval. Only after approval run:

```powershell
& ".\bin\prepare-url-deps.ps1" -Mode Install -Confirmed
```

The helper installs the smallest applicable winget package set, refreshes this
process's PATH, and treats the final `doctor --url-only` result as truth. A
winget “already installed/no upgrade” exit by itself is not failure. If the
user declines, stop and report the planned commands; do not continue the long
task. On other platforms, run `doctor --url-only --json` and request approval
before installing any missing external package.

### 1. Create the project in the shared projects library

```bash
bin/baocut --json project dir
# → {"data":{"dir":"…/BaoCut/projects", …}}
bin/baocut --json project create "<dir>/My Talk.bcut" --media "/path/input.mp4"
```

`project create` registers the project globally, so the BaoCut App lists it
immediately. Keep the returned `data.project.id` — it is the preview route id.
For a media URL, pass the URL as `--media`; video and audio-only sources are
both supported, and the pipeline downloads them later.

### 2. Start, verify, and share the preview URL

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

After reading the actual URL, require HTTP 200 from the project page. If status
or HTTP verification fails, rerun the same idempotent `serve --background`,
read status again, and use the newly reported URL. This is task-to-task
self-healing; do not register a Windows service or startup item.

### 3. Explicitly prepare a missing model

Read `model list --json`. When the selected model (default
`qwen3-asr-0.6b`) is not installed and verified, download it in its own
observable command before `auto`:

```bash
bin/baocut model list --json
bin/baocut model download qwen3-asr-0.6b --jsonl
```

The download preserves a valid partial when cancelled or disconnected and
reports resumed/network bytes. When it finishes—or whenever an Agent task is
continued—repeat step 2 and verify the project page before proceeding.

### 4. Run the pipeline

```bash
bin/baocut auto "<dir>/My Talk.bcut" --llm agent --jsonl
```

Add one or more translations:

```bash
bin/baocut auto "<dir>/My Talk.bcut" --llm agent \
  --lang zh-Hans --lang en --jsonl
```

Default-path rule: when the user has not named a download directory, use the
project-path form above and omit `--download-dir`. Never synthesize a sibling
`downloads` directory or an App Support path. Omitting the flag makes the CLI
honor the shared `download.dir` setting. When that setting is absent, Windows
uses the user's system Downloads known folder; other platforms fall back to
`<project>/media`.

Only when the user explicitly names a one-off directory, keep the registered
project created in step 1 but pass the URL again as the pipeline input and
supply that exact directory on the first run:

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

The CLI still auto-prepares models for direct `auto`/`transcribe` compatibility;
the explicit command above keeps a first multi-gigabyte download out of the
pipeline timeout window. After `auto` returns, repeat step 2 one final time and
hand off the verified current URL. For every URL-media run, also read the
authoritative downloaded video path and report that exact path to the user:

```bash
bin/baocut --json project show "<dir>/My Talk.bcut"
# → data.manifest.media.path
```

Use `data.media` directly when the terminal command was `transcribe`. Confirm
the path from command output even when the video was reused; do not infer it
from the title or merely say that the download completed.

## Explicit stages

```bash
bin/baocut transcribe "/path/input.mp4" --project "/path/demo.bcut" --jsonl
bin/baocut polish "/path/demo.bcut" --review --jsonl
bin/baocut review list "/path/demo.bcut" --json
bin/baocut review accept "/path/demo.bcut" polish --json
bin/baocut translate "/path/demo.bcut" --lang zh-Hans --review --jsonl
```

`transcribe` takes any common media container and does its own 16 kHz mono
downmix, so never pre-extract a WAV. Decoding prefers `ffmpeg` when present and
falls back to a built-in pure-Rust decoder (WAV/MP4/AAC/MP3/FLAC and other
common formats) when it is not, so do not install ffmpeg just to transcribe. On a 9 GB / 96-minute 4K source that decode
costs about 34 s and reports continuous progress; the run is dominated by the
model instead. `--model moss-transcribe-diarize` measures around 5–6× realtime
on Apple Silicon (900 s of audio in 151 s), so budget on the order of 20 minutes
for a 96-minute source. MOSS is the default so speaker labels are produced
without an extra flag; choose `qwen3-asr-0.6b` explicitly when speed matters
more than integrated diarization.

MOSS identifies speakers by default; use `--no-speakers` only when labels are
unwanted. On MOSS, `--speakers N` is an optional expected-count hint. Qwen and
Whisper use `--speakers N` to enable the separate `speaker-diarization` package —
Pyannote segmentation (~5.7 MB) plus WeSpeaker voiceprint embeddings (~26.5 MB),
about 32 MB total, both repos required — and N caps the number of voiceprint
clusters. The package is fetched alongside the main model during decode; with
`--offline` a missing package fails immediately with `invalid_arg` instead of
after the ASR pass, so pre-download it with
`bin/baocut model download speaker-diarization`.

Before accepting a review, inspect its diff and preview from `review list`. Use
`review reject` when the candidate changes meaning or timing intent.

A polish that exits `ok` is not necessarily a polish that touched every
sentence: `data.fallbackSentences > 0` (or `fallbackPages > 0`) means the
engine gave up on those sentences and kept the ASR text verbatim, and
`bcut check` reports them as the blocker `polish-fallback` with a
`bcut polish <project> --paragraphs <p-…>` fix that re-polishes only the affected
paragraphs (the artifact merges, so run the fix as many times as it takes and
recheck). Do not proceed to translate over a `polish-fallback` blocker; the
untouched sentences would be translated from raw ASR.

### Sync confirmed speaker names after polish

`polish` returns `data.speakerNames` as evidence-backed candidates; it does not
silently apply them. Do not finish a named multi-speaker task with `S01`, `s1`,
or similar placeholder labels when the available evidence can identify them.

For `--review`, accept the polish candidate before renaming speakers. Review
acceptance replaces the staged transcript, so a rename made first can be
overwritten by the candidate.

1. Retain `data.speakerNames` from the terminal polish/auto event, then run the
   current installed command as a fresh read after acceptance:

   ```bash
   bin/baocut speakers propose-names "/path/demo.bcut" --json
   ```

2. Verify each mapping against the candidate quote, project/source metadata,
   and speaker turns in the Studio transcript. A self-introduction, an
   explicit address followed by that speaker's response, or a unique
   first-person fact that matches the source metadata is usable evidence. A
   participant list, speaking order, voice-label number, or topic alone is not.
3. A `high` candidate may be applied only after its quote is checked. A
   `medium` candidate needs independent corroboration. An empty candidate list
   means the narrow automatic heuristic found no self-introduction; it does not
   waive the speaker review when the title or description names participants.
4. Diarization can split one person across multiple speaker ids. Assign the
   same real name to each id only when each mapping has evidence;
   `speakers rename` changes labels but does not merge voice clusters.
5. Apply every confirmed mapping in one command, then re-read state and verify
   the refreshed Studio preview:

   ```bash
   bin/baocut speakers rename "/path/demo.bcut" \
     "s1=Confirmed Name" "s2=Other Name" --json
   ```

Never guess an ambiguous identity. Leave its placeholder intact and report the
unresolved speaker id and the missing evidence to the user.

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
`ai/brief-<lang>.json`, and the same brief is also written as
the Markdown context document `ai/context.<lang>.md` (with `ai/context.md` on the
source side). That document — not the JSON — is what the next run reads back;
the JSON stays written so the app and every JSON-era reader keep working. Edit
the Markdown document, since that is what the next run will read.
Check its glossary before a large rerun; user edits to
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
Local transcriptions started through the shared service stream confirmed text
into Studio automatically. For a standalone JSONL command that is not supervised
by the service, use its output together with `studio sync --live-jsonl`. Run the
command's `--help` for the exact current arguments.

For service reuse, mounting out-of-library projects, page requests, history
recovery, punctuation display rules, and preview troubleshooting, read
[studio.md](studio.md).
