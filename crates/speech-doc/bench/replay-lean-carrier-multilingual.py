#!/usr/bin/env python3
"""Replay the checked-in multilingual lines/1 benchmark without model calls."""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from collections import Counter
from pathlib import Path


FIXTURE = Path(__file__).parent / "fixtures" / "lean-carrier-multilingual-2026-09-30"
ROW_FIELDS = ("id", "status", "translation", "issues", "splitSeams", "realTiming")


def grade(binary: Path, *args: Path | str) -> dict:
    completed = subprocess.run(
        [str(binary), *map(str, args)], check=True, capture_output=True, text=True
    )
    return json.loads(completed.stdout)


def slim(rows: list[dict]) -> list[dict]:
    return [{key: row[key] for key in ROW_FIELDS if key in row} for row in rows]


def replay(binary: Path, fixture: Path) -> None:
    baseline = json.loads((fixture / "baseline.json").read_text())
    dataset = json.loads((fixture / "dataset.json").read_text())
    assert baseline["schema"] == "lean-carrier-multilingual-baseline/1"
    assert dataset["schema"] == "lean-carrier-multilingual-dataset/1"
    assert len(dataset["samples"]) == baseline["samples"] == 92
    assert len(baseline["pages"]) == 16

    first_totals: Counter[str] = Counter()
    merged_totals: Counter[str] = Counter()
    sample_keys = {(row["page"], row["id"]) for row in dataset["samples"]}
    assert len(sample_keys) == 92, "dataset has duplicate page/row ids"

    with tempfile.TemporaryDirectory(prefix="lean-carrier-multilingual-") as temp:
        temp_dir = Path(temp)
        for page in baseline["pages"]:
            name = page["name"]
            html = fixture / "pages" / f"{name}.html"
            manifest = fixture / "pages" / f"{name}.manifest.json"
            answer = fixture / "responses" / f"{name}.json"
            source_rows = json.loads(manifest.read_text())["rows"]
            assert len(source_rows) == page["sentences"]
            assert {(name, row["id"]) for row in source_rows} <= sample_keys
            assert json.loads(answer.read_text())["model"] == baseline["model"]

            first = grade(binary, "grade", html, answer, "lean", manifest)
            assert first["totals"] == page["first"], f"first totals changed: {name}"
            assert slim(first["rows"]) == page["firstRows"], f"first rows changed: {name}"
            first_totals.update(first["totals"])
            rows = {row["id"]: row for row in first["rows"]}
            retry_ids = set(first["retryIds"])

            fix_answer = fixture / "responses" / f"{name}-fix.json"
            if fix_answer.exists():
                first_file = temp_dir / f"{name}.first.json"
                first_file.write_text(json.dumps(first, ensure_ascii=False))
                fix = grade(binary, "grade-fix", html, first_file, fix_answer, manifest)
                assert fix["totals"] == page["fixTotals"], f"fix totals changed: {name}"
                for row in fix["rows"]:
                    rows[row["id"]] = row
                    retry_ids.discard(row["id"])
                retry_ids.update(row_id for row_id in fix["retryIds"] if row_id not in rows)

            merged = Counter(row["status"] for row in rows.values())
            merged.update(
                acceptedTranslations=len(rows),
                translationRetries=len(retry_ids),
                expectedSentences=page["sentences"],
            )
            assert dict(merged) == page["merged"], f"merged totals changed: {name}"
            assert sorted(retry_ids) == page["retryIds"], f"retry ids changed: {name}"
            assert slim(list(rows.values())) == page["mergedRows"], f"merged rows changed: {name}"
            merged_totals.update(merged)

    assert first_totals["acceptedTranslations"] == 51
    assert first_totals["aligned"] == 38
    assert merged_totals["acceptedTranslations"] == 87
    assert merged_totals["aligned"] == 74
    print(
        "ok: 92 samples / 16 pages; first 51 accepted, 38 aligned; "
        "with saved repair responses 87 accepted, 74 aligned"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--grader", type=Path, required=True, help="fresh lean_carrier_grade executable")
    parser.add_argument("--fixture", type=Path, default=FIXTURE)
    args = parser.parse_args()
    replay(args.grader.resolve(), args.fixture.resolve())


if __name__ == "__main__":
    main()
