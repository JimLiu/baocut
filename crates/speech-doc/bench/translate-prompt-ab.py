#!/usr/bin/env python3
"""Prepare and grade a BaoCut translation-prompt A/B run.

The runner deliberately does not invoke an LLM. It creates isolated project
copies, then grades artifacts produced by either provider or agent workers.
This keeps credentials and worker orchestration outside the benchmark parser
while making the acceptance gate deterministic and reviewable.
"""

from __future__ import annotations

import argparse
import json
import shutil
import statistics
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


@dataclass
class RunMetrics:
    rt_required: int = 0
    rt_satisfied: int = 0
    glossary_supplied: bool = False
    glossary_required: int = 0
    glossary_satisfied: int = 0
    translate_calls: int = 0
    translate_malformed: int = 0
    translate_prompt_chars_mean: float | None = None
    translate_response_ms_mean: float | None = None
    translate_worker_ms_mean: float | None = None
    align_calls: int | None = None
    align_worker_ms: int | None = None
    align_total_ms: int | None = None
    aligned_sentences: int | None = None
    prealigned_sentences: int | None = None
    check_advisories: int | None = None
    check_blockers: int | None = None

    @property
    def rt_coverage(self) -> float | None:
        if self.rt_required == 0:
            return None
        return self.rt_satisfied / self.rt_required

    @property
    def terminology_coverage(self) -> float | None:
        if self.glossary_supplied:
            if self.glossary_required == 0:
                return None
            return self.glossary_satisfied / self.glossary_required
        return self.rt_coverage

    @property
    def draft_reject_rate(self) -> float | None:
        if self.aligned_sentences is None or self.prealigned_sentences is None:
            return None
        total = self.aligned_sentences + self.prealigned_sentences
        return self.aligned_sentences / total if total else 0.0

    @property
    def translate_page_ms(self) -> float | None:
        """Official agent timing, with provider logs as a direct-run fallback."""
        return (
            self.translate_worker_ms_mean
            if self.translate_worker_ms_mean is not None
            else self.translate_response_ms_mean
        )

    def to_json(self) -> dict[str, Any]:
        value = asdict(self)
        value["rtCoverage"] = self.rt_coverage
        value["terminologyCoverage"] = self.terminology_coverage
        value["draftRejectRate"] = self.draft_reject_rate
        value["translatePageMs"] = self.translate_page_ms
        return value


def json_lines(path: Path | None) -> Iterable[dict[str, Any]]:
    if path is None or not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        value = json.loads(line)
        if isinstance(value, dict):
            rows.append(value)
    return rows


def load_json(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.exists():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    return value if isinstance(value, dict) else None


def strip_fence(raw: str) -> str:
    value = raw.strip()
    if not value.startswith("```"):
        return value
    lines = value.splitlines()
    if lines:
        lines.pop(0)
    if lines and lines[-1].strip() == "```":
        lines.pop()
    return "\n".join(lines).strip()


def parse_object(raw: Any) -> dict[str, Any] | None:
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str):
        return None
    try:
        value = json.loads(strip_fence(raw))
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def nested_numbers(value: Any, key: str) -> list[int]:
    found: list[int] = []
    if isinstance(value, dict):
        for name, child in value.items():
            if name == key and isinstance(child, (int, float)):
                found.append(int(child))
            else:
                found.extend(nested_numbers(child, key))
    elif isinstance(value, list):
        for child in value:
            found.extend(nested_numbers(child, key))
    return found


def count_check_items(value: dict[str, Any] | None, key: str) -> int | None:
    if value is None:
        return None
    arrays: list[int] = []

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            for name, child in node.items():
                if name == key and isinstance(child, list):
                    arrays.append(len(child))
                else:
                    visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)

    visit(value)
    return sum(arrays)


def glossary_pairs(path: Path | None) -> list[tuple[str, str]]:
    value = load_json(path)
    if value is None:
        return []
    entries = value.get("glossary", value.get("terms", []))
    if not isinstance(entries, list):
        return []
    pairs: list[tuple[str, str]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        source = entry.get("source")
        target = entry.get("target")
        if isinstance(source, str) and source and isinstance(target, str) and target:
            pairs.append((source, target))
    return pairs


def collect_metrics(
    project: Path,
    *,
    status_path: Path | None,
    events_path: Path | None,
    check_path: Path | None,
    glossary_path: Path | None = None,
) -> RunMetrics:
    metrics = RunMetrics()
    terms = glossary_pairs(glossary_path)
    metrics.glossary_supplied = glossary_path is not None
    prompt_chars: list[int] = []
    response_ms: list[float] = []
    provider_align_ms: list[int] = []
    final_lines: dict[str, tuple[str, str, list[str]]] = {}
    log_root = project / "logs" / "llm"
    for path in sorted(log_root.glob("*.jsonl")) if log_root.is_dir() else []:
        for record in json_lines(path):
            kind = record.get("kind")
            if kind == "align" and isinstance(record.get("durMs"), (int, float)):
                provider_align_ms.append(int(record["durMs"]))
            if kind != "translate":
                continue
            metrics.translate_calls += 1
            system = record.get("system", "")
            user = record.get("user", "")
            prompt_chars.append(len(str(system)) + len(str(user)))
            if isinstance(record.get("durMs"), (int, float)):
                response_ms.append(float(record["durMs"]))
            request = parse_object(user)
            response = parse_object(record.get("response"))
            if request is None or response is None:
                metrics.translate_malformed += 1
                continue
            translations = response.get("translations")
            if not isinstance(translations, dict):
                metrics.translate_malformed += 1
                continue
            for line in request.get("lines", []):
                if not isinstance(line, dict):
                    continue
                required = line.get("rt", [])
                if not isinstance(required, list):
                    required = []
                line_id = line.get("id")
                target = translations.get(line_id)
                if isinstance(line_id, str) and isinstance(target, str):
                    final_lines[line_id] = (
                        str(line.get("source", "")),
                        target,
                        [term for term in required if isinstance(term, str) and term],
                    )
    for source, target, required in final_lines.values():
        for term in required:
            metrics.rt_required += 1
            metrics.rt_satisfied += int(term in target)
        for term_source, term_target in terms:
            if term_source in source:
                metrics.glossary_required += 1
                metrics.glossary_satisfied += int(term_target in target)
    if prompt_chars:
        metrics.translate_prompt_chars_mean = statistics.fmean(prompt_chars)
    if response_ms:
        metrics.translate_response_ms_mean = statistics.fmean(response_ms)

    status = load_json(status_path)
    used_agent_timings = False
    if status is not None:
        payload = status.get("data", status)
        calls = payload.get("completedCalls", []) if isinstance(payload, dict) else []
        if isinstance(calls, list) and calls:
            used_agent_timings = True
            metrics.align_calls = 0
            translate_worker: list[int] = []
            align_worker: list[int] = []
            align_total: list[int] = []
            for call in calls:
                if not isinstance(call, dict):
                    continue
                kind = call.get("kind")
                if kind == "translate" and isinstance(call.get("workerMs"), (int, float)):
                    translate_worker.append(int(call["workerMs"]))
                if kind == "align":
                    assert metrics.align_calls is not None
                    metrics.align_calls += 1
                    if isinstance(call.get("workerMs"), (int, float)):
                        align_worker.append(int(call["workerMs"]))
                    if isinstance(call.get("totalMs"), (int, float)):
                        align_total.append(int(call["totalMs"]))
            if translate_worker:
                metrics.translate_worker_ms_mean = statistics.fmean(translate_worker)
            if align_worker:
                metrics.align_worker_ms = sum(align_worker)
            if align_total:
                metrics.align_total_ms = sum(align_total)
    if not used_agent_timings and (metrics.translate_calls > 0 or provider_align_ms):
        # Provider-direct runs do not create Agent task records. Their LLM log
        # duration is the only authoritative per-call timing source.
        metrics.align_calls = len(provider_align_ms)
        metrics.align_worker_ms = sum(provider_align_ms)
        metrics.align_total_ms = sum(provider_align_ms)

    events = list(json_lines(events_path))
    aligned = [number for row in events for number in nested_numbers(row, "alignedSentences")]
    prealigned = [number for row in events for number in nested_numbers(row, "prealignedSentences")]
    if aligned:
        metrics.aligned_sentences = sum(aligned)
    if prealigned:
        metrics.prealigned_sentences = sum(prealigned)

    check = load_json(check_path)
    metrics.check_advisories = count_check_items(check, "advisories")
    blocker_counts = [
        count_check_items(check, "errors"),
        count_check_items(check, "blockers"),
        count_check_items(check, "violations"),
    ]
    if any(value is not None for value in blocker_counts):
        metrics.check_blockers = sum(value or 0 for value in blocker_counts)
    return metrics


def ratio_gate(
    name: str,
    baseline: float | int | None,
    candidate: float | int | None,
    limit: float,
) -> dict[str, Any]:
    if baseline is None or candidate is None:
        return {"name": name, "status": "incomplete", "baseline": baseline, "candidate": candidate}
    threshold = float(baseline) * limit
    return {
        "name": name,
        "status": "pass" if float(candidate) <= threshold else "fail",
        "baseline": baseline,
        "candidate": candidate,
        "threshold": threshold,
    }


def grade(baseline: RunMetrics, candidate: RunMetrics) -> dict[str, Any]:
    gates: list[dict[str, Any]] = []
    if baseline.terminology_coverage is None or candidate.terminology_coverage is None:
        gates.append({
            "name": "glossary consistency",
            "status": "incomplete",
            "baseline": baseline.terminology_coverage,
            "candidate": candidate.terminology_coverage,
        })
    else:
        gates.append({
            "name": "glossary consistency",
            "status": "pass" if candidate.terminology_coverage >= baseline.terminology_coverage else "fail",
            "baseline": baseline.terminology_coverage,
            "candidate": candidate.terminology_coverage,
            "threshold": baseline.terminology_coverage,
        })
    gates.extend([
        ratio_gate("draft rejection rate", baseline.draft_reject_rate, candidate.draft_reject_rate, 1.0),
        ratio_gate("align call count", baseline.align_calls, candidate.align_calls, 1.10),
        ratio_gate("align worker time", baseline.align_worker_ms, candidate.align_worker_ms, 1.10),
        ratio_gate("align total time", baseline.align_total_ms, candidate.align_total_ms, 1.10),
        ratio_gate("translate page response time", baseline.translate_page_ms,
                   candidate.translate_page_ms, 1.15),
        ratio_gate("check advisories", baseline.check_advisories, candidate.check_advisories, 1.0),
        ratio_gate("check blockers", baseline.check_blockers, candidate.check_blockers, 1.0),
    ])
    statuses = {gate["status"] for gate in gates}
    overall = "fail" if "fail" in statuses else ("incomplete" if "incomplete" in statuses else "pass")
    return {"overall": overall, "gates": gates}


def prepare(args: argparse.Namespace) -> int:
    source = args.project.resolve()
    if not source.is_dir() or not (source / "transcript.json").is_file():
        raise SystemExit(
            f"project must be an existing BaoCut directory containing transcript.json: {source}"
        )
    if not args.language or any(separator in args.language for separator in ("/", "\\")):
        raise SystemExit("language must be a non-empty language id without path separators")
    output = args.output.resolve()
    if output == source or source in output.parents:
        raise SystemExit("benchmark output must be outside the source project")
    output.mkdir(parents=True, exist_ok=True)
    copies: dict[str, str] = {}
    for label in ("baseline", "candidate"):
        target = output / f"{label}.bcut"
        if target.exists():
            raise SystemExit(f"refusing to overwrite benchmark copy: {target}")
        shutil.copytree(source, target)
        for reset in (target / "tasks", target / "logs" / "llm"):
            shutil.rmtree(reset, ignore_errors=True)
            reset.mkdir(parents=True)
        (target / "ai" / f"brief-{args.language}.json").unlink(missing_ok=True)
        copies[label] = str(target)
    manifest = {
        "schema": "baocut-translate-prompt-ab/1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": str(source),
        "language": args.language,
        "baselineRef": args.baseline_ref,
        "candidateRef": args.candidate_ref,
        "copies": copies,
        "reset": ["tasks", "logs/llm", f"ai/brief-{args.language}.json"],
        "status": "prepared",
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


def report(args: argparse.Namespace) -> int:
    baseline = collect_metrics(
        args.baseline_project,
        status_path=args.baseline_status,
        events_path=args.baseline_events,
        check_path=args.baseline_check,
        glossary_path=args.glossary,
    )
    candidate = collect_metrics(
        args.candidate_project,
        status_path=args.candidate_status,
        events_path=args.candidate_events,
        check_path=args.candidate_check,
        glossary_path=args.glossary,
    )
    result = {
        "schema": "baocut-translate-prompt-ab-report/1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "baseline": baseline.to_json(),
        "candidate": candidate.to_json(),
        "grade": grade(baseline, candidate),
    }
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return {"pass": 0, "fail": 1, "incomplete": 2}[result["grade"]["overall"]]


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    prep = commands.add_parser("prepare", help="create isolated baseline/candidate project copies")
    prep.add_argument("--project", type=Path, required=True)
    prep.add_argument("--output", type=Path, required=True)
    prep.add_argument("--language", required=True)
    prep.add_argument("--baseline-ref", required=True)
    prep.add_argument("--candidate-ref", required=True)
    prep.set_defaults(run=prepare)

    rep = commands.add_parser("report", help="grade completed A/B artifacts")
    for label in ("baseline", "candidate"):
        rep.add_argument(f"--{label}-project", type=Path, required=True)
        rep.add_argument(f"--{label}-status", type=Path)
        rep.add_argument(f"--{label}-events", type=Path)
        rep.add_argument(f"--{label}-check", type=Path)
    rep.add_argument("--output", type=Path)
    rep.add_argument("--glossary", type=Path,
                     help="shared reviewed DocumentBrief/terms JSON for terminology scoring")
    rep.set_defaults(run=report)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())
