# Agent task loop

AI stages using `--llm agent` may pause with a pending call. Keep the pipeline
process alive and answer through its leased task queue.

Worker discipline (violations observed to waste whole worker turns):

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
  `suggestedWorkers`, `claimKinds`, and `poolKey`), and `task status` reports
  the same grouping under `workerPlans[]`. When one of them shows N pending
  independent calls, top the running workers up to
  `min(pendingCount, subagent slots you can actually run)` for that
  `claimKinds`. `suggestedWorkers` is computed from the pending count and is an
  upper-bound hint — a ceiling to aim at while work is queued, never a floor to
  fill before the work exists. Do not let a generic loop steal a serial stage.
- Cover every kind the engines can dispatch, not just the common ones. The full
  set is `analysis`, `polish`, `polish-retry`, `segment`, `segment-index`,
  `chapters`, `translate-brief`, `translate`, `align`, `cleanup`, `broll`.
  `polish-retry` (dispatched when a polish page trips the similarity gate) and
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
- `export BCUT_LLM_MAX_WORKERS=<worker slots you can actually run>` before
  starting `bcut`, whenever that number differs from the default 3. It is a
  concurrency ceiling, not a target to staff up to. The producer uses it for
  both `suggestedWorkers` and translate page sizing: it decides whether the
  compact page cap can save a wave. Page counts are no
  longer rounded up to a whole multiple of it — rounding only paid for extra
  fixed prefixes without removing a wave.
- Give every worker process a unique `--worker` id. One process should reuse
  its own id serially for the whole flow, but two concurrent processes must
  never share an id — a second claim with an active id renews the first lease
  and both processes end up answering the same call.
- Pass `--kinds` matching the stage the worker was launched for (for example
  `--kinds translate,align`). Without it, a worker loop left over from a
  previous stage claims the next stage's calls and answers them without the
  orchestrator's quality context.
- Chain, then exit — do not idle. A worker submits with `--next` (or claims
  again with a bounded timeout), so the same session carries straight from its
  page into the batch's global repair call and a following `refine-align`
  without another startup delay. A momentary `pendingCount:0` while the
  producer aggregates a batch is still not a terminal condition, but what
  covers it is that `--next` chain plus the producer's terminal event, not a
  resident set of pollers. When a claim times out on an empty queue, the worker
  reports and exits; that is a normal ending, not an error, and the root does
  not respawn it until a new dispatch needs it. Restarting a worker costs one
  startup; keeping an idle one costs a full model session for the whole
  remaining run.
- Give every delegated worker the same project path, a `--kinds` filter
  matching the batch it was started for, a distinct worker id, and
  responsibility for the complete claim → inspect → answer → submit `--next`
  loop. Whether a group may be topped up at all is decided by
  `workerPlan.execution` and its `pendingCount`, never by a memorized list of
  stage names — `analysis` and `translate-brief` dispatch as `parallel` even
  though they often carry a single pending call, and a merge step is serial. A
  group reported as `serial` stays single-worker; polish stays single-worker
  even with several pages pending, because it carries context across them.
  Before running the quality gate, the root waits for
  every outstanding claim to drain — after the pipeline emits its terminal
  event or `studio/worker_stop` appears, tell any worker still running to stop
  and wait for it, so no answer is still in flight while the gate runs.
- A Sonnet-tier worker model is enough; do not use the highest tier as a
  worker unless the user asks (the orchestrator taking over a stubborn call
  is the exception). Claim, answer, and submit within the lease — read the
  contract and payload in the same step as the claim rather than studying
  every payload before writing.
- Budget against the `leaseSec` the claim reports, divided by the call's
  `items`. Identical translate pages have been measured at 6.7s and 27.4s per
  line by different workers on the same batch — the spread is working style,
  not payload difficulty. Once an answer passes its shape gate, submit: a
  second full re-read of lines already written mostly buys queue time, and
  submit-time lint plus the producer's global repair call catch what it would
  have caught. A worker that runs past its lease loses the call to a
  replacement and its finished answer is discarded, so an over-careful worker
  costs the batch a whole duplicated page.
- Translate pages stay at the 16-line fast cap by default. The compact 21-line
  cap engages only when it actually removes a worker wave, and page counts are
  never rounded up to a whole multiple of the worker slots; the compact cap
  removes repeated contract, brief, and glossary prefixes. Do not split a compact page manually or start an extra worker for
  part of it; its lease and item count already reflect the larger bounded page.
- One caveat on how far that reassurance reaches: a translate answer's inline
  `alignments` draft is never rejected at submit. The align stage re-checks it
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
   `min(pendingCount, available subagent slots)` now. Do not wait for one
   worker to finish before starting the next, and do not start workers for a
   group that has no pending calls. Each worker claims from the shared queue
   with its own id and the exact `claimKinds` filter:

   ```bash
   bin/baocut task claim "/path/demo.bcut" --worker codex-1 --timeout 30 \
     --kinds align --json
   ```

   Stage boundaries need no advance staffing. The align batch dispatches
   seconds after the last translate submit, and a worker that submits its
   translate page with `--next` claims straight into it — brief the workers on
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

2. Follow the returned prompt and response schema exactly. Write only the
   requested answer to a temporary file outside the project. Its name must be
   unique per worker and call (for example
   `/tmp/baocut-align-codex-1-c0001.json`) so concurrent workers cannot
   overwrite one another.

3. For an `align` answer, run a local shape gate before submitting:

   ```bash
   jq -e '(.sentences | type == "array") and all(.sentences[];
     (.key | type == "string") and
     (if .useDraft == true
      then (has("sourceBreaks") | not) and (has("target") | not)
      else ((.sourceBreaks | length) + 1 == (.target | split(" | ") | length))
      end))' \
     /tmp/baocut-align-codex-1-c0001.json
   ```

   Most sentences arrive with a usable draft and answer `{"key":…,
   "useDraft":true}` alone, so the gate must branch on it — a gate that always
   reads `.target` fails with `split(null)` on the common path. Sending
   `sourceBreaks`/`target` alongside `useDraft` is not an engine error — the
   extra fields are silently ignored and the draft wins — but keep the gate
   strict anyway: the fields are wasted work and mask intent. What the engine
   *does* reject is `useDraft` on a sentence whose payload says
   `draftReady=false`; those sentences need an explicit answer that fixes the
   listed `draftBlockers`.

   Then compare every proposed break with the current payload:

   - Decide the target-language pieces first from the complete natural target,
     its fit/hard budget, and protected terms; freeze those pieces before
     choosing any `sourceBreaks`. Source hints may map fixed pieces to word
     ranges but must never create, remove, or move a target cut.
   - When the payload says `targetFrozen:true`, copy `draftTarget` exactly with
     every existing separator and change only `sourceBreaks`; do not return
     `useDraft` or `reordered` for that sentence. `pieceCount.min` does not
     apply to such a sentence — never add a target cut to satisfy it.
   - Original subtitle cues and `breaks` are deliberately absent. Never infer
     or imitate them. If monotonic mapping is difficult, preserve the frozen
     target pieces and use the contract's reorder/crossing path.
   - Never use a `sourceBreakHint` marked `risky` or `blocked`; `bN left^right`
     means the cut is between `left` and `right`. A `blocked(...)` boundary is
     a hard syntax constraint even when the payload also reports a pause/seam.
   - Keep every `bilingualAnchors` source phrase and its target phrase in the
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
     row for a dangling tail. `draftBlockers` names both sides of the seam when
     one exists.
   - Source length alone does not create a target cut. If `draftBlockers` names
     an over-dense paired row, split only at the complete target-language seam
     it identifies; `、` is allowed there only between complete parallel
     actions, not inside an ordinary noun list.
   - Never regress the worst paired source row. `draftWorstSourceUnits` /
     `draftWorstSourceSeconds` report the incoming draft's widest and longest
     paired source row. An answer that still leaves a row past the paired-row
     ceiling AND wider or longer than that worst row is rejected. Cut the
     offending wide row itself; adding a cheap cut elsewhere (for example right
     after the first word, to reach `pieceCount.min`) while leaving a huge tail
     row is strictly worse than keeping the draft's boundaries.
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
   - Never cut before the coordinators 和/及/与 — never
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
     --worker codex-1 --file "/tmp/baocut-align-codex-1-c0001.json" \
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
   `{"status":"ok","submitted":<callId>,"next":"empty"}`.

   If submit returns `rejected`, keep the same lease, fix only the reported
   problems, rerun the shape and boundary checks, and resubmit. Do not reclaim
   the call or start a replacement task. The lint budget is 3 tries per call
   and lease: each rejection reports `triesLeft`, and the 3rd submit under the
   same lease is force-passed to engine acceptance instead of being rejected
   again (the engine's own validation still applies). The budget is counted
   per `callId+leaseId`, so a replacement worker on a new lease starts with a
   fresh budget — a predecessor's exhausted tries do not carry over.

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
answer-generation time when diagnosing a slow run.

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
  those items.
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
- A claimed call may carry `hedge: true` (with `hedgeOf` naming the original
  call). It is a tail-latency duplicate the producer dispatched because the
  original has been in flight far longer than the rest of its batch: answer it
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
  `BCUT_PROVIDER_MAX_LANES` (default 8, `0` = unlimited) sets both the
  concurrent lanes and the translate page shape, so changing it changes how
  the batch is paged, not just how fast it runs. The provider path also has
  no submit-lint buffer: a malformed answer goes straight to engine
  validation and consumes one of the engine's bounded retries.

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

When the complete residual set is hard-only, prefer the built-in bounded
refinement; it runs one round, rechecks, and reports residuals without looping:

```bash
bin/baocut refine-align "/path/demo.bcut" --lang zh-Hans --only-hard
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
