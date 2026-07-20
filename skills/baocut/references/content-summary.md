# The viewer-first media card

Read this right before every TERMINAL user-facing media report that has usable
spoken or on-screen content. A WARN, FAIL, needs-review, or blocker verdict does
not suppress the card; put those quality facts before it. Omit the card only
for non-terminal progress, a run with no usable content, or code maintenance.

Base the summary on the verified transcript or translation. If the root has
not seen the content, inspect it read-only with `subtitle list` in the user's
language when available (otherwise the source), paging or sampling across the
full duration for long media. Never read worker prompt/answer files, export
solely to obtain a summary, or invent a number or claim that the content does
not support.

Build the metadata from already verified `project show` (including saved
source-page `notes`), `task report`, source, and subtitle evidence. For a
webpage-backed source, verify the page facts through url-metadata.md; do not
reuse a known generic-extractor timestamp or truncated description. Always
include title, source URL (or source filename for local media), duration
normalized to `MM:SS` or `HH:MM:SS`, and languages. For a
translation, translate the source title naturally into the target/user language
and show both as `<target-language title> / <source title>`; show it once when
the titles or languages are the same. Add only useful verified fields such as
creator/channel, publication date, named speaker or reliable speaker count,
chapter count, or subtitle languages. Omit unavailable fields and placeholder
speaker names rather than guessing.

On a speakers-on run, build the Speakers field only after the terminal
`speakers show` → evidence → rename → `speakers show` loop. A person named in
the description is useful identity evidence, but do not print that name as the
speaker unless it was mapped to the actual speaker id. If a high-confidence
mapping exists, finish the rename instead of silently omitting the field.

Put the metadata and introduction together in ONE fenced `markdown` code block.
Localize field labels and the introduction heading to the user's language:

````markdown
```markdown
# <target-language title> / <source title>

- URL: <canonical source URL>
- Duration: <MM:SS or HH:MM:SS>
- Languages: <source language> → <target language>
- Speakers: <verified names or count>
- <optional useful verified metadata>

## Video introduction

<3–5 short paragraphs>
```
````

For local media, replace `URL` with a localized `Source file` field. Keep
delivery/quality facts before the block and the next-step question after it.
Do not put project/task IDs, audit warnings, implementation details, or the
next-step question inside the media card unless the user explicitly asks.

Write 3–5 short, natural paragraphs in the user's language, suitable for a
social post unless they requested another style. Open from the reader's point
of view with what the media covers and its single most important takeaway. Use
the middle to explain only the background or terms needed, include one memorable
verified fact or number when the media has one, and naturally answer the one or
two reader questions that matter most: what this helps with, who can use it,
how it differs from the familiar alternative, or what it changes in practice.
End with a concise takeaway. Adapt the emphasis to the content; do not expose
this scaffold as headings, force every question into the answer, or default to
a formal report or application-scenario checklist.
