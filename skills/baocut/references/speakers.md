# Speakers: review & fix identification

Diarization is good but not perfect, so speaker labels are inspectable and
correctable. These are plain synchronous commands (no LLM, no task loop).
"Fixing speakers" means BOTH: correct WHO speaks WHEN (boundaries/clusters)
AND write real names back for the voices you can identify — see "Naming
speakers" below; the job is not done until both are handled.

Work through THREE LAYERS of evidence, cheapest first:

```bash
# 1. TEXT — the reading surface: per-speaker stats + turn-by-turn excerpts.
#    Turns carry firstCue/lastCue ids; --cues lists every cue with its id —
#    use cue ids for assign, they are exact where time ranges leave
#    boundary-word residue.
baocut --json speakers show p7                     # [--turns N] [--cues]

# 2. PICTURE — waveform + speaker-band diagnostic PNG. Band A = current labels;
#    --rerun adds band B (fresh diarization) with disagreements boxed red and
#    low-confidence (embedding-ambiguous) ranges shaded orange. --rerun also
#    returns the from→to move matrix + large-move warnings and the exact
#    dispute/ambiguity times in the JSON. Read the PNG, zoom with --start/--end.
baocut --json speakers view p7 --rerun --count 2   # global diagnosis first
baocut --json speakers view p7 --start 4:10 --end 5:30   # zoom a disputed spot
baocut --json speakers view p7 --proposal sp-xxx   # band B from a stored proposal

# 3. VIDEO FRAMES — see WHO is on screen at the disputed/ambiguous times.
#    A drill-down, NOT a scan tool: sample the decision points view/show gave
#    you, never loop over every cue. --json frames key their time as "t".
baocut --json frames p7 --at 251,257.5 --size 480
baocut frames p7 --start 250 --end 260 --count 4 --tile   # one contact sheet
```

view vs frames — pick by the question: a BOUNDARY/cluster question ("where's
the cut", "does this bit cluster with s1 or s3") is what `view` answers
(waveform + bands); an IDENTITY question ("who IS this", "is the on-screen
person the host") needs `frames` (faces). For an ambiguous-voice fragment,
zoom `view --rerun --start/--end` there before reaching for frames.

When to skip a layer: if the user asked for a re-identification anyway, you
may go straight to `reidentify --review` — its change matrix + dispute images
cover most of what `view` would tell you. Still run `view --rerun` first when
you have NOT decided the parameters yet (it shows cluster structure and
ambiguity globally, which is how you pick --count/--sensitivity instead of
guessing). Never skip layer 1.

**Name the voices the content identifies (M81).** `baocut speakers
propose-names <pid>` reads self-intro ("我是宝玉"/"I'm Ada") and invitation cues,
cross-checks the captured names against the analysis `namedEntities`, and prints
apply-ready `speakers rename` commands with per-candidate evidence
(cueId + quote + confidence). It NEVER auto-applies — verify (show/view/frames)
before renaming. It is a narrow heuristic, not the identity authority: an empty
candidate list can mean the self-introduction was split across cues or phrased
as a role plus name. Always inspect `speakers show` plus project metadata before
concluding that a placeholder is unknown. The naming job is not done while
`speakers show` still lists a high-confidence "Speaker N" identity; do not rely
on `project show.attention` to surface it. On a default transcribe/translate run
this check runs at terminal whenever identification ran. Applying NOTHING is a
valid outcome only when the combined evidence remains ambiguous — naming is
best-effort, never a completion gate.

Then fix what you found — atomic edits for spot problems, a re-run for
systemic ones:

```bash
baocut speakers propose-names p7                   # suggest names from the transcript
baocut speakers rename p7 s2 "Interviewer"
baocut speakers merge p7 s3 s1                     # s3 was really s1
baocut speakers assign p7 --speaker s2 --cue q-g12.0,q-g13.0   # precise (from show)
baocut speakers assign p7 --speaker s2 --start 251.2 --end 254 # or a time range
baocut speakers assign p7 --speaker new:Audience --cue q-g44.0 # create a voice
```

Re-run diarization only — transcript text untouched; matched clusters KEEP
their current ids/names, extra voices appear as new speakers. Constraints
express intent so the model can't undo what you already know:

```bash
baocut --json speakers reidentify p7 --count 3     # applies directly:
#     returns {applied:true, wordsChanged, folded, structure} and NO proposalId
#     (M81 — it already applied; do NOT then run `speakers apply`). --review is
#     the ONLY mode that stores a proposal to apply later. `folded` lists tiny
#     0-airtime speakers dissolved into their nearest neighbor.
baocut --json speakers reidentify p7 --count 3 --review --summary
#   --review stores a proposal and returns {proposalId, matrix, warnings};
#   --count 3,4,5 (with --review)  ONE proposal per value from a SINGLE
#                           diarization — the cheap way to compare counts
#   --summary omits per-cue rows (--limit-changes N caps them instead)
#   --protect s1,s2,s3      never relabel these speakers' words — "keep the
#                           main voices, only clean up fragment speakers"
#   --min-new-speaker-seconds 2   fresh voices below this fold into the
#                           nearest existing speaker (default 2)
#   --seed s1=Jet,s3="Xie Miao"   set names in the same run
```

The slow pyannote pass is CACHED per (audio, sensitivity) for the session, so
a comma sweep, a repeat run, and a `view --rerun` then `reidentify` all pay it
ONCE — separate count experiments at the same sensitivity are near-instant.

READ THE MATRIX AND WARNINGS before applying. The output aggregates changes
into from→to buckets ("s3 → s1: 142 cues, 08:03") and warns on any bucket
that moves ≥30s or half a speaker's airtime — that is exactly the "two
similar voices got merged" failure mode. When a warning fires, verify with
`frames` at a few moved cues before you apply, or re-run with `--protect`.

Comparing parameter runs — proposals are ID'd and coexist:

```bash
baocut --json speakers reidentify p7 --count 3,4,5 --review --summary  # one pass, 3 proposals
baocut speakers proposals p7                       # list (params, changes, stale)
baocut speakers proposals p7 sp-aaa                # one proposal in full
baocut speakers proposals p7 sp-aaa sp-bbb         # per-cue disagreement diff
baocut speakers apply p7 --proposal sp-bbb         # land the winner
```

Applying — or ANY command that relabels words (assign/merge/reidentify
direct) — clears all stored proposals: they were computed against labels that
no longer exist.

## Re-identifying a polished/translated project (M69)

Translated docs are SAFE to re-identify — no re-translation happens. Every
relabeling command (reidentify/apply/merge/assign) is structure-preserving:
proposed boundaries snap to existing cue/translation-line ends; a boundary
that vanishes (speakers merge) gets its line boundary pinned so translations
keep their keys; a NEW boundary landing inside a translated line splits that
line's translation deterministically at sentence/clause seams (re-stamped
fresh — never falsely "stale"). The output reports it all:

```json
"structure": { "pinnedEnds": 3, "paraPinsAdded": 1, "groupsSplit": ["g12.0"],
               "translationsSplit": { "zh": ["g12.0", "g12.7"] } },
"next": ["baocut task start align p7 --lang zh --groups g12.0,g12.7 — LLM re-split of the machine-cut translations, no re-translation"]
```

Machine-cut splits are correct but mechanically seamed — when
`translationsSplit` is non-empty, run the `next` hint (the M68 align-only
flow) to give just those lines an LLM-quality re-split. `merge` is the
historically worst offender on translated docs (it fuses every adjacent turn
of the two speakers); it now reports and preserves the same way.

## Unidentified projects (M69)

A doc transcribed with `--no-speakers` (or after a speaker-model failure)
carries `"identified": false` in `speakers show` / `speakersIdentified: false`
in `project show`, hides speaker heads in the GUI, and omits speaker labels
from every export until identification runs. `project show` raises an
attention hint pointing at `speakers reidentify` (skipped when the user
explicitly opted out). Renaming a speaker also marks the doc identified —
naming a voice is an identity assertion.

Rules of thumb:
- `reidentify` relabels every non-protected word. Use `--review` when the
  project may carry manual speaker edits worth keeping; use direct mode on a
  fresh transcription.
- If the CURRENT split already cleanly separates similar-sounding voices (two
  male leads, a host + guest of the same register), a blind low-`--count`
  re-diarization will RE-MERGE them — the classic failure. Check with `view
  --rerun` (or a `--review` matrix): a big s3→s1 bucket means the fresh run
  merged them. When that happens, DON'T re-diarize wholesale — `--protect` the
  good voices and let reidentify only clean up the fragment speakers (or fix
  the fragments with `assign`). A fresh full re-diarization is for a genuinely
  bad current split, not a good one with a few stray fragment cues.
- A tiny "Speaker N" fragment can be a MIXED cluster (two real voices in one) —
  folding it whole sends it to the majority voice, so after reidentify verify
  its cues in `show` and `assign` the odd ones out (frames confirms identity).
- `--count N` (2–5) helps a lot when the user told you how many voices there
  are; `--sensitivity conservative|balanced|aggressive` trades split/merge.
- Cap the fix loop: if labels still look wrong after ~3 rounds of
  view → frames → fix, report what you see to the user instead of looping.
- Every mutating speakers command snapshots a version first — mistakes are
  recoverable in the GUI's version history.

## Naming speakers

After speaker boundaries/clusters are fixed, assign human-readable names when
identity is supported by clear evidence. Speaker identification is NOT
complete until the obvious main speakers are renamed.

Evidence sources, strongest first:
- on-screen lower thirds, titles, or video branding (via `frames`)
- the project title/description — URL imports (YouTube etc.) auto-seed them
  from the video's own metadata, which often names host and guests outright;
  read them (`project show`) before hunting the transcript (the video's
  channel/uploader also rides the LLM prompt context, so channel names
  surface in the analysis `namedEntities`)
- direct address in the transcript, e.g. "Xie Miao, how are you?"
- stable role evidence, e.g. a host introduction or recurring host name
- visual confirmation from `frames` when needed

Treat consecutive same-speaker cues inside one turn as one introduction. A
sequence such as "I'm cofounder" → "and CEO" → "Zhengyao Jiang" is direct
self-identification even though no individual cue matches "I'm <name>". For a
single-speaker URL, a metadata `Speakers` entry plus a matching transcript role
or self-introduction is sufficient to rename without frames. Conversely, a
name appearing only in metadata or quoted speech is not enough when several
on-screen voices could match it.

```bash
baocut speakers rename p7 s1="Jet Li" s3="Xie Miao"   # batch: one save
baocut speakers rename p7 s2 "Interviewer"            # classic single form
# or fold naming into the reidentify run: --seed s1="Jet Li",s3="Xie Miao"
```

Naming is part of every job, not just explicit speaker asks. Run `speakers
show` at terminal even when `project show.attention` contains no speaker hint;
when the transcript, title/description, or frames identify a voice with
confidence, rename it proactively. `propose-names` returning no rows does not
cancel that obligation.

Rename only high-confidence speakers. Do NOT invent names for ambiguous,
tiny, off-screen, dubbed, or clip-only voices — leave them "Speaker N", or
rename generically only when useful (e.g. "Film clip voice"). Your final
response must list which speakers were renamed and which were left unnamed,
with the evidence for each name.

## Before reporting done

- On every speakers-on run, run `speakers show` and verify the main speakers'
  turns and names, regardless of `project show.attention`.
- Rename high-confidence main speakers (see above); leave uncertain short
  voices unnamed.
- Re-run `speakers show` after renaming; do not report a metadata name that was
  never mapped onto a speaker id.
- Report the final speaker map: id → name → rough duration/cues, plus any
  ranges you could not resolve.

Anti-patterns: don't extract frames for every cue (drill down only where
show/view flagged a dispute); don't run two mutating commands on one project
concurrently (the activity lock will refuse anyway); don't re-transcribe to
fix speaker labels; don't compare parameter runs by re-running and applying
blindly — store `--review` proposals and `proposals … diff` them.
