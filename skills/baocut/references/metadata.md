# Project metadata: resolution, title, description, notes, speaker names

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

## Title, description, notes, speaker names — keep them real, proactively

Title + description ride into EVERY LLM stage as grounding context
(`--no-media-context` opts out); notes stay searchable beside the project and
preserve richer source facts. Keep them real:

- Know the content up front (the user described it, a video title, …)? Pass
  `--title`/`--desc` on `auto`/`transcribe` so the run's OWN polish/translate
  already have the context.
- `--json project show <pid>` returns `attention` hints when metadata is
  missing. Act on them, but do not treat the array as exhaustive: derived
  placeholder labels can be absent. On a speakers-on run, `speakers show` is
  the authoritative terminal check for real names.
- Backfilling: read the transcript (`export --markdown`, or what you already
  saw answering the analysis call — its summary is a ready-made source), then
  `baocut project edit <pid> --title "…" --desc "…" --notes "…"`. The
  description is 2–4 plain sentences on what the recording is about (people,
  products, topics) — background context, never copied into subtitles. Notes
  hold useful structured source facts, timelines, and links; do not dump page
  boilerplate. On an EXISTING project do this BEFORE `task start
  polish|translate`; after an `auto` run do it at terminal (the worker holds
  the project lock while running, so metadata edits must wait).
- For any webpage-backed URL, follow url-metadata.md before starting. A generic
  HTML5 extractor result is only a media locator, not proof that title, date,
  people, description, or chapters were captured correctly.
- Speaker naming is a DEFAULT step of every speakers-on transcribe/translate
  run, not just explicit speaker asks: "who the speakers are" is part of the
  analysis deliverable. At terminal, always run `speakers show <pid>` and map
  every placeholder to its turn before reporting. On URL imports, use both the
  extractor metadata and the verified page facts saved in project notes. A
  description or page that names the host/guests is prime evidence, and the
  concise title/description also ride into analysis. For each placeholder:
  1. Read the named people/roles in `project show` metadata.
  2. Inspect adjacent cues in that speaker's turn for self-introduction or
     direct address. Join consecutive same-speaker fragments mentally; names
     often follow split text such as "I'm cofounder" / "and CEO" / "Name".
  3. Run `baocut speakers propose-names <pid>` as a suggestion source, not a
     gate. It never applies a rename, and an empty list does not overrule the
     metadata/transcript evidence.
  4. Batch-apply high-confidence mappings in one save, for example
     `baocut speakers rename <pid> s1="Ada Lovelace" s2=Host`, then run
     `speakers show` again and report the final map.

  A single-speaker URL whose description names the speaker and whose transcript
  contains a matching self-introduction/role is high confidence without frame
  extraction. If the evidence conflicts or only names an off-screen/quoted
  person, leave the placeholder and report why. Finish naming before audit and
  final reporting, even if quality review later blocks another deliverable.
