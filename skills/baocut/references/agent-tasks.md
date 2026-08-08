# Agent task loop

AI stages using `--llm agent` may pause with a pending call. Keep the pipeline
process alive and answer through its leased task queue.

Worker discipline (violations observed to waste whole worker turns):

- Start the worker pool **before** launching the pipeline command, not after an
  event arrives. The producer's `task` event and its first `batch-dispatch`
  land at essentially the same moment, so a pool started on that signal is
  already late by a full worker startup. Workers launched ahead of time simply
  sit in a blocking `task claim --timeout <s>` until work exists; that wait is
  a lock-free prescan costing one directory stat per poll, so idle workers do
  not contend with the producer. Measured on a 21-minute talk: the first
  `analysis` call waited `queueMs 201408` against `workerMs 85939` — 201s of
  pure queue latency, more than twice the answer time — purely because the
  pool was started after the dispatch was observed. With the pool prewarmed,
  every later call in the same run claimed in 50–75ms.
- Each `batch-dispatch` event carries a structured `workerPlan` (`execution`,
  `suggestedWorkers`, `claimKinds`, and `poolKey`). Assign that many warm
  workers immediately, and do not let a generic loop steal a serial stage.
- Cover every kind the engines can dispatch, not just the common ones. The full
  set is `analysis`, `polish`, `polish-retry`, `segment`, `segment-index`,
  `chapters`, `translate-brief`, `translate`, `align`, `cleanup`, `broll`.
  `polish-retry` (dispatched when a polish page trips the similarity gate) and
  `segment-index` are the ones a hand-written `--kinds` list usually forgets:
  if no worker can claim them the producer blocks with no further output, and
  a stalled queue is indistinguishable from a quiet one in the event stream.
  Keep one worker claiming with **no** `--kinds` filter as the catch-all, and
  watch the event stream for staleness rather than only for error events.
- Inspect `task status` before the first claim. When `suggestedWorkers` is
  greater than one and the host exposes parallel subagents, this skill
  explicitly requires delegating independent queue workers: start
  `min(suggestedWorkers, available worker slots)` workers before draining the
  batch. Never start fewer than `suggestedWorkers` when slots are free — the
  producer already sized it against the pending batch, and a worker short of
  the batch count turns answer time into queue time (a 230-sentence talk once
  left two translate pages queued 736s and 1110s behind a four-worker cap).
  The root keeps the producer session alive and owns the final quality gate; it
  must not serially claim the whole batch while independent workers are
  available. If parallel workers are unavailable, run one loop and report that
  limitation instead of pretending the queue was parallel.
- `export BCUT_LLM_MAX_WORKERS=<worker slots you can actually run>` before
  starting `bcut`, whenever that number differs from the default 8. The
  producer uses it for both `suggestedWorkers` and translate page sizing: pages
  are rounded up to a whole multiple of it so every wave runs full. Leaving it
  at 8 while only 7 slots exist splits a 12-page batch into 7 + 5 and makes the
  second wave idle for most of one answer time.
- Give every worker process a unique `--worker` id. One process should reuse
  its own id serially for the whole flow, but two concurrent processes must
  never share an id — a second claim with an active id renews the first lease
  and both processes end up answering the same call.
- Pass `--kinds` matching the stage the worker was launched for (for example
  `--kinds translate,align`). Without it, a worker loop left over from a
  previous stage claims the next stage's calls and answers them without the
  orchestrator's quality context.
- Keep workers alive across the initial batch, its global repair call, and a
  following `refine-align`. A momentary `pendingCount:0` while the producer is
  aggregating a batch is not a terminal condition; stop only after the
  pipeline emits its terminal event or `studio/worker_stop` appears.
- Size the pool from `task status`: a single worker draining parallel batches
  serially is the largest observed time waste. Long-video align typically
  takes 3–4 workers, batch translate 2–3; polish carries context across pages
  and analysis/`translate-brief`/brief merge are serial stages, so keep those
  single-worker. Give
  every delegated worker the same project path and `--kinds`, a distinct
  worker id, and responsibility for the complete claim → inspect → answer →
  submit `--next` loop. Workers use bounded claim timeouts and stay available
  through momentary empty queues; after the producer reaches a terminal event,
  the root explicitly tells every delegated worker to stop and waits for them
  before running the quality gate.
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

1. Prewarm the pool at the `task` event, then inspect the dispatch/status plan
   and assign workers before claiming:

   ```bash
   bin/baocut task status "/path/demo.bcut" --json
   ```

   `workerPlans[]` groups pending work by task and kind. For independent calls,
   assign the reported `suggestedWorkers` from the warm pool now. Do not wait
   for one worker to finish before assigning the next. Each worker claims from
   the shared queue with its own id and the exact `claimKinds` filter:

   ```bash
   bin/baocut task claim "/path/demo.bcut" --worker codex-1 --timeout 30 \
     --kinds align --json
   ```

   Keep the pool warm across the stage boundary. The align batch dispatches
   seconds after the last translate submit, so a pool that has already exited
   leaves those calls sitting unclaimed — one run lost 212s that way. Either
   brief the pool on both contracts up front and claim
   `--kinds translate,align`, or spawn the align workers before the translate
   batch drains. Never widen `--kinds` without the briefing: that is the case
   the filter exists to prevent, where a still-spinning worker grabs the next
   stage's call holding only the previous stage's contract.

   Translation pages are deliberately sized so large jobs can checkpoint and
   run in parallel. The root may handle a stubborn repair call after the pool
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
   reads `.target` fails with `split(null)` on the common path, and
   `useDraft` alongside `sourceBreaks`/`target` is rejected by the engine.

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

   If submit returns `rejected`, keep the same lease, fix only the reported
   problems, rerun the shape and boundary checks, and resubmit. Do not reclaim
   the call or start a replacement task.

5. Continue until the pipeline emits its terminal event. Keep at least one
   `align` worker polling through batch aggregation so a global repair call is
   claimed immediately. Use `task status` or `task watch` when the producer
   appears stalled.

`task status` also reports `requestChars`, `estimatedCost`, and `items` for
pending and completed translate/align calls. Use these together with
`completedCalls[].queueMs`, `workerMs`, and `totalMs` plus the aggregate
`timings` object to distinguish worker startup delay, batch imbalance, and
answer-generation time when diagnosing a slow run.

When `queueMs` comes out bimodal — some calls around 100s and others around
1000s in the same batch — suspect lease expiry rather than batch imbalance.
A worker that overruns its lease has its answer rejected as `stale`, and a
second worker redoes the whole page, so the call's queue time absorbs the first
worker's entire effort. Confirm it by checking whether the long-queue calls were
credited to a different worker than the one that first claimed them, and whether
any worker reported a `stale` submit.

## What to expect from calls

- Call kinds are open-ended — `analysis`, `polish`, `translate`, `align`,
  retry variants such as `polish-2`, and future kinds all flow through the
  same claim/submit loop. Always read the call's own contract and payload;
  do not assume the shape from a previous kind.
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
- Answered calls survive producer restarts: if the pipeline dies and is rerun,
  calls whose content is unchanged reuse the stored answers automatically
  (`call-reused` events); only unanswered or changed calls come back.
- Transient `busy` responses around submit are normal under concurrency; the
  CLI retries lock contention internally (bounded window, default 120s). If a
  command still fails `busy`, wait a few seconds and retry the same command once.
- Idle `claim` polling no longer takes the project write lock, so a worker
  waiting on an empty queue costs the producer nothing. Before this fix a pool
  of idle long-pollers could starve a running producer out of its own final
  write and kill the whole stage — if you are on an older CLI, keep the pool
  sized to the actual batch rather than leaving spare workers spinning.

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
elapsed time. Use `workerMs` to compare answer effort, and call out when a
single worker serially drained a batch that requested more workers.
