> 移植自 BaoCut v2；文中的数据模型名（TranscriptDoc 等）指 v2 的模型，与 v3 文档模型的对应见[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# Translation prompt A/B gate

This gate turns the acceptance criteria in
[`bcut-translate-prompt-upgrade-design.md`](../../archive/subtitle/bcut-translate-prompt-upgrade-design.md#8-基准与测试)
into a repeatable report. It does not send credentials or invoke an LLM; provider
runs and Agent workers remain explicit operator actions.

## Prepare isolated copies

Build or retain one `bcut` binary for the baseline ref and one for the candidate
ref. Then create copies outside the repository:

```bash
python3 scripts/bench/translate_prompt_ab.py prepare \
  --project /path/p1222.bcut \
  --output /tmp/p1222-translate-ab \
  --language zh-Hans \
  --baseline-ref <baseline-commit> \
  --candidate-ref <candidate-commit>
```

`prepare` accepts both current `.bcut` packages and legacy extensionless BaoCut
project directories, and refuses to overwrite a prior run. In each new copy it
clears `tasks/`, `logs/llm/`, and the target-language brief cache, preventing
call/log/brief reuse without mutating the source project. Preserve a reviewed
glossary separately and pass it to `report --glossary` as shown below.

## Run both sides

Run the same command, model, effort, worker count, instructions and tone against
both copies. Save the complete JSONL stream, final task status and strict check:

```bash
BASE=/tmp/p1222-translate-ab/baseline.bcut
CAND=/tmp/p1222-translate-ab/candidate.bcut

/path/baseline/bcut --jsonl translate "$BASE" --lang zh-Hans --llm agent --force \
  | tee /tmp/p1222-translate-ab/baseline-events.jsonl
/path/baseline/bcut --json task status "$BASE" \
  > /tmp/p1222-translate-ab/baseline-status.json
/path/baseline/bcut --json check "$BASE" --lang zh-Hans --strict \
  > /tmp/p1222-translate-ab/baseline-check.json

/path/candidate/bcut --jsonl translate "$CAND" --lang zh-Hans --llm agent --force \
  | tee /tmp/p1222-translate-ab/candidate-events.jsonl
/path/candidate/bcut --json task status "$CAND" \
  > /tmp/p1222-translate-ab/candidate-status.json
/path/candidate/bcut --json check "$CAND" --lang zh-Hans --strict \
  > /tmp/p1222-translate-ab/candidate-check.json
```

Drain each Agent queue according to `skills/baocut/references/agent-tasks.md`.
Do not compare runs with different worker pools or provider/model settings.

## Grade

```bash
python3 scripts/bench/translate_prompt_ab.py report \
  --glossary /tmp/p1222-reviewed-brief-zh-Hans.json \
  --baseline-project "$BASE" \
  --baseline-events /tmp/p1222-translate-ab/baseline-events.jsonl \
  --baseline-status /tmp/p1222-translate-ab/baseline-status.json \
  --baseline-check /tmp/p1222-translate-ab/baseline-check.json \
  --candidate-project "$CAND" \
  --candidate-events /tmp/p1222-translate-ab/candidate-events.jsonl \
  --candidate-status /tmp/p1222-translate-ab/candidate-status.json \
  --candidate-check /tmp/p1222-translate-ab/candidate-check.json \
  --output /tmp/p1222-translate-ab/report.json
```

Exit code `0` means pass, `1` means a tolerance was exceeded, and `2` means the
run is incomplete. The report grades locked glossary coverage, inline-draft
rejection, align calls/worker/total time, translation page worker time and
strict-check output. Provider-direct runs fall back to `logs/llm` response time
when no Agent `workerMs` exists.
`--glossary` accepts a reviewed `DocumentBrief` JSON (`glossary[]`) or a
`{"terms":[{"source":"...","target":"..."}]}` fixture. The same terms score
both runs, including pre-upgrade baselines that do not emit per-line `rt`.
Without it, the report falls back to locked `rt` telemetry and is incomplete if
no locked term occurs. Human review should still inspect valid alternate
renderings because exact-match telemetry cannot infer them reliably.

## Execution record: 2026-08-04

The gate itself was validated against isolated copies of the 230-sentence
p1222 project and the legacy extensionless p850 project. A baseline binary was
built from `16a206b` (the parent of the prompt-upgrade commit), alongside the
candidate at `4c246fe`. The source projects were not modified.

The live comparison stopped at provider preflight: `bcut key test gemini
--json` returned `not_found`, and a one-sentence candidate smoke run returned
the same error before any LLM request. The cached `bcut key list` still
contained old masked metadata; this exposed a connected-state defect. Product
surfaces now use `bcut key list --verify`, which reconciles the cache against
Keychain/Credential Manager and confirms that no usable secret is available.
No benchmark score is claimed. Local mock-provider tests can verify request
plumbing but are not evidence of translation quality.

The next release gate must provision a real provider secret, run both retained
binaries with identical model/effort settings, and attach the generated
`report.json` (or a link to the retained artifact) before treating the prompt
upgrade as benchmark-accepted.
