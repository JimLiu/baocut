# Project metadata: resolution, title, description, speaker names

## Resolving a project from natural language

Natural-language prompts may identify an existing project by its exact title,
ID, or any remembered content keyword. When no exact ID is supplied, resolve it
first with `project search`, then use the returned `projectId` for every
project-scoped command. In user-visible prompts and confirmations, keep the
project title and ID together (for example, `Launch plan (project ID: p42)`),
never as a detached ID at the end of the instruction.

Find a project by metadata or reconstructed document text before inspecting it
(`baocut --json project list` enumerates every project when you just need ids):

```bash
baocut --json project search "launch plan"
baocut --json project search "Claude Code" --limit 20 --match-limit 5
```

Search is case-insensitive and literal, matching the GUI across project/source
metadata, transcript, every translation language, chapters, speakers, and
on-screen text. Results are ranked like the GUI and report `total` separately
from the bounded `returned` project/match rows. For find/replace inside one
project, read subtitles.md; never hand-edit or globally rewrite `doc.json`.

## Title, description, speaker names — keep them real, proactively

Title + description ride into EVERY LLM stage as grounding context
(`--no-media-context` opts out), so keep them real:

- Know the content up front (the user described it, a video title, …)? Pass
  `--title`/`--desc` on `auto`/`transcribe` so the run's OWN polish/translate
  already have the context.
- `--json project show <pid>` returns `attention` hints when metadata is
  missing: a filename-ish title, no description, or placeholder "Speaker N"
  names. Act on them, don't just relay them.
- Backfilling: read the transcript (`export --markdown`, or what you already
  saw answering the analysis call — its summary is a ready-made source), then
  `baocut project edit <pid> --title "…" --desc "…"`. The description is
  2–4 plain sentences on what the recording is about (people, products,
  topics) — background context, never copied into subtitles. On an EXISTING
  project do this BEFORE `task start polish|translate`; after an `auto` run
  do it at terminal (the worker holds the project lock while running, so
  metadata edits must wait).
- Name the speakers the content identifies — batch form, one save:
  `baocut speakers rename <pid> s1="Ada Lovelace" s2=Host`. Only
  high-confidence names; evidence rules in speakers.md.
