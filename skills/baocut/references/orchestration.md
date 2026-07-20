# Orchestration: a persistent worker pool over claim / submit --next

The worker process keeps up to `--align-concurrency` LLM calls pending at once
and frees a slot the instant one is answered. Since M59d every pending call is
CLAIMABLE: `task claim` atomically leases one call to a named worker, and
`task submit --next` answers it and claims the next in the same round-trip. So
parallel subagents pull work themselves — the root never hand-dispatches
callIds, never re-polls per answer, never bookkeeps slots.

## The recommended shape (3 persistent workers, four-way align packing)

1. **Root:** for a webpage URL, finish the url-metadata.md preflight first;
   pass its verified `--title`/`--desc` to `auto` and retain the structured
   notes draft outside the repo. Then start the run (`baocut --json auto …`;
   align concurrency defaults to 4) and immediately spawn 3 persistent answer
   workers (names w1/w2/w3).
   Do not wait
   for the first prompt first: `task claim --timeout 240` safely blocks through
   transcription, and having the pool warm removes the first-call queue/spin-up
   gap. Pass `--title`/`--desc` at `auto` time when you already know the
   content — the run's own polish/translate then get them as context.
2. Let those same 3 workers run until the task is terminal.
   The same 3 workers carry the whole run — analysis → polish → repunct →
   brief → translate → align — so nothing cold-starts at the align tail.
   **Single-page docs (M102): analysis folds into the polish call and brief
   into the translate call** — expect two fewer serial calls; the merged
   contracts (`polish-N.md`/`translate-N.md`) ask for the superset answer
   shapes in the contracts table below, and `--no-merged-stages` restores
   the classic staged shape for A/B baselines
   (the p768 run burned spin-ups re-reading a 575-line skill per align agent).
   Translation itself is two big phases: **Translating** (whole natural
   sentences, 1:1, natural target word order) then **Splitting & aligning** —
   Phase 2 is sentence-scoped and reviews ONLY sentences over the one-line
   **fit** capacity (`budgets.f`, default 16 for CJK, style-derived,
   `--align-fit` overrides); fitting sentences stay whole with zero calls even
   across several source cues. Reading speed (CPS) and the 14-char aim are
   advisory during align (recorded, never retried); `audit`/`finish-check`
   gate them at delivery. The second look defaults to `semantic` (only
   mistranslation/omission rewrites re-checked). The M68 `align` flow
   (`task start align <pid> --lang zh [--groups k1,k2] [--from current|pristine]
   [--align-fit 8-32] [--align-local]`)
   redoes ONLY the second phase against an existing translation — it emits
   `align`-kind prompts exclusively (same claim/submit loop, same review
   contract below, typically far fewer calls), never re-translates whole
   sentences (reviewer rewrites excepted), and its subset apply keeps every
   untouched line byte-identical. `baocut --json align list <pid> --lang zh`
   names the over-fit candidates whose keys feed `--groups`; `--align-local`
   lands clean deterministic drafts without any agent call.
3. **Root afterwards:** stay out of the data path. Check in occasionally with
   `task status` / `task wait --timeout 60` for liveness (below), and collect
   the final state. Treat each answer worker's lifecycle/final notification as
   the PRIMARY liveness signal: if a worker exits while the BaoCut task is not
   terminal, immediately restore the pool to its target size using the
   lease-safe replacement sequence below. `task status.workers` lists current
   lease owners, not every healthy idle Agent, so it is supporting evidence,
   never the complete worker roster. `task report <taskId>` gives the
   postmortem numbers (redirect to a file and `jq` the fields — see Root
   context hygiene below).
4. **Metadata + speaker backfill at terminal (M62):** once the task releases
   the project lock, persist any webpage draft with `project edit <pid>
   --notes "…" --url "<canonical>"`, then run `--json project show <pid>` —
   act on any `attention` hints. A filename-ish title / missing
   description ⇒ `project edit <pid> --title "…" --desc "…"` (the analysis summary you
   already drained is a ready-made source; 2–4 plain sentences). On every
   speakers-on run, ALSO run `speakers show <pid>`; `project show.attention`
   is advisory and may omit a derived "Speaker N" label. For each placeholder,
   inspect the URL title/description and adjacent same-speaker introduction
   cues, then run `speakers propose-names <pid>`. The proposer is a heuristic:
   it never applies names, and `candidates:[]` is not negative identity
   evidence. A direct self-identification may be split across cues (for example
   "I'm cofounder" / "and CEO" / "Zhengyao Jiang"). Metadata naming the same
   person plus that transcript evidence is high confidence; batch-apply
   `speakers rename <pid> s1=Name …`, then re-run `speakers show` to verify.
   Best-effort by design — no confident identity ⇒ leave the placeholder and
   note it; never a blocker or repair-budget spend. Complete this pass before
   auditing so a later quality blocker cannot suppress speaker naming.
   These edits need the project lock, so they come AFTER terminal. For a
   webpage URL, verify `project show` returns the saved notes and
   canonical URL before auditing; a successful media download alone is not
   complete URL ingestion. On an EXISTING project, fix metadata BEFORE `task
   start polish|translate` so the run benefits (MediaContext re-reads the
   project at each stage start).

**Root context hygiene:** the root conversation shares the session token
budget with every worker, and anything read into it is re-billed on every
later turn. Redirect any `--json` output that can exceed ~10 KB (`task
report`, `task calls`, `audit`, `finish-check`) to a temp file and pull only
the fields you need with `jq`:

```bash
baocut --json task report <id> > /tmp/rpt.json
jq '{wallSec,lintRejects,replayedCalls,supersededCalls,wastedActiveSec,replayDrift}' /tmp/rpt.json
jq '.kinds[] | {kind,calls,spanSec}' /tmp/rpt.json     # per-phase spans, not slowestCalls bodies
jq '{status,topIssues:(.topIssues[:5])}' /tmp/audit.json   # sample findings, never the whole report
```

Never read `result.json`, `payloads/*`, `responses/*`, or contract bodies into
the root context — result.json alone reaches ~1 MB on a long video (hundreds
of thousands of tokens); apply and review consume it through the CLI, and only
answer workers read contracts/payloads.

**Terminal is a delivery boundary, not permission to start another run.** For
a bare transcription/translation request, finish metadata/speaker naming,
collect `task report`, `project show`, and one `audit`, then apply the
Project-mode gate in SKILL.md. If bounded findings need human judgment, report
their exact samples and ask whether to accept or repair; do not mutate first.
An informed acceptance completes Project mode with known findings while the
machine verdict remains unchanged. In every terminal report with usable media,
include the viewer-first media card even on WARN/FAIL/needs-review. Stop before
`finish-check`, export, re-segmentation, re-translation, or layout repair.
Presentation-only flash/CPS/width findings are deferred until a timed
deliverable is explicitly requested. A requested timed deliverable gets at
most one post-terminal targeted repair workflow / Agent task and one re-audit.

Worker template (give each a name and ONLY the ids/paths below — a worker
needs no conversation history and no skill text beyond this template):

> You are persistent answer worker `<name>` for BaoCut task `<taskId>`.
> Contracts live in `<contractsDir>`. Run every `baocut` command in the
> FOREGROUND with the Bash/tool-call timeout set to AT LEAST 600000 ms (600s),
> and wait for it — `task claim --timeout 240` is a normal
> foreground command that blocks up to 240s, NOT a long-running job to
> background; never use `run_in_background`, `&`, or a detached shell (that
> drops the worker off and the run stalls with a claimed-but-unanswered call).
> If the harness nevertheless returns a background/session handle, actively
> wait or poll that SAME handle until the command exits, then continue this
> loop. "I'll wait for the completion notification" is never a final reply.
> Loop:
> 1. `baocut --json task claim <taskId> --worker <name> --timeout 240`
>    - `{"status":"already-claimed", heldCallId, heldLeaseId, …}` → you already
>      hold a call; go answer `heldCallId` with its `heldLeaseId` (step 3), do
>      NOT claim again. (One worker = one lease is now enforced.)
> 2. If `status` is `done`/`failed`/`stalled`/`review` → STOP, reply with that
>    status. If it timed out (`status:"running"`) → claim again.
> 3. You hold one call: read the contract file it names (cache it — re-read
>    only when the `contract` filename is one you haven't seen), read
>    `payloadFile`, write your answer to a TEMP file (e.g.
>    `$TMPDIR/<name>-<callId>.json` — never the repo/cwd, drafts there end up
>    in commits). Read the payload with the `Read` tool and `Write` the answer
>    file directly in UTF-8 — NEVER echo/heredoc/paste long CJK text through a
>    shell command: a truncated terminal chops a multibyte character mid-byte
>    and it decodes to `�` (U+FFFD), which corrupts the transcript. Submit with
>    `--file`, never by piping the text on the command line.
> 4. `baocut --json task submit <taskId> --call <callId> --lease-id <leaseId> --file <tmp> --next --timeout 240`
>    - `{"status":"rejected","problems":[…]}` → fix EXACTLY the named problems
>      in your answer file and resubmit with the SAME `--lease-id` and `--next`
>      (≤3 tries). A lint rejection does not consume or renew the claim.
>    - Success returns your NEXT claimed call with a NEW `callId` + `leaseId`
>      → go to 3 and use that new lease on its submit.
>    - `stale-lease` / `already-answered` / `ownership-lost-before-lint` means
>      this worker no longer owns the call; its answer was archived and the
>      official response was untouched.
>      Discard the local answer and go back to 1.
>    - A terminal/timeout shape → go to 2's rule.
> Reply ONE line at the end: `<name>: <final status>`.

Priority is built in: `claim` hands out problems-bearing retries before fresh
work, oldest first — a hard retry never queues behind optional work.

**Worker count and `--align-concurrency` are related but not identical.** The
worker process holds that many calls in flight, and the value also determines
how align work is packed. Three persistent answer workers are the practical
sweet spot in most agent environments; leave four-way packing at its default.
One request can wait briefly, but the smaller prompts beat exact three-way
packing in the same-video benchmark because model tail latency dominated. A
`concurrencyHint` is informational under this intentional 3-worker/4-packing
shape. Since M101 the align wave packing self-clamps to the worker pool
actually observed on the task (distinct claim/answer worker ids), so a short
single-wave job no longer packs a request that must queue behind a full model
call when fewer workers joined than `--align-concurrency` declares. Use
`--align-concurrency 1` with one worker; raise it only when the real pool and
model capacity support the extra calls (max 8).

**Give workers a minimal profile.** They need `Bash` (to run `baocut`) and
`Read` (contract + payload files) — nothing else, no conversation history.
Fixed context is paid per worker per cache write; a lean profile cuts the
floor several-fold. Long-lived workers are ALSO the prompt-caching win: the
system prompt and the contract file are written to cache once and then every
turn is a cheap cache read. Never spawn one subagent per call.

**Context safety is a hard requirement.** The root orchestrator must not act as
an answer worker for a media pipeline. Even sequential execution accumulates
every stage contract, payload, rejected draft and corrected answer in the root
conversation; several 8–15K-char align calls can exhaust the model context
before the project reaches terminal. If three workers are unavailable, use one
lean persistent worker with `--align-concurrency 1`. If delegation itself is
unavailable, pause and request it before starting/continuing the LLM stages;
never paste prompt or answer bodies into root commentary or tool output.

## Model tiering

The pool is uniform, so it runs at the tier the STRICTEST stage needs:

- **align** decides what ships (strict bilingual correspondence, verbatim
  source coverage, natural target grouping and target hard limits) and
  **translate** is real translation — both
  need **Sonnet-class or better, align the strongest you have**. Never the
  cheapest tier; a rubber-stamping cheap model defeats the quality gate.
- **cleanup** (M79 rough cut) joins them at the Sonnet-class floor —
  retake/false-start judgment is exactly the semantic work a rubber-stamping
  cheap model ruins, and a wrong cut is user-audible. `broll` tolerates
  mid-tier but rides the uniform pool anyway.
- analysis / brief / segment / repunct are mechanical. **Polish that corrects
  technical terms, names, homophones, or code-switched speech needs the same
  Sonnet-class floor as cleanup**; punctuation-only segment work may use a
  cheaper tier. These stages otherwise ride the
  same workers at no extra spin-up. Their share of the run is small, so
  running the whole pool at the strong tier costs little extra.
- Cost-sensitive alternative: ONE mid-tier drain agent loops the prefix with
  `task submit --then-wait` (stop at the first `align` kind), then the strong
  pool takes over. This resurrects a cold start at align and serializes
  concurrent prefix calls — prefer the uniform pool unless cost dominates.

## Liveness

**Expect these magnitudes before suspecting a hang** (a ~30-min talking-head
source; scale roughly with duration):

| Stage | Typical wall-clock | Notes |
|---|---|---|
| transcribe (local ASR) | minutes, progress-only | no prompts until the first LLM stage |
| speaker diarization | ~4–5 min extra | skip with `--no-speakers` when safe |
| polish (all pages) | ~10–20 min | many claim/submit round-trips; single-page docs run analysis+polish as ONE merged call (M102) |
| translate + align | ~10–20 min | two phases; align dominates the tail; single-page docs run brief+translate as ONE merged call (M102) |
| single model answer | up to the claim lease | adaptive lease: 600s ≤8K / 900s ≤20K / 1800s >20K chars |

A quiet terminal is NOT a hang signal: piped CLI stdout is block-buffered, so a
healthy worker can look silent for minutes. Judge liveness by the signals
below, never by output silence.

Subagents can die silently mid-call (two drains once hung a run 40 minutes).
Signals: every `task wait` row carries `ageSec` and
`claimedBy`/`claimAgeSec`/`leaseId`; `task status`/`report` report `waitingOn`,
claimed/unclaimed/expired counts, a **`workers` list** (`{workerId, callIds[],
oldestClaimAgeSec}` — a worker with >1 callId means a pre-fix or `--force`
multi-claim), queue distributions, oldest ages, `slowClaims`, a
**`stalledClaimCount`** (M81: claimed ≥2× the size threshold with no lint
progress since — a likely dead worker), and a **`concurrencyHint`** when the
live worker count ≠ `--align-concurrency`. `waitingOn:"answer-workers"`
means capacity is missing; `claimed-answers` means workers own all prompts;
`engine` means local pipeline work; `worker-recovery` means resume/repair.

**Follow a long run hands-free** with `baocut task watch <taskId> [--jsonl]`:
one line per state change (phase/pct/pending/claims/stalled/quality) until
terminal, then a final full status. `--jsonl` is real JSON Lines: each physical
line is one compact, independently parseable object. Exit 0 on done/review, 2 on
failed/cancelled/stalled — so `task watch <id> && baocut export …` gates
cleanly. Prefer it over polling `task status` in a sleep loop.

The default claim lease is adaptive to payload size: **600s at ≤8K chars,
900s at ≤20K, 1800s above 20K**. `--lease N` is an explicit override and is
carried across that worker's `submit --next`; without an override, every next
call gets a fresh size-based lease. A `slowClaims` entry (including the 300s
large-call threshold) is a **soft investigation signal only** — never an
automatic release or proof that the worker died. Some difficult reviews
legitimately run long.

Root tail-recovery sequence:

1. Inspect `task status`, the named call/worker, and recent same-kind timings.
2. Interrupt that exact answer worker, or otherwise confirm it has stopped and
   will not submit. Do not release merely because the soft threshold fired.
3. Re-read `task status`; use the exact current `callId` + `leaseId` from
   `slowClaims`, then run its supplied command:
   `baocut --json task release <taskId> --call <callId> --lease-id <leaseId> --reason "worker interrupted"`.
4. Only after a successful release should a surviving/replacement pull worker
   call `task claim`. A stale release token changes nothing.

Root worker-replacement sequence (mandatory on every child-Agent exit
notification):

1. Read `task status`. If the BaoCut task is terminal, do not replace anyone.
2. Confirm the exited Agent is no longer running or able to submit. Never use
   `task status.workers` alone for this decision: an idle healthy Agent holds no
   lease and is absent from that list.
3. If the exited Agent still owns a current lease, re-read its exact `callId`
   and `leaseId`, then `task release` by the tail-recovery sequence above. If it
   owns no lease, no release is needed.
4. Spawn one fresh persistent worker with a NEW unique name and the same lean
   template, restoring the original target pool size immediately. Do not wait
   for `stalledClaimCount`, a lease expiry, or the whole task to stall.
5. Keep the root's roster from Agent lifecycle notifications; use
   `pendingCount`, `waitingOn`, `slowClaims`, claim ownership and lease expiry
   from `task status` only to reconcile queue state and safe handoff.

If nobody intervenes, an actually dead worker's lease eventually expires and
the call becomes claimable. Final submit is a fenced CAS: only the current
lease can create the official response. Stale and duplicate answers are
rejected without overwrite and preserved under `late-answers/` for diagnosis.

## The contracts (what a worker reads)

Each kind's full spec is written ONCE to `contractsDir/<kind>.md`. A kind that
sees a SECOND distinct system prompt during the run gets `<kind>-2.md` (e.g.
polish inside translate's pre-polish vs. standalone polish) — always read the
contract file the call NAMES, never an assumed path.

| kind | answer shape |
|---|---|
| `analysis` | `{"summary":…,"terms":[…],"namedEntities":[…]}` — terms pre-scan |
| `segment` | `{"paragraphs":["…"]}` — input VERBATIM, punctuation only |
| `polish` | `{"paragraphs":[{"sentences":["corrected…"]}]}` — apply known term variants, make minimal fixes, cover every word once in order; submit lint runs the engine's 70% atom-LCS gate. **M102 merged (single-page docs):** the contract additionally asks for the analysis fields — answer the SUPERSET `{"summary":…,"terms":[…],"namedEntities":[…],"paragraphs":[…]}` in ONE object; a missing analysis section is rejected by name (`analysis section`) |
| `repunct` | `{"segs":[{"id":N,"cuts":[{"id":"c…","m":"，"}]}]}` — copy ids from each segment's `cm` seam map; never echo text/anchors (M60) |
| `brief` | `{"summary":…,"glossary":[{"source":…,"target":…,"locked":false}],"namedEntities":[…],"styleGuide":…,"difficulties":[…]}` — generated terms are preferred; only a user-edited `locked:true` becomes a hard wire requirement (legacy missing `locked` keeps its MUST-use prompt wording but is never hard-gated — M74a) |
| `translate` | request `{"lang"?:…,"lines":[{"id":…,"source":…,"maxChars":…,"rt"?:[…]}]}` → answer `{"translations":{"<id>":"<translation>"}}`; emit every id and every locked `rt` verbatim. **M102 merged (single-page docs, brief cache miss):** the contract additionally asks for the brief fields — answer the SUPERSET `{"summary":…,"glossary":[…],"namedEntities":[…],"styleGuide":…,"difficulties":[…],"translations":{…}}` in ONE object (derive the brief FIRST, then translate grounded on it); a missing brief section is rejected by name (`brief section`) |
| `align` | REVIEW a draft (below) — changed pairs only; copy compact seam ids, never echo canonical text |
| `cleanup` | `{"cuts":[{"a":first,"b":last,"cat":"retake\|falseStart\|filler","alt":[first,last],"reason":"…"}]}` — page-local indices, `a..b` is the span to CUT, retakes carry `alt` = the kept take (M79; decision rules in editing.md) |
| `broll` | `{"suggestions":[{"start":"<wordId>","end":"<wordId>","mode":"fullscreen\|pip","query":"…","reason":"…"}]}` — copy ids verbatim; spans 1.5–20s, ≥3s from either end, no overlaps (M80) |
| `chapters` | NDJSON — one `{"title":"…","startSeg":"<segment id>"}` object per line, nothing else (no fences/prose/wrapping array); copy `startSeg` verbatim from the payload's `[<segId> · mm:ss]` lines, chronological, first chapter = first segment, titles non-empty and distinct; submit lint blocks unknown ids/empty titles/zero lines, duplicate titles only warn |

### Repunct fast path: patch first, let lint measure

`repunct` is a mechanical compact-patch stage, not an open-ended editing
review. For every segment, choose the **fewest** punctuation cuts needed from
the supplied `cm` seam ids, emit only those ids and marks, and submit. Do not
echo the text, narrate alternatives, or manually simulate every possible line
wrap before the first submit. Time-box the first answer to roughly 30–45
seconds even for a multi-segment payload; the synchronous submit lint is the
authoritative width/verbatim gate and names the exact seam to fix if the
minimal patch is insufficient. A lint-guided second pass is cheaper and more
reliable than spending minutes pre-validating a patch that already passes.

### The compact align review contract (v4)

The top-level optional `lang` is the exact target code. Each payload pair
carries canonical source once in `sm` and canonical target once in `tm`. It
also carries machine-measured `problems` (HARD — that pair
MUST come back corrected) and `advisory` (softer pointers — fix only if
genuinely wrong, else omit). Optional `pt` entries are protected glossary
targets: each is indivisible, so no selectable `@` seam exists inside it and
a rewrite must preserve every shown occurrence verbatim and intact. The same
gate is enforced by the worker, submit lint, retry fallback, refinement and
apply safety paths. Optional `rt` entries are locked glossary targets activated
by the source — explicit user locks only (`locked:true`; legacy nil-locked
entries never hard-gate, and a lock too long to fit one unit is dropped from
the wire — M74a). They ride even if Phase 1 omitted the rendering: a rewrite
must insert every `rt` verbatim (word-bounded for Latin targets) and wholly
inside one target unit; a recut cannot fix a missing `rt`. A pair whose SHOWN
translation itself violates the locale policy cannot be cleared by a verbatim
recut either — return a rewrite with a reasonCode. Typography the engine
normalizes deterministically (`⋯`/`...`→`…`, four-digit `1,000`→`1000`) is
canonicalized before the submit lint and the engine gates alike, so it never
costs a lint try; existing-text typography is normalized at input build. A
measured 9-CPS delivery violation retries ONCE with the named problem, then a
persisting violation soft-accepts flagged (audit still FAILs the group).
Omitting a pair accepts its draft only when it carries no hard
problem; `{"pairs":[]}` remains valid for an all-clean batch. Old v3 payloads
without `lang`/`rt` remain decodable.

An align unit is a **target-language translation group with a continuous
source-word range**, not one shared bilingual display line. Source cues keep
their own wrapping and a target group may span several of them. Treat the
source budget shown in the payload as a layout hint only: never split a
natural target sentence merely because its source span exceeds that value.
Budgets ride the payload as `{s, t, f}`. `f` is the one-line FIT capacity
(default 16 for Simplified Chinese; style-derived): a pair is in review
because its target exceeds `f` or carries a named problem, and a target at or
under `f` should normally stay ONE unit even when its source spans several
cues. The engine measures "over `f`" on the delivery projection (halfwidth
Latin glyphs weigh half a cell, projected-away punctuation weighs nothing),
so a mixed-script target above `f` raw characters may legitimately have been
kept whole — do not split it just to satisfy a character count. `t` (14 for zh) is the preferred AIM per unit when a span does split —
cut at punctuation seams first, semantic boundaries only where punctuation
still leaves a span too long; a 15–20-character span with a natural balanced
seam MAY split there, but keeping it whole is also acceptable. Anything over
20 (the hard ceiling) must be split or rewritten more compactly. Source
wrapping never creates a target cut.
The delivered `zh` projection is `audit`/`finish-check`'s delivery gate, not
an align retry trigger: at most 9 visible non-whitespace characters/second,
32 visual cells (16 fullwidth characters) per display row, and two rows —
align records CPS findings as advisory only. Keep natural commas and periods
in rewrite text; the display/export projection replaces those marks with
spaces non-destructively and performs deterministic bottom-heavy wrapping. If
the payload names a presentation problem, recut at a safe target seam or
rewrite more compactly; never insert a newline yourself. Optional `ctx` on a
pair carries clipped neighbor-sentence translations, read-only — never cut or
return them.

On full apply, exact word-alignment seams are normalized onto the existing
source-cue grid inside each paragraph and speaker run. This keeps source cue
text, timing and wrapping unchanged while allowing one target sentence to span
several source cues. A source split is added only if there are fewer source
cues than target groups in that hard-bounded run.

The inline maps have two marker kinds:

- `<@id>` is a selectable safe seam, e.g. `hello<@0> world` or `你<@a>好`.
  Copy the bare id into `cuts`/`through`; never count offsets or invent a seam.
- `<#id>` is a read-only DRAFT boundary. Matching `#` markers in `sm` and
  `tm` delimit the current source/target units. Use them to judge the draft,
  but never return a `#` id.

All markers are metadata, not subtitle text. The wire deliberately has no raw
`source`, `target`, or full `units` echo; stripping markers reveals both
canonical passages exactly.

Every returned pair declares exactly one compact action:

- `"recut"` — the default structural fix:
  `{"id":"…","action":"recut","cuts":[{"s":"0","t":"a"},…]}`.
  `cuts` is the complete, strictly ordered list of interior boundaries. Use
  `[]` for one unit. The app slices canonical strings locally, so a recut
  cannot change spelling, spacing, names or numbers.
- `"rewrite"` — for a REAL defect or a natural reorder, and (M71) `reasonCode`
  is REQUIRED:
  `{"id":"…","action":"rewrite","reasonCode":"mistranslation|omission|terminology|grammar|translationese|reorder","reason":"…","pieces":[{"through":"0","t":"…"},{"through":"end","t":"…"}]}`.
  Any text change without a valid `reasonCode` — including an action-less
  answer whose text drifted — is rejected with a named problem. `reorder` is
  the one non-defect class: a meaning-preserving word-order adjustment that
  follows the source clause order better AND still reads as natural target
  prose — encouraged when it improves alignment, never second-looked.
  Rewriting into STIFF source-order phrasing merely to make units map
  monotonically remains illegal (the p788 ALN-004 failure) — recut the
  crossing clauses into ONE larger unit instead (when the target fits `f`),
  or split the target proportionally by content share when it cannot reorder
  and exceeds `f`. Copy source candidate ids; emit only new target
  text; the final piece must use `end`. Under the default
  `--second-look semantic`, only rewrites declaring mistranslation/omission
  get a second look (the advisory embeds the PRISTINE pre-rewrite text for
  word-order comparison). Under the opt-in `--second-look targeted`, every
  rewrite is re-checked and recuts made from
  raw-character/proportional drafts also get a mandatory semantic audit:
  omission is not approval, so the worker must explicitly return unchanged
  cuts or a correction; rejected/omitted checks retry before the accepted patch
  is retained as attributable fallback. Function
  words may move to an adjacent unit, but predicates/actions, negation,
  numbers, names and main objects must stay with the source unit expressing
  them. M71 also escalates suspicious punctuation-snapped proportional draft
  cuts (a discourse-filler seam word, a sentence-final target over a weak
  source comma, char-vs-time ratio divergence) into hard `problems` — such a
  pair MUST come back corrected (or as an explicitly unchanged recut).

Do not return legacy `units`. It repeats both languages, is slower and can
reintroduce whitespace damage. Candidate ids are the production contract.

## Submit lint: trust it, don't pre-validate

`task submit` runs the app's own checks synchronously and rejects with named
`problems` (unknown/unsafe/unordered candidate, incomplete coverage, a target
unit above its aim despite a safe balanced seam, a unit over its hard ceiling,
missing/split `rt`, Simplified-Chinese 16×2 presentation failures,
U+22EF/ASCII ellipsis, repeated/combined question-exclamation marks, fullwidth
digits or a four-digit thousands separator in newly authored `zh` text,
protected-term/word split, flash fragment, missing id, dangling
connective) — fix exactly what it
names and resubmit; nothing was consumed
(≤3 tries, then the engine's own fallback chain takes over). **Do NOT
routinely `task validate` before submitting** — on a passing answer it's pure
overhead (p768: every pre-validate passed). Reach for
`task validate <taskId> --call <id> --file <answer>` only when you are stuck
in a reject loop and want to iterate without burning submit tries.

For alignment, one second of corresponding source speech on each side is
enough to keep a natural split. Target delivery CPS remains a retry/audit
quality signal, but the final deterministic repair does not weld a 1.0s+
semantic split back together merely to satisfy CPS.

## Postmortem

`baocut task report <taskId>` — per-kind spans (the phase critical path),
call counts by workClass (initial/retry/secondLook), queue-wait vs active
p50/p95 (recorded by the claim protocol), chars in/out, lint rejects. Use it
instead of hand-parsing worker.log; `task calls` lists per-call detail, and
`baocut logs <pid> --kind align-diag --pair g16.0` explains per-pair engine
decisions.

`task report` answers **why the run took that long**; it is a performance
instrument, not a quality verdict. Run `baocut --json audit <pid> [--lang L]`
for the read-only subtitle quality/invariant verdict. Audit covers source and
target reading-time flashes, source fidelity (including dropped or duplicated
spoken spans), coverage/staleness, width budgets, pins, word timing, and safely
attributable rewrite/second-look/fallback evidence; FAIL exits 2. Target width
is reported as an aim plus the production hard tolerance: aim→hard is
WARN, beyond hard is FAIL. A missing cached brief makes the protected-term
audit explicitly unavailable/WARN; it is never reported as a clean zero. See
recovery.md for field interpretation.
For CLI polish, `task report` also surfaces `polishQuality`; recovery,
fallback, or residual terms are WARN and block a polished-result claim. Prefer
the bounded local repairs in transcript-quality.md; do not default to a full
Agent polish rerun.

Interpret that verdict against the requested completion mode: presentation
FAILs block timed subtitle/video delivery, but do not block a content-sound
Project or Markdown result. Never turn the audit into an unbounded remediation
loop; recovery.md defines the single repair budget.

## Scientific A/B acceptance for speed changes

A timing comparison is valid only when A and B hold the workload constant:

- the exact same media, ASR/answer-worker models, source and target languages;
- the same subtitle line-width policy and speaker strategy (`--no-speakers`,
  auto, fixed count, sensitivity/protection settings);
- the same instructions, tone, polish/autocorrect/second-look settings and
  answer-worker count. Change only the treatment being evaluated.

For **both** runs preserve the machine-readable artifacts:

```bash
baocut --json task report <taskA> > report-a.json
baocut --json audit <projectA> --lang <lang> > audit-a.json
baocut --json task report <taskB> > report-b.json
baocut --json audit <projectB> --lang <lang> > audit-b.json
```

Record at minimum total wall time, every kind span, chars in/out and call
counts/workClass counts from `task report`, plus the complete audit JSON. Do
not report only a headline percentage: a faster wall clock with work shifted
into retries, fallbacks or missing output is not an optimization.

Speed is releasable only when all quality gates hold:

1. **Critical integrity has zero regressions:** no new/increased missing,
   empty or stale translations; orphan/inconsistent pins; duplicate/empty
   words; non-finite, negative or regressing word timing. A clean zero must
   remain zero.
2. **Terminology is exact:** named entities, product/API names, numbers and
   glossary terms survive with the required spelling and internal spacing.
3. **Fallback does not increase:** compare attributable `fallbackCount` and
   samples; an unavailable attribution is not evidence of zero.
4. **Human sampling passes:** inspect the same timestamps in A and B, stratified
   across the beginning/middle/end plus every rewrite/fallback and audit hot
   spot. Check source fidelity, translation naturalness/completeness, semantic
   cut placement, reading time and terminology.

Only after those gates pass may wall/kind-span/char/call reductions justify
the speed claim. A known baseline flash or zero-duration word is recorded
technical debt, not an automatic blocker to experimentation, but B must not
increase its count/severity or introduce new samples; keep the baseline and
delta explicit rather than hiding the existing debt.
