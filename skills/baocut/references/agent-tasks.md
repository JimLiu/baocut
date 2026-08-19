# Agent task loop

AI stages using `--llm agent` may pause with a pending call. Keep the pipeline
process alive and answer through its leased task queue.

## Short-job fast path

Most of this document is about staffing wide parallel batches. A short clip
(under ~15 minutes; a transcript that fits one 2200-source-word page) never has
one: every stage dispatches exactly one call, serially, and the observed chain
for a 100-second clip was `analysis` → `polish` → `translate-brief` →
`translate` → `align-edges` → `align-rewrite` (one over-hard chunk) → one
closing `align-edges` repair from `auto`'s refine pass — seven calls, about
nine minutes of answering. For that shape:

1. Start `auto … --llm agent --jsonl` in the background, writing to a log
   file, and put one `Monitor`/tail on it that wakes on `batch-dispatch`,
   `error`, and `done`. Do not launch worker subagents and do not create a
   task tracker for the pipeline steps.
2. On the first dispatch, claim in the orchestrating session with a unique
   `--worker` id and no `--kinds` filter:
   `task claim <project> --worker <id> --timeout 60 --json`.
3. Read the claim's `contract` and `input` files in the same step (one
   parallel batch of reads), write the answer to a unique temp file, and
   `task submit … --file <answer> --next --json`. `--next` waits up to 20 s
   for the engine to write the following call and returns it inline; when it
   returns `next:"empty"` with `producerAlive:true`, one bounded
   `task claim --timeout 60` picks it up. Read each `contract` path once: a
   retry in the same task directory only needs its payload and `problems[]`,
   while a call from a new task directory (for example the closing repair)
   gets its contract read again — it may embed that task's context.
4. Stop claiming after the JSONL `done` (or `error`) event. `claim` and
   `submit --next` also return `empty` on their own, within a second, once no
   producer process is alive, so a stray claim after the terminal event no
   longer hangs — but it is still a wasted round.

Two hard limits apply in every shape:

- Keep `--timeout` on `task claim` below the shell tool's own kill limit
  (with a 120 s tool timeout, use ≤ 90 s); a claim killed by the tool leaves
  no useful output. Long waits belong in the `Monitor`, not in the claim.
- Bash tool calls that block for the whole timeout are the most expensive
  way to wait: `submit --next` and the event stream cover the ordinary
  stage boundaries, and `producerAlive:false` means stop.

Worker discipline for wide batches (violations observed to waste whole worker
turns):

- Start workers on demand, never ahead of work. Launch exactly one unfiltered
  catch-all worker alongside the producer, whatever the command is — fresh
  `auto`, direct translate, align-only, or a resumed parallel stage. That one
  worker is the baseline, not a pool: it answers whatever the first stage
  dispatches without any advance guess about its kind. Every further worker is
  started only after real pending work is visible in the event stream or in
  `task status`, and only for as long as that work lasts — for a command whose
  very first dispatch is already a wide parallel batch, such as align-only, the
  top-up simply follows within seconds. An idle worker occupies a whole model
  session for the rest of the run, while a call that waits for the next top-up
  costs only seconds. Measured
  on a 21-minute talk: starting *no* worker at all until dispatch made the first
  `analysis` call wait `queueMs 201408` against `workerMs 85939` — what removes
  that delay is the single baseline worker running from the start, not a
  pre-started group.
- Each `batch-dispatch` event carries a structured `workerPlan` (`execution`,
  `suggestedWorkers`, `claimKinds`, `recommendedEffort`, `poolKey`,
  `maxWorkers`, `expectedWaves`, and `observedWorkerSec`), and `task status`
  reports the same grouping under `workerPlans[]`. When one of them shows N
  pending independent calls, top the running workers up to
  `min(pendingCount, subagent slots you can actually run)` for that
  `claimKinds`. `suggestedWorkers` is computed from the pending count and is an
  upper-bound hint — a ceiling to aim at while work is queued, never a floor to
  fill before the work exists. `expectedWaves = ceil(pendingCount /
  suggestedWorkers)` tells you how many rounds the queue takes at that
  staffing; `observedWorkerSec` is the median claim→submit time of the calls
  this task has already delivered. When no `BCUT_LLM_MAX_WORKERS` is exported
  and that median reaches 90 s (subagent workers typically take minutes per
  page), the producer raises the ceiling itself to `ceil(pendingCount / 2)`
  clamped to 3..16 — so read `suggestedWorkers` fresh from each dispatch
  instead of assuming the default 3. Select the worker reasoning tier from
  `recommendedEffort`: align (including its global repair) reports `high`,
  while the other kinds report `medium`. Do not let a generic loop steal a
  serial stage.
- Cover every kind the engines can dispatch, not just the common ones. The full
  set is `analysis`, `speaker-repair`, `polish`, `polish-retry`, `punct-repair`,
  `seam-repair`, `segment-repair`, `segment`, `segment-index`, `chapters`,
  `chapters-outline`, `translate-brief`, `translate`, `align`, `cleanup`,
  `broll`. `speaker-repair` (dispatched **before** the polish pages on
  multi-speaker projects, to let the model reassign diarization fragments —
  a particle or a few words that grammatically continue the neighbouring
  speaker's sentence — before ⏹ becomes a hard sentence/paragraph boundary;
  single-speaker projects never dispatch it), `polish-retry`
  (dispatched when a polish page trips the similarity gate), `punct-repair`
  (dispatched after the polish wave for sentences that came back over-long
  without sentence-ending punctuation), `seam-repair` (dispatched after that
  to decide whether each page seam — last paragraph of page k + first
  paragraph of page k+1 — is a real paragraph boundary), `segment-repair`
  (dispatched after that for paragraphs that came back over-long) and
  `segment-index` are the ones a hand-written `--kinds` list usually forgets:
  if no worker can claim them the producer blocks with no further output, and
  a stalled queue is indistinguishable from a quiet one in the event stream.
  Keep one worker claiming with **no** `--kinds` filter as the catch-all, and
  watch the event stream for staleness rather than only for error events.
- The root notices the backlog; workers do not appear by themselves. Watch the
  producer's `--jsonl` event stream, or poll `task status`, and own the top-up
  decision there. When a batch is wide and the running workers are clearly
  fewer than its pending calls, top up instead of grinding through it alone —
  a 230-sentence talk once left two translate pages queued 736s and 1110s
  behind a four-worker cap, and one worker serially draining a wide parallel
  batch remains the largest observed time waste. The root keeps the producer
  session alive and owns the final quality gate; it must not serially claim a
  whole parallel batch while subagent slots sit unused. If parallel workers are
  unavailable, run one loop and report that limitation instead of pretending
  the queue was parallel.
- Size the worker pool from the actual page plan, not from a fixed number.
  Agent-mode translate pages use 2000 source words (+10% slack, balanced
  boundaries), so a document of W source words dispatches about
  `ceil(W / 2200)` translate calls. Align starts with that count, then also
  enforces at most 40 items per page and a 16000-unit deterministic complexity
  budget; many short/high-constraint sentences can therefore produce more
  align pages than the word formula. Polish pages are ~2200 core words. Use
  `workerPlans[].pendingCount` / `suggestedWorkers` as the authoritative count,
  then take the smaller of that page
  count and the subagent slots you can really run, and
  `export BCUT_LLM_MAX_WORKERS=<that number>` before starting `bcut`
  whenever it differs from the default 3. It is a hard concurrency ceiling the
  producer folds into `suggestedWorkers`, never a target to staff up to, and
  it does not change page shape. Leaving it unset is fine for slow subagent
  pools: the producer measures delivered worker time and lifts the default 3
  to `ceil(pendingCount / 2)` (max 16) once the median passes 90 s — but an
  explicit value pins the ceiling and disables that adaptation, so only export
  it when you really cannot run more sessions. Do not carry a habitual "6 workers" over from
  older runs: with the 2000-word pages most talks under 20 minutes never have
  6 pending calls at once. Provider mode (`--llm provider:<vendor>/<model>`)
  runs the same 2000-word pages on the CLI's own lanes and needs no workers
  at all.
- Give every worker process a unique `--worker` id. One process should reuse
  its own id serially for the whole flow, but two concurrent processes must
  never share an id — a second claim with an active id renews the first lease
  and both processes end up answering the same call.
- Pass `--kinds` matching the stage the worker was launched for (for example
  `--kinds translate,align`). Without it, a worker loop left over from a
  previous stage claims the next stage's calls and answers them without the
  orchestrator's quality context. Comma-separated and repeated flags are
  equivalent (`--kinds translate --kinds align`); on Windows PowerShell quote
  the list (`--kinds "translate,align"`) so the shell does not split it into an
  array. A malformed filter is rejected as `invalid_arg` rather than returning
  `{"status":"empty",…}`, so an `empty` claim always means the queue really
  had no matching call.
- Chain, then exit — do not idle. A worker submits with `--next` (or claims
  again with a bounded timeout), so the same session carries straight from its
  page into the batch's global repair call and a following `refine-align`
  without another startup delay. A momentary `pendingCount:0` while the
  producer aggregates a batch is still not a terminal condition, but what
  covers it is that `--next` chain plus the producer's terminal event, not a
  resident set of pollers. An empty claim (and `--next` with `next:"empty"`)
  now says whether that is worth waiting for: `producerAlive:true` with
  `activeTasks:[…]` means a producer process is still running — usually a
  serial stage or engine-side work between parallel waves — so make one more
  bounded claim (`--timeout 300` from a subagent that owns its own clock; from
  a shell tool with a 120 s kill limit, `--timeout 90`) before giving up;
  `producerAlive:false` means nothing will dispatch again and the worker
  reports and exits. A bounded claim also returns `empty` early — within about
  a second — once every producer recorded in the project's `tasks/` has
  exited, so a worker no longer sits out its full `--timeout` after the
  pipeline's terminal event. Both are
  normal endings, not errors, and the root does not respawn a worker until a
  new dispatch needs it. Restarting a worker costs one startup; keeping an
  idle one costs a full model session for the whole remaining run.
- Give every delegated worker the same project path, a `--kinds` filter
  matching the batch it was started for, a distinct worker id, and
  responsibility for the complete claim → inspect → answer → submit `--next`
  loop. Whether a group may be topped up at all is decided by
  `workerPlan.execution` and its `pendingCount`, never by a memorized list of
  stage names — `analysis` and `translate-brief` dispatch as `parallel` even
  though they often carry a single pending call, and a merge step is serial. A
  group reported as `serial` stays single-worker. Polish pages are independent
  and dispatch `parallel`; only a historical task produced by an older json-v0
  CLI still reports polish as `serial` — read the plan, never a memorized rule
  about polish.
  Before running the quality gate, the root waits for
  every outstanding claim to drain — after the pipeline emits its terminal
  event or `studio/worker_stop` appears, tell any worker still running to stop
  and wait for it, so no answer is still in flight while the gate runs.
- Pick the worker tier per stage, not one tier for the whole run:
  - `translate` (and `polish`, `analysis`, `translate-brief`) workers: a
    mid-tier model at medium reasoning (Sonnet class, `terra medium`, or the
    host's equivalent) is enough — they are contract filling against a
    validator, measured at zero submit rejections on 2000-word pages, and the
    top tier buys no measurable quality while it costs lease time and slots.
  - `align`, its global repair call, and `refine-align` workers: a **high
    reasoning tier** (`terra high`, `sol medium`, Opus class, or the host's
    equivalent). Cutting bilingual pieces at legal seams under a hard width is
    the one stage where the tier shows: two `terra medium` align workers each
    burned all three lint tries on the same 2000-word pages that a high-tier
    worker passed first time, and the residue then cost a global repair, an
    `--align-only` pass and a `refine-align` — more wall clock than the tier
    difference could ever save.
  - Reserve the very top tier for the orchestrator's own gate and for taking
    over a stubborn call the user asked to fix by hand.
  Claim, answer, and submit within the lease — read the contract and payload
  in the same step as the claim rather than studying every payload before
  writing.
- Align and repair answers are written by reading, never by a script. Do not
  generate pieces with a helper that cuts every N characters or at the next
  punctuation mark: such output lands on banned seams and over-hard pieces
  wholesale (an observed worker produced a 76-unit first piece and 24
  `align-illegal-seam` problems per page this way), and it cannot converge
  because the script does not know what a legal seam is. Fix each rejected
  sentence by hand from the `problems[]` list. Never resubmit the same answer
  unchanged: submit lint hashes the last rejected answer per lease and returns
  `rejected` with `unchanged:true` without spending a try or letting it
  through — resubmitting is not a retry, it is a no-op. The third-try
  force-pass exists only for a sentence that has **no** legal cut point after
  a real attempt: keep the best legal split you found for every other
  sentence and mark only the truly uncuttable one with
  `data-unsplittable="true"` in that submission.
- Budget against the `leaseSec` the claim reports, divided by the call's
  `items`. Identical translate pages have been measured at 6.7s and 27.4s per
  line by different workers on the same batch — the spread is working style,
  not payload difficulty. Once an answer passes its shape gate, submit: a
  second full re-read of lines already written mostly buys queue time, and
  submit-time lint plus the producer's global repair call catch what it would
  have caught. A worker that runs past its lease loses the call to a
  replacement and its finished answer is discarded, so an over-careful worker
  costs the batch a whole duplicated page.
- Translate and align share one language-aware source-word metric: Latin
  words and individual CJK characters each count as one, attached punctuation
  is free, and the page budget is 2000 in agent mode (a document only slightly
  over one budget — up to 10% slack, so 2200 — still stays on one page, and
  multi-page splits balance word counts across pages; provider mode is
  declared separately and currently also 2000 — measured on DeepSeek
  v4-flash, 2000-word pages finished ~1.7× sooner than 4000-word pages on
  both a 3.5k- and a 9.8k-word talk because per-call latency scales with
  page words while the lanes run in parallel). Translate uses only that page
  count. Align additionally splits at 40 items and a 16000-unit complexity
  budget that accounts for carrier text, suggested pieces, terms, and anchors;
  targeted/full mode and worker slots never alter either page shape. Do not
  split a page manually or start an extra worker for part of it;
  its lease and item count already reflect the complete bounded page. The
  smaller agent page is deliberate: a 5000-word page cost one worker ~5 min to
  translate and ~11 min to align, and a 3571-word talk stayed on a single page
  with every other worker slot idle; at 2000 the same talk runs as two pages in
  parallel. `BCUT_LLM_PAGE_WORDS=<n>` overrides both stages' budget for A/B
  runs only — leave it unset in normal work.
- One caveat on how far that reassurance reaches: a translate answer's optional
  `data-align-target` / `data-align-breaks` draft attributes are never rejected
  at submit. The align stage re-checks them
  with the same validator worker answers face, and a failing draft is dropped
  silently while its sentence falls through to a dedicated LLM call — so a
  clean submit says nothing about the drafts. Follow the engine contract's cut
  rules as you write each line and stop there. Do not audit drafts in a
  separate pass, and do not skimp on them either; both cost more than they
  save. Measured on one 207-sentence job, drafts good enough to skip 8 extra
  sentences saved about 70s of downstream align work, while the re-verification
  that produced them pushed two workers to 570s and 1043s on pages the same
  batch had been finishing in 149–496s.

1. Launch the producer together with one catch-all worker, then top up from the
   dispatch/status plan once a parallel batch actually exists. The baseline is
   the same for every command; watch the producer's `--jsonl` event stream, or
   poll status, for the first `batch-dispatch`:

   ```bash
   bin/baocut task status "/path/demo.bcut" --json
   ```

   `workerPlans[]` groups pending work by task and kind. For independent calls,
   bring the workers running for that group up to
   `min(pendingCount, available subagent slots)` now and choose their reasoning
   tier from `recommendedEffort`. Do not wait for one
   worker to finish before starting the next, and do not start workers for a
   group that has no pending calls. Each worker claims from the shared queue
   with its own id and the exact `claimKinds` filter:

   ```bash
   bin/baocut task claim "/path/demo.bcut" --worker codex-1 --timeout 30 \
     --kinds align --json
   ```

   Stage boundaries need no advance staffing. The align batch dispatches
   seconds after the last translate submit, and a worker that submits its
   translate page with `--next` claims straight into it (`--next` holds the
   claim open for up to 20 s, which covers the engine's checkpoint and
   next-page write even on a debug build) — brief the workers on
   both contracts up front and let them claim `--kinds translate,align`, and
   the boundary closes inside the sessions already running. Chaining with
   `--next` is what makes this work: workers that submitted and exited without
   a chain once left the align batch waiting 212s for fresh sessions. Never
   widen
   `--kinds` without the briefing: that is the case the filter exists to
   prevent, where a still-spinning worker grabs the next stage's call holding
   only the previous stage's contract. Workers that already exited on an empty
   queue are simply started again against the new batch.

   Translation pages are deliberately sized so large jobs can checkpoint and
   run in parallel. The root may handle a stubborn repair call after the queue
   drains, but should not compete with healthy workers for ordinary calls.

2. Follow the call's contract exactly. Write only the requested answer to a
   temporary file outside the project, using the claim's `outputExtension`. Its
   name must be unique per worker and call (for example
   `/tmp/baocut-align-codex-1-c0001.html`) so concurrent workers cannot
   overwrite one another.

3. For an `align` answer the carrier is the file-v1 HTML table described in
   "File-contract calls" below — there is no JSON shape gate, no `useDraft`,
   no `sourceBreaks`. The segmentation judgement below still applies when
   cutting a group into rows:

   - Decide the target-language pieces first from the complete natural target,
     its fit/hard budget, and protected terms; freeze those pieces before
     choosing any source cut. Source cuts may map fixed pieces to word ranges
     but must never create, remove, or move a target cut.
   - If the group carries `data-target-frozen`, translation already validated
     that exact JSON array. Emit those target pieces byte for byte and change
     only source row boundaries; `data-reordered="true"` is invalid for that
     group and shared submit lint rejects either kind of drift.
   - Original subtitle cues and their breaks are deliberately absent. Never
     infer or imitate them. If monotonic mapping is difficult, an ordinary
     group may use the contract's reorder/crossing path; a
     `data-target-frozen` group must preserve its target pieces and may declare
     crossing only.
   - Keep every bilingual anchor's source phrase and its target phrase in the
     same paired piece. Submit lint treats an unacknowledged mismatch as a hard
     error; use the declared crossing path only for genuine word-order crossing.
   - Keep bound phrases, connectives, particles, list punctuation, product
     names, numbers, and source/target anchors in one piece. Do not end a target
     piece at `、` or leave a connective dangling on either side.
   - Keep every target piece within the reported hard width. Fit is a hard
     constraint, not a length preference: when a piece is above fit and has a
     free seam, you must cut there. A seam is free only when all four hold —
     both sides land within fit, neither side becomes a flash fragment, no
     objective blocking seam rule fires, and the seam is backed by punctuation
     or by whitespace that really exists in the text. A space rendered at a
     CJK/Latin boundary is not a seam (`担心 | AI 会抢走…` cuts a verb from its
     object clause). An over-fit piece with no free seam stays whole; rewrite
     the translation shorter instead of forcing a cut that trades an over-wide
     row for a dangling tail.
   - Source length alone does not create a target cut. When an over-dense
     paired row genuinely needs one, split only at a complete target-language
     seam; `、` is allowed there only between complete parallel actions, not
     inside an ordinary noun list.
   - Do not leave a Chinese piece ending with an incomplete classifier or
     determiner phrase such as `我们有一个 | 想改变的系统`.
   - A Chinese piece that ends without punctuation must not end on a form that
     still requires what follows. The test is morphological, not a fixed word
     list: a 把/将 disposal phrase with no predicate yet, a transitive verb plus
     a directional or resultative complement (到/掉/出/成) with no object, an
     unclosed locative frame (在/从/对… plus 上/里/中/下/内/间), a pivotal
     让/使/叫 phrase with no second predicate, a light verb missing its object,
     a copula 是 missing its complement — plus the particle 得, an adverb
     (如何/只是/同时/预先), the modal 可以, a quantifier awaiting its head noun
     (一系列/一块), and a light verb plus 了 (采用了/内置了/提供了). Never
     `剩余的 35% 得 | 支撑…` or `输出质量在数学上 | 与…相同`; move the cut one or
     two words later, or keep the piece whole. Words that merely end in one of
     these characters (心得, 以上, 即将, 把握) are exempt.
   - Never cut before the coordinators 和/及/与/或 (including 或者/或是) — never
     `它们是 KV 缓存 | 和 PagedAttention`. A coordinator may open a piece only
     when the previous piece ends on punctuation. The mirror image is banned
     too: never cut after the second coordinated item and strand its head noun
     in the next piece (`Key 和 Value | 矩阵`).
   - A target piece of 8 or more display characters must map to at least 3
     source words. When the sentence has too few source words for that, let the
     neighbouring short phrases share one piece instead of slicing the source
     into crumbs — a one-word range under a wide target row makes word-level
     highlighting stall while the row moves on.
   - Preserve the complete sentence meaning. Mark `reordered` only when the
     contract permits a target reorder; do not add explanatory content merely
     to make pieces line up.

4. Submit with all lease identity fields returned by claim. Prefer the ready-made
   command template in the claim response when it provides one. Use `--next`
   (or immediately claim again with a bounded timeout) so the same worker can
   take a repair call without another startup delay; otherwise:

   ```bash
   bin/baocut task submit "/path/demo.bcut" \
     --task "<task>" --call "<call>" --lease-id "<leaseId>" \
     --worker codex-1 --file "/tmp/baocut-align-codex-1-c0001.html" \
     --next --json
   ```

   Pass the same `--worker` id you claimed with. Omitting it credits the lease
   holder and chains `--next` under that id, so it is safe; passing a *different*
   id is not — `--next` then claims on behalf of another worker and two workers
   end up fighting the one-worker-one-lease rule.

   `--next` output shapes: when the submit is accepted and a new call is
   available, the output is the next call's claim envelope with the acceptance
   merged in — `submitted` (plus `late: true` for a late-accepted answer, or
   `alreadyAnswered` when someone else's answer won) — so no extra status query
   is needed to confirm the answer landed. When the queue is empty it prints
   `{"status":"ok","submitted":<callId>,"next":"empty","producerAlive":<bool>,"activeTasks":[…]}`
   (same liveness hint as an empty `claim`).

   If submit returns `rejected`, keep the same lease, fix only the reported
   problems, rerun the shape and boundary checks, and resubmit. Do not reclaim
   the call or start a replacement task. The lint budget is 3 tries per call
   and lease: each rejection reports `triesLeft`, and the 3rd **changed**
   submit under the same lease is force-passed to engine acceptance instead of
   being rejected again (the engine's own validation still applies). A submit
   whose content is byte-identical (after trimming) to the last rejected
   answer on the same lease does not count: it comes back `rejected` with
   `unchanged: true`, `triesLeft` unchanged, and it is never force-passed —
   only an answer you actually edited can spend a try or reach the third-try
   pass. The budget is counted per `callId+leaseId`, so a replacement worker
   on a new lease starts with a fresh budget — a predecessor's exhausted
   tries (and its last answer hash) do not carry over.

5. Continue until the pipeline emits its terminal event. Have the last worker
   to submit chain one bounded `--next` claim, so the batch's global repair
   call is picked up without a restart; beyond that nobody needs to sit
   polling. Use `task status` or `task watch` when the producer appears
   stalled. Under on-demand staffing, `task watch` exiting 3 with `needAnswer`
   is usually not a failure: it is the expected signal at the start of a new
   batch, when calls are pending and no worker has been topped up yet. Treat it
   as a spawn trigger and only investigate the producer when starting workers
   does not clear it.

`task status` also reports `requestChars`, `estimatedCost`, and `items` for
pending and completed translate/align calls. Use these together with
`completedCalls[].queueMs`, `workerMs`, and `totalMs` plus the aggregate
`timings` object to distinguish worker startup delay, batch imbalance, and
answer-generation time when diagnosing a slow run. Each completed call also
carries its submit-lint history: `lintTries` (rejected rounds under the last
accounted lease) and `lintProblems` (the final rejected round's problems,
retained even when the call was force-through accepted). `0` / `[]` means no
rejection was recorded — note this differs from `pendingCalls[].problems`,
which is the producer's retry reason for the request itself.

When `queueMs` comes out bimodal — some calls around 100s and others around
1000s in the same batch — do not jump straight to "a page got redone". The
producer writes the whole batch to disk up front, so whenever pages outnumber
worker slots (say 8 pages on 4 workers), the second half's queue time simply
absorbs the first half's full answer time: a purely arithmetic bimodal split
with zero redone work. Attribute rework only after confirming the opposite
pattern: a long-queue call credited to a different worker than its first
claimant, more than one `claims/` record per callId, `attempt` above 1, or a
worker reporting a `stale` submit. If every callId has a single claim record,
the crediting worker matches the claimer, and no `stale` was reported, it is
queueing arithmetic. Note that overrunning a lease alone no longer forfeits
the answer: a late submit that passes lint is accepted (`late: true`, first
valid answer wins); only a lint-failing late submit reports `stale`.

## What to expect from calls

- Call kinds are open-ended — `analysis`, `polish`, `translate`, `align`, and
  future kinds all flow through the same claim/submit loop. Retry rounds reuse
  the base kind: a name like `polish-2` is only the retry round's contract
  *filename*, while the call's `kind` stays `polish` — filter with
  `--kinds polish`, never `--kinds polish-2`, which matches no call at all.
  Always read the call's own contract and payload; do not assume the shape
  from a previous kind.
- Retry structure is bounded, and knowing the bounds helps budget effort:
  `align` runs exactly one global repair round after the first wave (fanned
  out in batches within that round — there is no second repair round), and a
  `translate`/`translate-brief` call has an engine-level retry cap of 3. A
  retry call's `problems` list is the whole remaining chance; fix exactly
  those items. An align repair call's `problems` names only the sentences
  present in its own payload (plus problems naming no sentence); a trailing
  count line notes how many further problems belong to sentences repaired in
  parallel calls — never go looking for those sentences in your table.
- The payload file extension is `.json`, but the content may be plain text or
  a composite document depending on the kind; the contract describes the
  expected answer format. Retry calls carry a `problems` list explaining what
  the previous answer failed — fix exactly those.
- A translate contract may include a bilingual glossary and each payload line
  may carry `rt` (required target terms). Every `rt` value is an exact locked
  spelling: put it back verbatim in that line's translation. Submit lint names
  any missing value in `problems[]`; fix the translation rather than editing
  or weakening the glossary. `translate-brief` is a one-call serial stage, so
  assign it to one worker even when later translate pages run in parallel.
- In a target context document's `Translated Summary` and `Translation Style`
  sections, use fullwidth punctuation (`，` `：` `；`) inside CJK text. These
  sections are echoed verbatim into every downstream translate prompt, so
  halfwidth marks would spread into the whole translation. The engine also
  normalizes at acceptance (ASCII `,` `:` `;` next to a CJK character becomes
  fullwidth; numbers, clock times, and URLs are untouched), so a slip is not
  fatal — but write it correctly rather than leaning on the cleanup.
- A claimed call may carry `hedge: true` (with `hedgeOf` naming the original
  call). It is a tail-latency duplicate the producer dispatched because the
  original has been held by a worker far longer than the batch's median
  claim→submit time (queue wait does not count, and the last call left in
  flight is hedged at 1× the median instead of 2×): answer it
  normally — same contract, same payload shape, no penalty attached. The first
  answer wins; the losing call is settled automatically, so the slower worker's
  late submit reports `status: "already-answered"` — that is a success, not an
  error. Do not skip a call or change your answer because it is a hedge.
- Answered calls survive producer restarts: if the pipeline dies and is rerun,
  calls whose content is unchanged reuse the stored answers automatically
  (`call-reused` events); only unanswered or changed calls come back.
- A `polish` worker returns transcript paragraphs only; it must not invent or
  embed speaker-name metadata in that answer. After the producer's terminal
  event and any `review accept`, the root must complete
  [the confirmed-speaker sync](workflows.md#sync-confirmed-speaker-names-after-polish)
  before the final quality gate whenever named participants still have
  placeholder labels.
- Transient `busy` responses around submit are normal under concurrency; the
  CLI retries lock contention internally (bounded window, default 120s). If a
  command still fails `busy`, wait a few seconds and retry the same command once.
- Idle `claim` polling no longer takes the project write lock, so a worker
  waiting on an empty queue costs the producer nothing in contention terms —
  which is why a worker started slightly late cannot starve the producer, and
  why the reason to let an idle worker exit is the model session it holds, not
  the lock. Before this fix a set of idle long-pollers could starve a running
  producer out of its own final write and kill the whole stage — on an older
  CLI, never leave spare workers spinning.
- Provider mode is the no-worker alternative: with
  `--llm provider:<vendor>/<model>` there is no task directory and no claim
  loop — the CLI calls the provider API directly.
  Concurrent lanes come from `--llm-concurrency <N>` (this run only) falling
  back to env `BCUT_PROVIDER_MAX_LANES`, then the `llm.maxConcurrent` config key
  (`bcut config set llm.maxConcurrent <N>`), then 4; `0` = unlimited. That sets
  the concurrent
  lanes only; page shape follows the provider budget (declared separately
  from Agent mode: translate uses 2000 source words, while align adds the same
  40-item and complexity guards described above) and is not affected by the
  lane count.
  The provider path also has
  no submit-lint buffer: a malformed answer goes straight to engine
  validation and consumes one of the engine's bounded retries.

## File-contract calls (`file-v1`)

`translate`, `speaker-repair`, `polish`, `punct-repair`, `seam-repair`, `segment-repair`,
`align-edges`, `align-rewrite`, `align`, `analysis`, `translate-brief`,
`chapters`, and `chapters-outline` calls always use a document carrier: an HTML page, a fenced
plain-text page, an HTML table, or a Markdown context document. (There is no
`--contract` flag — file-v1 is the only protocol for these kinds.) The
claim → answer → submit loop, the
lease rules, `--next` chaining, hedging, and the lint budget are all unchanged
from the JSON kinds. What changes is what you read and what you write.

**Decide the protocol from the envelope, never from the content.** A
file-contract call's claim envelope carries `protocolVersion: "file-v1"`; its
absence means `json-v0`, which today appears only on the single-round JSON
kinds (`polish-retry`, `segment`, `segment-index`, `cleanup`, `broll`) — and on
historical tasks written by an older CLI, whose submits the current CLI accepts
without lint (historical `json-v0` `chapters` tasks keep their old NDJSON
`{title,startSeg}` line lint). The CLI itself routes submit-time lint on
that field alone and never sniffs the payload, so a worker that guesses from
the file extension or from the kind will eventually guess wrong. Both
protocols appear in the same project and even in the same worker loop — see
the mixed-protocol note below.

Fields that only a `file-v1` envelope carries:

| Field | Meaning |
|---|---|
| `protocolVersion` | `file-v1`. Absent = `json-v0`. |
| `input` | Path of the document to edit. Today it is the same path as `payload`; treat `payload` as its alias, not as a second file. |
| `inputFormat` | Media type of that document: `text/html`, `text/plain`, or `text/markdown`. |
| `outputExtension` | `html`, `txt`, or `md` — the extension to give your answer file. |

`contract` and `payload` are **paths, not content**, in both protocols, and they
are written exactly as the producer's own project path — a producer started with
a relative path yields relative paths in the envelope, resolved against the
producer's working directory. Do not assume they are absolute.

The contract file is `contracts/<kind>.md` (`<kind>-2.md`, `-3.md` on later
attempts, with identical content) and holds the stage's complete instruction
set: the carrier's grammar, the permitted edits, and the output rules. **It is
the authority; this section only describes the loop around it.** Read it once
per `contract` path — the four carriers have genuinely different rules, and a
contract can embed task-specific context (the translate contract carries the
brief's summary and glossary; a repair task's may carry diagnosis), so a new
task directory means a new read. Within one task directory the retry copies
`<kind>-2.md`, `-3.md` are identical to `<kind>.md`, and a retry's new
information lives in `problems[]`, not in the contract — do not re-read for
a retry.

The working shape:

1. Claim, then read `contract` and `input` in the same step.
2. Copy the input document to a temp file outside the project, named uniquely
   per worker and call, using `outputExtension` (for example
   `/tmp/baocut-translate-codex-1-c0007.html`).
3. Edit only what the contract allows, in place, leaving everything else byte
   for byte as it arrived.
4. `task submit --file <that file> --next`.

Answer discipline shared by all four carriers:

- The answer is the **whole edited document**, not a diff, not a summary, and
  not JSON. Submit reads the file as UTF-8 text and stores it verbatim; the file
  extension is never inspected, so `outputExtension` is a convention for you,
  not a check.
- **Submit it bare.** No markdown code fence, no preamble, no closing remark, no
  headings you were not given. A single, fully closed, unlabelled outer fence
  with nothing around it is stripped for free, but anything less tidy — an
  opening ```` ```html ```` with a labelled closer, a stray fence line anywhere
  in an align table, one sentence of explanation before the document — becomes
  `document-wrapped` and costs the page a round trip.
- **Preserve every anchor verbatim**: ids, fence lines, table headers, frontmatter.
  They are how the parser maps your text back onto the transcript; a rewritten
  anchor reads as missing data, not as a formatting choice.
- Never introduce control characters, zero-width marks, or bidi overrides, and
  do not indent the sentinel fence lines — they are matched at the line start.
- There is a hard output ceiling of eight times the input size (minimum 4096
  characters). Hitting it (`document-oversize`) means the answer stopped being a
  revision of the page, and the whole answer is discarded. The ceiling only asks
  whether the payload is still worth parsing; a merely long but structurally
  intact answer is handled by the per-unit rules below, not by this guard.

What each carrier expects, in one line each — the contract has the rest:

| Kind | Carrier | Your answer |
|---|---|---|
| `translate` | `<article>` of `<section>`/`<p id="s-…">` (`text/html`) | The same document with each `<p>`'s text replaced by the translation. Every id present exactly once, unchanged, and every attribute kept — `data-rt` lists target terms that must appear in that sentence, `data-budget` its reading budget. When `data-align-words` (`[1]I [2]didn't …`, the source words with 1-based ordinals) is present, first write the natural translation, then wrap it inside the same `<p>` in `<span data-src="…">chunk</span>` chunks (see `align-edges` below for the micro-format); the spans are transparent — their texts concatenated are the translation — and a bad annotation is ignored but never excuses a bad translation. Sentences marked `data-editable="false"` are frozen: copy their existing `data-translation` back byte for byte. The read-only `<!-- context-before/after -->` comments are input only; never echo them. |
| `speaker-repair` | One or more windows of a raw multi-speaker transcript, each between `<<<WINDOW k \| n lines \| speakers S1,S2 \| current: 1-13 S1, 14-14 S2, 15-31 S1>>>` and `<<<WINDOW-END>>>`, **one word (one CJK character) per line**, every line prefixed with its 1-based number (`12\| 的`) and followed by `⏸` pause marks where the source pauses; the header lists the speakers present in the window and the current attribution as line ranges (`text/plain`) | **Line-number ranges plus a label only, never the words.** For every window, in order: `<<<WINDOW k>>>`, then one `a-b LABEL` per line (one range = one turn), then `<<<WINDOW-END>>>`. Ranges start at 1, are contiguous and end at the window's last line; every label must be one of the header's `speakers`; after merging adjacent same-label ranges the number of turns must not exceed the number in `current:` — you may merge a fragment into its neighbours or move an existing speaker change by a few words, never invent a new speaker change. Decide by meaning and grammar first, then timing: reassign a fragment that obviously completes the neighbouring speaker's clause (a particle like 的/了/吗, the head or tail of a phrase) when the pause around it is tiny; keep short turns that are real utterances (acknowledgements 嗯/对/哦/yeah, questions, answers). The transcript is raw — punctuation may be missing or inconsistent, do not rely on it; when unsure, repeat the current attribution. Windows are accepted one by one: a missing window or a broken range list is `range-invalid` and comes back on the next round with the verdict in `problems[]`; the other windows in the same payload land regardless. A valid answer that relabels more than a fragment (over 12 words in the window, or a run over 8 words / 2.5 s) is silently ignored by the engine — only fragments and small boundary shifts are in scope. Nothing outside the fences. |
| `polish` | Plain text between four sentinel fence lines (`text/plain`) | All four fence lines reproduced verbatim and once, both read-only regions character for character, edits only between `<<<EDIT-BEGIN>>>` and `<<<EDIT-END>>>`. A blank line is a paragraph break; a single newline means nothing, and `<<<HARD-CUT>>>` is not one. Page seam: if the first sentence of the editable region starts a new paragraph rather than continuing the last paragraph shown in `<<<CONTEXT-BEFORE …>>>`, put exactly one blank line right after `<<<EDIT-BEGIN>>>` before it; otherwise start the text directly (that leading blank line is the only one with meaning, and it means nothing on the first page). Seams you do not flag are settled later by a `seam-repair` call. Sentence boundaries come only from real sentence-ending punctuation: close each complete thought with `.?!` / `。？！` as you go, so that no mapped sentence covers more than 1200 source characters or 300 seconds and no corrected sentence exceeds 300 Latin words / 500 CJK characters. An over-long sentence does not fail submit lint — the page is accepted for its wording, but that sentence comes back to you as a `punct-repair` call, which is extra work you avoid by punctuating properly the first time; extra newlines, commas, or pause markers never substitute for real sentence-ending punctuation. Paragraphing is mandatory, not optional: keep every paragraph at or under the same cap — spoken-language paragraphs run 2–6 sentences, so an editable region of real length always contains several. An over-long paragraph does not fail submit lint; the page is accepted and that paragraph comes back to you later as a `segment-repair` call, which is extra work you avoid by segmenting properly the first time. Never copy the `⏸`/`⏹` markers into the answer (a `⏹` may carry the incoming speaker's label, as in `⏹S2` — the label is part of the marker, not a word), reinterpret UTF-8, or introduce control characters. |
| `punct-repair` | One or more over-long sentences, each between its own `<<<SENTENCE-BEGIN id=sNN min-sentences=K>>>` / `<<<SENTENCE-END id=sNN>>>` pair, the text carrying `⏸`/`⏸⏸`/`⏸⏸⏸` pause hints projected from the source timeline (`text/plain`) | Every item reproduced with its fence lines and the same id — the only change allowed is adding sentence-ending punctuation (`.?!` / `。？！`) where a complete thought ends, at least `min-sentences` sentences per item. Do not fix typos, wording, or spacing, do not merge, split, add or drop words, do not copy the `⏸` hints, and do not create conflicting marks (`。，` `，。` `，，` `,,` `..` `.,`) or a false sentence end at a dangling connector. Items are independent and accepted one by one: a rewritten item is `source-drift`, an item returned without any new sentence end is `sentence-oversize`, and both come back on the next round with the verdict in `problems[]`; the other items in the same payload land regardless. Nothing outside the fences. |
| `segment-repair` | One or more over-long paragraphs, each a block between `<<<BLOCK k \| n sentences \| c words/characters \| at least m paragraphs>>>` and `<<<BLOCK-END>>>`, one sentence per line, every line prefixed with its 1-based number (`12\| …`) (`text/plain`) | **Line-number ranges only, never the sentence text.** For every block, in order: `<<<BLOCK k>>>`, then one range `a-b` per line (one range = one paragraph), then `<<<BLOCK-END>>>`. Ranges start at 1, are contiguous (each starts right after the previous one ends) and end at the block's last line — no gaps, overlaps or numbers outside the block. Break at every topic turn (2–6 sentences each) so no paragraph exceeds the per-language cap, and give at least the number of paragraphs the header asks for. Blocks are accepted one by one: a missing block or a broken range list is `range-invalid`, a block answered with a single range while still over the cap is `paragraph-oversize`, and both are sent back on the next round with the verdict in `problems[]`; the other blocks in the same payload land regardless. Nothing outside the fences — no sentence text, no preamble, no code block wrapper. |
| `seam-repair` | One or more blocks in the same numbered-line shape as `segment-repair` (`text/plain`). Each block is a window around a page seam: the last sentences of one polish page's final paragraph followed by the first sentences of the next page's first paragraph; the header names the seam (`page seam before line N` — the previous page ended with line N-1, the next page began with line N; a chained block lists several) | Line-number ranges only, same fences as `segment-repair`. The window may begin and end mid-paragraph — that is expected; what matters is where paragraph boundaries fall inside it. If the sentence at the seam continues the thought before it, do not start a range there — let one range span the seam (a single range covering the whole block is a valid answer). Start a range at the seam only when a new topic, question, example or story really begins there; a boundary a few lines before/after the seam is welcome when the topic actually turns there. Only the range that contains the seam line is acted on (its start and end inside the window become the paragraph boundaries); a rejected block (`range-invalid`) keeps the original break. |
| `align-edges` (default align carrier) | One HTML table `data-bcut-format="align-edges/1"`, one `<tbody data-sid>` per sentence: `td.src` holds the source words each prefixed with its 1-based ordinal (`[1]I [2]didn't [3]go …`), `td.tgt` the natural translation (`text/html`) | The same table back, `data-sid` and `td.src` byte for byte; only the **contents of `td.tgt`** change: the translation rewritten as a sequence of `<span data-src="…">chunk</span>` elements whose texts concatenated reproduce the translation exactly (punctuation stays with the chunk it ends; text left outside a span counts as an unattributed chunk). Chunk into the smallest natural semantic chunks in the translation's own order — never reorder or merge chunks to imitate the source. `data-src` is a whitespace/comma-separated list of source ordinals and ranges (`4-7`, `1 2 3`, `1-3,9`), any order, non-contiguous ok, `data-src=""` for a chunk with no source word; every ordinal at most once per sentence, unassigned function words are fine. Numbers, names, URLs and glossary terms sit in the chunk of their source ordinal. You do not cut rows and never rewrite the translation — the engine merges chunks into monotonic blocks and cuts the rows. |
| `align-rewrite` | Same table shape, `data-bcut-format="align-rewrite/1"`; each `<tbody>` carries `data-over-hard` naming the aligned chunk (source ordinal range, reading units) that cannot fit one subtitle row (`text/html`) | `td.tgt` replaced by the translation **rewritten** so its clause order follows the source clause order and every chunk fits the hard budget, already annotated with the same `<span data-src>` chunks (nothing outside spans). Keep every fact, negation, number, name, URL and locked term; only reorder clauses and adjust connectives, particles and punctuation. A rewrite that drifts more than ~25% in reading units, or drops a number/URL/Latin anchor, is rejected and that sentence falls back to whole-sentence correspondence — there is no repair round. If it cannot be reordered naturally, return the translation unchanged and annotate it anyway. |
| `align` (review/repair carrier, `--align-carrier table`) | One HTML table `align-table/1`, one `<tbody data-sid>` per sentence (`text/html`) | The same table back, one `<tr>` per display piece inside each group, `data-sid` byte for byte. Splitting a sentence into N pieces means N rows. The source cells rejoined must reproduce the input sentence — the source column may only be cut, never reworded — and the target cells rejoined must reproduce the sentence translation unless you mark the group `data-reordered="true"` (the rewrite then becomes the display text; the natural translation is kept). `data-crossing="true"` yields whole-sentence correspondence. A group carrying `class="ctx"` — read-only context the current build does not yet emit — is returned unchanged and never cut. |
| `chapters` (one part of the recording), `chapters-outline` (the whole recording's topic-unit outline) | `<article data-bcut-format="chapters-source/1">` of `<p id="p-…" data-at="HH:MM:SS">paragraph</p>` — or, for `chapters-outline`, `<h2 data-at>` / `<p class="summary">` / `<p id>` units with `<hr data-seam>` where two parts were cut (`text/html`) | Not the document back: only the chapter list, in order, each chapter exactly `<h2>title</h2>`, `<p class="summary">one sentence</p>`, `<p id="…">opening words of that paragraph</p>` — the `id` copied verbatim from the input paragraph (or unit) where the chapter starts, the opening words quoted from it. No timestamps, no end anchors, nothing else. The root's `data-aim` is the approximate chapter count; on a non-first `data-part` the beginning may just continue the previous part's topic, so the first chapter need not sit on the first paragraph. In `chapters-outline`, merge units that continue one topic (especially across a seam), keep the count near `data-aim`, and give an empty `<h2 data-untitled="true">` unit a title from context or merge it into a neighbour. Lint rejects an anchor id that does not exist in the payload (`unknown-id`; a mangled id whose opening words uniquely match a paragraph is repaired instead), an empty title (`empty-title`), and an answer with no anchored heading (`missing-id`). |
| `analysis`, `translate-brief` | Markdown context document (`text/markdown`) | The document with its `---` frontmatter and its `# Canonical Terms` / `# Bilingual Glossary` table intact, and no sections added. Table headers must read exactly `Source \| Category \| Variants \| Note \| Lock \| Origin` and `Source \| Target \| Note \| Lock \| Origin`. `Lock` and `Origin` are the user's channel: whatever a model writes there is downgraded to `Origin=analyzed, Lock=no`. Each `Target` is exactly one on-screen literal — slash alternatives fail the whole round unless the source term itself contains a slash. |

**A translate page is subtitles, not prose.** Every sentence you write is cut
into narrow display rows later — roughly 16 display cells per row for Chinese,
Japanese and Korean, about 42 characters for Latin scripts — and each row has to
be readable while the speaker is still talking. Length is part of correctness
there, so the carrier states it per sentence: `data-budget="整句≤42字"` is that
sentence's reading budget, `floor(display seconds × target-language reading
speed)` counted in reading units, not raw characters: whitespace and ordinary
commas and periods are free, and in CJK target languages a Latin letter or digit
costs about half a unit — so a required `data-rt` term is far cheaper than its
letter count. The unit label switches with the target language. It appears only on editable sentences; a frozen one is a
verbatim copy and carries none. Treat it as the tie-breaker between two faithful
wordings — drop filler, restated subjects, and redundant connectives first — not
as a ceiling to cut meaning against. **The budget never outranks meaning**: when
a sentence genuinely needs the length, take the length, and never drop a
negation, qualification, number, name, register, or an explicit causal /
contrastive / conditional / result relation to fit. A later stage can split a
complete translation but cannot recover a clause you left out. Do not put ` | `
or any other segmentation mark inside a `<p>` either — the file contract has no
draft-cut channel, and the align stage decides the rows.

**The align table is a table, not a JSON payload in HTML clothing.** Its only
columns are the id `<th>`, `td.src`, and `td.tgt`; there is no `draftTarget`, no
`useDraft`, no `sourceBreaks`, no `draftBlockers`, no hint list — do not run a
`jq` gate or emit any draft-era field against a table. What matters is the
segmentation judgement
itself: decide the target pieces first, keep bound phrases and bilingual anchors
whole, cut only at seams that really exist in the text, and leave an over-fit
piece whole rather than trading it for a dangling fragment. The budget that
judgement needs is on the carrier: `data-fit` / `data-hard` on the `<table>`,
`data-max-lines` and a human-readable `data-budget` on each group. Three flags
you may add to a group, and only these: `data-reordered="true"` to declare that
the target was deliberately rewritten out of source order (this replaces the
rejoin check with a rewrite-extent limit), `data-crossing="true"` for genuine
word-order crossing (mutually exclusive with `reordered`, which wins), and
`data-unsplittable="true"` to state that no legal cut exists — it does not
silence any lint; what it does is tell the engine that an over-wide row stayed
whole on purpose, so the group is accepted as-is instead of being sent back
once for a targeted re-cut. Leave `data-soft`
and every other attribute exactly as you found it; the `rowspan` on the id cell
is redundant bookkeeping, and a stale one costs you nothing.

Two things the table's own contract spells out and reviewers still see missed.
**The source side has a floor, not only a width ceiling.** In a group of two or
more rows, never hang a target piece on a crumb of one or two source words —
"So,", "and then", "I mean," — whose combined width is well under one row. Merge
the crumb into the row that continues its clause (forward when it is a leading
connective, adverbial or conditional opener, backward when it is a trailing
tail) and move the target cut with it, rather than leaving a target piece
stranded on two words. The floor is waived only when the sentence genuinely has
too few source words to give every row that much — then keep the shape you have.
**`data-crossing="true"` is a declaration, not an escape hatch.** Set it only
when the target order really crosses the source order and no monotonic mapping
survives: first look for cuts that keep the rows aligned, then prefer rewriting
the target into source clause order with `data-reordered="true"`, and reach for
`crossing` only when neither works. It does not license anchors landing in the
wrong row, a crumb source range, or a cut you did not want to justify — it
suppresses the bilingual-anchor check, so using it to quiet a warning hides the
defect instead of fixing it.

Rejections work exactly as in the JSON protocol, with the same
three-tries-per-`callId+leaseId` budget, the same force-pass on the third
**changed** submit, and the same `unchanged: true` no-op for a resubmitted
identical answer. What differs is the shape of `problems[]`: each entry reads
`[<code>] <detail>`, or `[<code>] <sentence-id>: <detail>` when the defect is
one sentence's. The codes are a closed set; these are the ones worth
recognizing on sight:

| Code | What it means and what to do |
|---|---|
| `document-wrapped` | Fences or prose around the document. Resubmit the bare document. |
| `document-truncated` | The answer stops early — a missing tail of ids, or a missing/duplicated/out-of-order sentinel fence. Reproduce the complete page. |
| `document-oversize` | The answer is above the 8× output ceiling — it stopped being a revision of the page. Shorten it to the page it was asked to revise. Surface-level defects no longer report under this code. |
| `surface-artifact` | A sentence ends at a dangling connector/preposition, or a Chinese transcript still has an obvious 20+ letter run-together English phrase. **This never rejects a page**: on a main polish page it is only a warning, and the engine sends those sentences to a short `polish-retry` wave afterwards; in `punct-repair` it is reported per item. When you do see it, remove the false dangling end and join the sentences, or restore spaces inside the spoken English phrase without translating or guessing content. Newlines and blank lines do not end sentences. Conflicting adjacent punctuation (`。，` / `，。` / `，，`) is not in this code at all — the engine normalises it silently. |
| `missing-id` / `empty-translation` | A sentence is absent or translated to nothing. Add exactly those. |
| `duplicate-id` | The same id twice — the page cannot be scored. Emit each id once. |
| `unknown-id` | An id that was not in the input. Advisory for editable pages; do not invent ids. |
| `frozen-modified` | A frozen sentence changed. Restore it byte for byte. (In translate the engine now ignores the model's text for frozen sentences and keeps the stored translation, recording a `frozen-ignored` warning instead of rejecting the page — but reproducing frozen sentences verbatim is still the contract.) |
| `source-drift` | A read-only region was edited (polish context regions, an align source cell, a `punct-repair` item whose words — anything other than punctuation — were changed, added or dropped), or a polish answer introduced an illegal control character (usually UTF-8 mojibake). Restore the named region; for mojibake, reopen the UTF-8 payload and reproduce the intended punctuation normally. |
| `glossary-missing` | A locked target term is absent from a translation. Put the exact spelling back. |
| `paragraph-move` | A sentence moved between paragraphs. |
| `sentence-oversize` | A `punct-repair` item came back with no new sentence-ending punctuation (or the punctuation you added could not be mapped back onto the source words) — still one sentence over 1200 source characters / 300 seconds or the 300 Latin words / 500 CJK characters cap. Re-read that item and add `.?!` / `。？！` wherever a complete thought ends (the `⏸` hints mark long pauses, `min-sentences` is the minimum count); change nothing else. On a later round the request's `problems[]` names the item by its `sNN` id; a sentence you split that is still over the cap comes back the same way, so cut it into more pieces rather than fewer. |
| `paragraph-oversize` | A `segment-repair` block came back as a single range while still over the per-language cap (300 Latin words / 500 CJK characters). Re-read that block and split it into at least the number of ranges the verdict names, breaking at every topic turn (2–6 sentences each). On a later round the request's `problems[]` names the block by its position in the payload (`第 k 块：…`); a block you split whose pieces are still far over the cap comes back the same way, so cut it into more pieces rather than fewer. |
| `range-invalid` | A `segment-repair` / `seam-repair` block (or a `speaker-repair` window) is missing from the answer, or its range list does not start at 1, is not contiguous, does not reach the block's last line, or names lines outside the block; for `speaker-repair` also a label that is not one of the window's `speakers`, or more turns than `current:` lists. The verdict names the first defect (`第 k 行没有被任何区间覆盖`, `重叠`, `越界`, `段数不得增加`…). Answer every block with `<<<BLOCK k>>>` … `<<<BLOCK-END>>>` (`<<<WINDOW k>>>` … `<<<WINDOW-END>>>` for speaker-repair) and a range list that covers exactly lines 1..n once. |
| `align-edge-ordinal` | An `align-edges`/`align-rewrite` chunk's `data-src` is unreadable, names an ordinal beyond the source word count, or reuses an ordinal already claimed by another chunk in that sentence. Fix that sentence's `data-src` lists (1-based, each ordinal at most once). |
| `align-edge-text` | An `align-edges` sentence's span texts concatenated do not reproduce the translation. Wrap the translation exactly — never add, drop, reorder or normalize a character. |
| `align-content-drift` | In `align`: a group's pieces do not rejoin the input sentence or its translation — re-cut that group, or declare `data-reordered="true"` if the rewrite was deliberate. In `align-rewrite`: the rewrite drifted more than ~25% in reading units or lost a number/URL/Latin anchor — reorder without compressing, and keep every anchor. |
| `align-over-hard` / `align-illegal-seam` | A piece is over the hard width, or cuts at a banned seam. These two are quality codes that never fail a whole page; submit lint still reports them, so re-cut every listed group by hand where a legal cut exists (moving one boundary is usually enough). The over-hard detail tells you how: `可切为「…」｜「…」` names a legal cut inside that piece — split the target there and cut its source segment at the matching place (one more row); `片内无标点/空白缝，请在词边界处切开` means the piece has no punctuation or space seam, so choose a word boundary yourself; `片内无合法切点，需连同相邻片一起重切` (often with `整句可重切为…`) means the fix is moving neighbouring boundaries, not splitting that piece alone. A piece whose translation has **no** legal cut at all (a giant identifier, or every seam is a banned seam) is no longer rejected at submit — it passes as a warning and the engine hard-cuts it — so never pad or rewrite just to satisfy the width. Only for a sentence whose **source** genuinely has no seam keep it whole and declare `data-unsplittable="true"` — that changed answer is what the third submit lets through; resubmitting the same file three times does not (it is `unchanged`, no try spent). When the engine also finds no legal re-split of its own for an over-hard piece, it keeps your answer as a fallback and sends **that one sentence** back once in the repair round with a `… over the absolute hard ceiling … move a boundary … or declare data-unsplittable="true"` detail — move the cut, or declare `data-unsplittable="true"` if the source truly has no legal seam. |
| `context-invalid` | The context document lost its frontmatter, a required section, or an exact table header. |

Codes not in that list do not exist; anything the engine merely notices —
collapsed blank lines, a stripped wrapper, a stale `rowspan`, an echoed `⏸` —
is recorded as a warning and never reaches `problems[]` or the retry budget.

One mixed-protocol trap, real in a single run:

- A file-v1 polish still falls back to `polish-retry` calls for low-similarity
  sentences **and for sentences the page carried a `surface-artifact` on** (each
  item names which, via `reason`), and **`polish-retry` is always `json-v0` with
  a JSON payload and a JSON answer**. A worker filtering `--kinds polish` never
  sees them and the producer blocks; a worker filtering `--kinds polish,polish-retry`
  must branch per call on `protocolVersion`. The wave is at most two rounds; the
  second round carries a per-sentence `retry_reason`.
- A `polish-retry` answer must not reintroduce a dangling connector/preposition
  sentence end, conflicting adjacent punctuation, or a run-together Latin phrase
  that the file-v1 page already repaired. Preserve the page's corrected surface;
  the engine keeps that locally confirmed page correction if the JSON retry regresses it.
  After the two rounds, a still-unfixed low-similarity sentence falls back to the
  raw ASR words, while a still-unfixed `surface-artifact` sentence **keeps your
  text** and is only counted — so a rough surface is always better than a refusal.

One thing that looks like trouble and is not: under the file contract, translate
repairs come back as fresh `attempt: 1` calls against `contracts/translate.md`
with a smaller payload and fewer sentences, not as an `attempt: 2` of your page.
A second, thinner translate batch arriving after the first is the repair wave
doing its job.

## Close the quality loop after translate

`translate` prints `data.advisories` — accepted per-sentence quality notes.
Entries prefixed `polish 前置:` are the exception: they are stage-level
prerequisite notices (unpolished transcript, pending polish candidate) carrying
no sentence id, so keep them out of the sentence-id union and act on the command
they name instead of re-aligning.
Do not start a repair task while advisories are still arriving. After the
producer reaches its terminal event, run one strict check, then build the union
of actionable sentence ids from both outputs. Triage that complete set before
spending another call:

- Re-align objective defects only: a dangling/bound phrase, stale alignment,
  a piece over the hard ceiling, or a timing/width issue with an explicitly
  actionable seam. Current engines reject risky source boundaries during the
  same task and fold them into its one global repair call; seeing one in
  `advisories` usually means the installed CLI is older than this workflow.
- Do not re-run soft gray-band notes merely for symmetry: a complete 15–16
  character CJK clause below hard, or uneven source spans explicitly attributed
  to target reordering/compression. Record that they were reviewed and preserve
  the natural semantic cut. A gray-band piece with an explicit internal clause
  seam may join the single repair batch when the check supplies a concrete fix.
- Do not treat an atomic short utterance as an alignment defect merely because
  its source duration is short; only repair it when a safe neighboring merge or
  timing cut exists.

For actionable non-hard advisories, apply pending Studio edits once, then
re-align every named sentence in one command and pass all reasons together
(`--instructions` reaches the align contract):

```bash
bin/baocut studio apply "/path/demo.bcut" --json
bin/baocut translate "/path/demo.bcut" --lang zh --align-only \
  --sentences s-a1,s-b2 \
  --instructions "s-a1 的宽片在「……」后补一刀；s-b2 不要在产品名内切" \
  --llm agent --jsonl
```

When you want one bounded sweep over every objective alignment defect the
check still reports, use the built-in refinement; it runs one round, rechecks,
and reports residuals without looping:

```bash
bin/baocut refine-align "/path/demo.bcut" --lang zh-Hans --only-hard
```

Know what that command actually dispatches before you choose it — its name
undersells the payload:

- `--only-hard` skips exactly one class: `align-overfit` sentences that are
  over fit but under hard (the 16–20 gray band). Every other objective
  hotspot is still collected — `align-stale`, `align-source-ceiling`,
  `align-source-seam`, `align-target-seam`, `align-source-fragment`,
  `align-paired-density`, `align-bilingual-anchor`,
  `align-degraded-fallback` (each capped at 40 sentences per round) and
  `translation-overflow`. So a check that lists 2 hard sentences routinely
  becomes a 55-sentence `refine-align` payload; that is by design, not a bug.
- The payload is one `translate --align-only --sentences <all hotspots>`
  call with per-sentence diagnosis attached to the align contract; every
  sentence in it is there because check flagged it, so the worker must re-cut
  **every** row, not only the ones it recognizes as hard. Answering the two
  hard rows and echoing the other 53 unchanged gets the whole answer sent
  back with 53 `align-over-hard`/seam problems and burns a lint try. Staff it
  with a high-tier worker (see the tier note above).
- One round is the rule for explicit `refine-align`; it adds at most one extra
  round,
  and only when the first round left work undone: some flagged sentence came
  back with its source boundaries untouched (the worker skipped or echoed
  it), or the 40-per-class caps deferred sentences. That extra round resends
  only those no-op/deferred sentences; a sentence whose source geometry did
  change is treated as stubborn and left in `remaining[]`, not used to drag
  the whole residual set through another call. Auto's closing pass has no
  extra round and no fresh align repair budget. Sentences still flagged after
  that are reported in `remaining[]` for the root to judge, not re-queued.
- If the goal is narrower — clear only the strict hard blockers and leave the
  other hotspots alone — do not reach for `refine-align --only-hard`. Name the
  sentences yourself with the same entry point refine-align uses internally:

  ```bash
  bin/baocut translate "/path/demo.bcut" --lang zh-Hans --align-only \
    --sentences s-g4.0,s-g12.3 \
    --instructions "只处理这两句的硬超宽：在自然语义缝补一刀；其余不动" \
    --llm agent --jsonl
  ```

Run `check --strict` once after that consolidated repair. Do not create separate
translate tasks for one- or two-sentence leftovers between checks. Only if the
final check still reports blockers may one exceptional residual batch run; it
must contain every remaining actionable sentence.

Objectively broken seams (a piece ending on a dangling connective such as
「拆分给 |」, ending on a form that still needs what follows such as
「剩余的 35% 得 |」/「输出质量在数学上 |」, starting with a bound particle such as
「| 于我们…」, starting with a coordinator such as 「| 和 PagedAttention」, cutting
`the | noun`, or cutting inside a pair of quotes or brackets such as
「…包含名为“ | PluginDataJSON”的清单」) are rejected at submit time in
`problems[]` or folded into the task's single global repair call. Fix exactly those; do not launch a separate
worker generation.

Do not reuse a lease, submit to a different task, or hand-edit call files. A submit
is validated before it is committed; correct the response when lint rejects it.

## Report timing without double-counting

For a long Agent-backed job, read `task status` once after the producer exits.
Report the accepted call count and elapsed wall time from the earliest
`createdAtMs` to the latest `answeredAtMs`. `timings.queueMs` is the sum of each
call's wait and double-counts overlapping queue time; never present it as user
elapsed time. Use `workerMs` to compare answer effort, and call out when a wide
parallel batch stayed with a single worker throughout while subagent slots were
free.
