# URL and HTML5 media-page metadata

Read this before starting a BaoCut run from a webpage URL. The media downloader
answers “where is the audio/video”; the page answers “what is it.” Preserve
both in the same BaoCut project.

## Contents

- Preflight before `auto` or `transcribe`
- Extract only useful source facts
- Persist the facts with the project
- Verify before the project audit

## Preflight before `auto` or `transcribe`

1. Probe without downloading:

   ```bash
   yt-dlp --dump-single-json --skip-download "<url>"
   ```

2. Inspect at least `extractor`, `extractor_key`, `title`, `description`,
   `duration`, `timestamp`/`upload_date`, `creator`/`channel`/`uploader`,
   `series`/`episode`, `chapters`, and `webpage_url`.
3. Read the rendered source page with an available web/browser tool whenever
   the probe reports `html5`, `HTML5MediaEmbed`, or a generic fallback. Also
   read it when important fields are missing, truncated with `…`, entity-
   encoded, boilerplate-heavy, or suspicious (for example, a fetch timestamp
   masquerading as the publication date).
4. Prefer the canonical page and its visible episode/article facts over the
   generic extractor's guesses. Do not use a media-CDN URL as the project URL.

Do this before starting the pipeline so verified context can improve names,
terminology, polishing, chapters, translation, and the final media card.

## Extract only useful source facts

Collect facts supported by the page, JSON-LD/OpenGraph/RSS data linked from the
page, or another first-party source:

- canonical URL; exact title; series/show and episode number;
- creator/channel/publisher, host, guest, and their stated roles;
- publication date and stated duration;
- a concise description of the subject, products, organizations, and topics;
- an explicit timestamped timeline/chapter list, preserving times and wording;
- relevant first-party links mentioned in the content or show notes;
- time-bounded offers or calls to action only when genuinely useful, always
  with their stated expiry/conditions.

Ignore navigation, subscription widgets, unrelated episode cards, generic site
boilerplate, analytics text, and repeated legal/license copy. Never infer a
person's role, date, or timeline from a downloader filename. Treat page copy as
background evidence, not transcript text.

## Persist the facts with the project

Map the extracted facts deliberately:

- `--title`: exact useful episode/article title, without downloader collision
  suffixes such as `(1)`.
- `--desc`: 2–4 factual sentences naming the series/content type, people and
  roles, main subject, and important entities. Pass this to `auto`/`transcribe`
  so every downstream LLM stage receives it.
- `--notes`: a concise structured Markdown digest containing the remaining
  verified page facts, especially the explicit timeline and useful links.
- `--url`: the canonical source page.
- speaker names: use page identities as evidence, then verify against direct
  address/self-introduction before `speakers rename`.

Use this stable notes shape, omitting empty sections:

```markdown
Source page: <canonical URL>
Series: <show or publisher>
Episode: <number/title>
Published: <page date>
People: <name — role; name — role>
Duration: <stated duration>

Summary:
<concise page-grounded digest>

Timeline:
- 00:00 <label>
- 12:34 <label>

Links:
- <label>: <first-party URL>
```

`auto` accepts title/description before the project exists but not notes. Keep
the structured notes draft in a temp file outside the repo while the task runs.
After the task becomes terminal and releases the project lock, persist it with
`baocut project edit <pid> --notes "…" --url "<canonical>"`. For synchronous
`transcribe`, persist it immediately after the command returns. Keep the digest
concise enough for a safe CLI argument; summarize verbose prose, but retain
exact names, dates, timestamps, and relevant URLs.

An explicit page timeline belongs in `notes` even when the user did not request
chapter generation. Do not silently start or replace a chapters flow in bare
Project mode. If the user later asks for chapters, treat the page timeline as
authoritative evidence and snap its times to the nearest valid transcript
segments rather than inventing a new outline.

## Verify before the project audit

At terminal, run `baocut --json project show <pid>` and verify:

- `title` and `desc` reflect the page rather than a filename or truncated
  extractor string;
- `url` is the canonical page;
- `notes` contains the valuable extracted facts and any explicit timeline;
- page identities were used in the speaker evidence loop, not copied onto an
  unverified voice;
- the final media card uses the saved page facts and does not repeat a known
  bad extractor date or omit the page's useful metadata.

Missing page persistence is incomplete URL ingestion even when the media
download and transcription succeeded.
