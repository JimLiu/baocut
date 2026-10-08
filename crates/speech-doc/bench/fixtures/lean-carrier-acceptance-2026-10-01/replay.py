#!/usr/bin/env python3
"""Replay this acceptance snapshot; no model calls or project writes."""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--grader', type=Path, required=True)
a = p.parse_args()
root = Path(__file__).resolve().parent

def grade(*args):
    return json.loads(subprocess.check_output([str(a.grader.resolve()), *map(str, args)], text=True))

with tempfile.TemporaryDirectory(prefix='lean-acceptance-') as temp:
    accepted = aligned = 0
    for expected in json.loads((root / 'live-summary.json').read_text()):
        name = expected['name']
        source = root / 'pages' / f'{name}.html'
        manifest = root / 'pages' / f'{name}.manifest.json'
        first = grade('grade', source, root / 'responses' / f'{name}.json', 'lean', manifest)
        assert first == json.loads((root / 'first-grades' / f'{name}.json').read_text()), f'first changed: {name}'
        rows = {row['id']: row for row in first['rows']}
        answer = root / 'responses' / f'{name}-fix.json'
        if answer.exists():
            selection = Path(temp) / 'first.json'
            selection.write_text(json.dumps(first, ensure_ascii=False))
            fix = grade('grade-fix', source, selection, answer, manifest)
            rows.update({row['id']: row for row in fix['rows']})
        assert list(rows.values()) == expected['rows'], f'merged changed: {name}'
        accepted += len(rows)
        aligned += sum(row['status'] == 'aligned' for row in rows.values())
    assert (accepted, aligned) == (92, 82)
    print('ok: 92 samples; 92 accepted, 82 aligned after one saved repair')
