# Known errors → exact recovery

Literal error → cause → recovery. Check here BEFORE improvising a workaround —
most of these have one correct next command. (JSON errors arrive as
`{"status":"error","error":"…"}`; submit lint rejections as
`{"status":"rejected",…}`.)

## Version compatibility (M83a)

**`This BaoCut app (vX) is older than the baocut skill needs (vY+)…`** (exit 3,
JSON `{"status":"error","mustUpdate":"app","action":"https://baocut.app"}`)
The installed app/CLI is older than this skill's `minAppVersion`. The skill's
instructions assume CLI features this app lacks.
→ Tell the user to update BaoCut for Mac from https://baocut.app (the in-app
updater under Settings › About, or the sidebar update icon, does app + CLI in one
step). This is a REQUIRED upgrade — do not route around it or fall back to an
older command form.

**`This baocut skill (vX) is older than this CLI supports (vY+)…`** (exit 3,
JSON `{"status":"error","mustUpdate":"skill",…}`)
The installed skill predates the current CLI contract.
→ Update the skill: `npx skills add JimLiu/baocut` (or re-clone per the repo
README). Then retry.

**A one-line stderr note `a newer BaoCut app may be available…`** (NOT an error;
exit 0, the command still ran)
The skill is newer than the app shipped with — a soft heads-up only. Continue;
mention the optional update if the user asks.

Only `--help` and `--version` bypass these checks (so you can always diagnose).

## Task protocol

**`{"status":"rejected","problems":[…],"triesLeft":N}`** (task submit)
The app's synchronous lint refused the answer; nothing was consumed.
→ Fix EXACTLY the named problems in the answer file, resubmit with the SAME
`--lease-id` (and `--next`). Never rewrite unrelated parts. After 3 rejects
the answer passes through to the engine's own fallback chain. To check without
spending a try: `task validate <taskId> --call <id> --file <answer>`.
Do NOT hand-write your own validator — validate IS the submit lint.

For polish, `correction coverage is below … 70% atom-LCS gate` means the Agent
omitted, duplicated, summarized, or over-rewrote source content. Preserve every
word once and in order while still applying known spelling/term corrections;
do not resubmit a shorter paraphrase or an unchanged copy that abandons the
confirmed terminology.

**`introduces the Unicode replacement character U+FFFD (�) … byte-truncated
mojibake`** (polish/segment submit)
Your answer file contains `�` where the source did not — a multibyte CJK
character was chopped in transit (long text echoed/pasted through a truncating
terminal). The bytes are GONE; you cannot fix this by deleting the `�`.
→ Re-`Read` the `payloadFile`, re-derive the correction, and `Write` the answer
file directly in UTF-8 (never echo/heredoc/paste the content through a shell).
Resubmit with the SAME `--lease-id` and `--file`. This gate also runs at
write-back time, so an unfixed `�` never reaches the transcript.

**`"status":"stale-lease"` / `"already-answered"` / `"ownership-lost-before-lint"`**
This worker no longer owns the call (lease expired and someone else claimed it,
or the answer already landed). The submitted answer was archived; the official
response is untouched. → Discard the local answer and go back to `task claim`.

**`{"status":"already-claimed","heldCallId":…,"heldLeaseId":…}`** (task claim, M81)
Single-lease is enforced: this worker still holds another live call, so `claim`
refused a second one (exit 1). → Do NOT claim again. Answer the held call —
`task submit <taskId> --call <heldCallId> --lease-id <heldLeaseId> --file <a>
--next` — or release it (`task release … --reason <why>`). `--force` bypasses
the guard only if you genuinely need two leases (rare).

**`task claim`/`wait` returns `"status":"stalled"`, or `task status` shows
`stalledClaimCount > 0`**
The worker process died (crash/kill) holding a lease. → `baocut task resume
<taskId>` — engines resume from page checkpoints; a finished transcription is
never redone. Also make sure workers run `claim`/`submit` in the FOREGROUND
(never `run_in_background`/`&`) — a backgrounded worker drops off and leaves a
claimed-but-unanswered call.

**`"status":"failed"`**
→ `baocut task log <taskId>` for the worker's last lines, then
`task calls <taskId>` for the failing request. Fix the cause; `task resume`.

## Project locking & state

**`project <pid> is busy — another baocut process holds its activity lock`**
One mutating run per project (M40 flock). → `baocut --json task list <pid>`
to find the owner; wait, or `task cancel <taskId>`. If NO live process owns it
(dead run), the flock is already free — this error only fires for a live one.

**`status is transcribing but no live run owns this project`** (project show hint)
Orphan index state from a killed run. → `baocut project repair <pid>` —
recovers a finished doc to complete, else marks error with a retry hint.

**`no such file (and not a valid http/https URL): X`** (transcribe/auto)
The positional is neither an existing file nor a URL-looking string (scheme-less
inputs need a dot-host and a path, e.g. `www.youtube.com/watch?v=…`).
→ Check the path; for URLs pass the full `https://…` form.

## URL ingestion (M78)

**`yt-dlp is not installed — run “brew install yt-dlp”, then retry`**
→ Ask the user to `brew install yt-dlp` (or install it if you may), then rerun.
The binary resolves from `/opt/homebrew/bin`, `/usr/local/bin`, or PATH.

**`yt-dlp: ERROR: …`** (metadata probe or download)
The site refused (age gate, region lock, removed video, outdated yt-dlp).
Metadata failures abort BEFORE any project is created. A mid-download failure
leaves the project in `error` → retry with
`baocut transcribe --project <pid>` (re-downloads from the recorded URL);
if the error mentions signatures/format extraction, suggest
`brew upgrade yt-dlp` first.

## Transcription & models

**`cloud model 'X' is GUI-only — pick a local model`**
The CLI cannot run cloud STT (no key/consent flow). → `baocut model list`,
use a local id (default `qwen3-asr-0.6b`).

**`MLX shader library missing next to the app binary — run scripts/build-metallib.sh after swift build.`**
Fresh checkout/config without the metallib. → `./scripts/build-metallib.sh debug`
(cheap re-run; needs the Xcode Metal Toolchain).

**`No speech detected in the audio.`**
VAD found nothing (wrong file, silent track). → Verify the media has speech;
check `--source-lang` if the language was forced wrong.

## Quality gate

**`baocut audit` exits 2 (FAIL)**
Not a crash — the report names each failing check (boundary drift, seam moves,
flashes, coverage…). → Read the JSON report's failing counters; recovery.md
maps each counter to its repair (usually `task start align --from pristine`
or a stale re-run), then re-audit to 0.

**`baocut audit … && <next>` never runs `<next>`** (M81)
`audit` exits 2 on FAIL by design, so `&&` short-circuits. → For a chainable
gate use `baocut finish-check <pid> && <next>` (finish-check always exits 0
and carries the verdict in `ready`), or separate with `;` and read the JSON.

**polish reported PASS but a user-specified term (子A证 / 克拉克 / Manus) is still
wrong** (M81)
The residual-variant detector only flags variants the analysis pre-scan
catalogued, and the ~0.7 atom-LCS polish gate rejects the biggest term
corrections. → Fix them deterministically: `baocut terms fix <pid> --map
"克拉克=Claude Code,Manus=Manus"` (locks the terms, then `task start translate …
--stale-only` to re-align). Prevent it next time with `--terms-file` at
transcribe/auto time so the terms are authoritative from the first pass.

**`audit` shows `zero-duration-words` / `cleanup-filler-zero-duration` that no
`cut` command can remove** (M81)
These are near-zero-duration ASR-noise tokens — the cut mechanism drops any
region with `t1 <= t0`, so they are structurally uncuttable, not a missed cut.
→ `baocut timing repair <pid>` re-fits the word timings (safe anytime, marks
nothing stale), then `baocut cut detect <pid>` if any became audible. A
`polish-introduced-zero-duration` FAIL has the same fix.

**`speakers reidentify` (direct) errors on a later `speakers apply`**
Pre-M81 the direct (non-`--review`) mode returned a `proposalId` even though it
had already applied AND deleted that proposal, so `apply --proposal <id>` failed
"proposal not found". → Fixed in M81: direct mode now returns `applied:true` and
NO `proposalId`. Only `--review` creates a proposal to apply later; if you see a
`proposalId`, you ran `--review`.


## Editing (M79/M80)

- `no such file: <path>` (broll add) → the asset moved before ingest copied
  it, or a fabricated path → source the footage first (frames / user file /
  your own tools) and attach an existing local file. BaoCut never downloads.
- `--rect expects "x,y,w" as percent of frame` → PiP rect is center-x,
  center-y, width in PERCENT (e.g. `"72,28,32"`), not pixels or 0–1 fractions.
- `no cut clip '<id>'` (cut restore) → ids come from `baocut cut list`,
  they are clip ids (`clip-N`), not proposal ids (`cut-sl-…`).
- `no words in range` / span-too-short (cut add) → the region snapped to word
  edges and collapsed → cut by `--start/--end` on the actual gap, or widen.
- cleanup submit `status:"rejected"` shapes — `span … is out of range`,
  `includes an already-cut ⌫word⌫`, `crosses a paragraph (¶) boundary`,
  `a retake must carry alt` → fix exactly the named problem locally and
  resubmit on the same lease; never resend the identical answer.
- broll submit `unknown word id` → copy ids verbatim from the payload's
  `<id|mm:ss>word` tokens; never invent or normalize them.
- `project … is busy` during `cut`/`broll` mutations → a worker holds the
  project lock; wait for the stage to finish (or `task cancel`), then retry.
