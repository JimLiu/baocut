#!/usr/bin/env python3
"""Verify one recorded arm with its corresponding freshly built or archived grader."""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--grader', type=Path, required=True)
p.add_argument('--arm', choices=['latest', 'previous'], default='latest')
a = p.parse_args()
root = Path(__file__).resolve().parent
arm = root / a.arm

def grade(*args):
    return json.loads(subprocess.check_output([str(a.grader.resolve()), *map(str, args)], text=True))

with tempfile.TemporaryDirectory(prefix='lean-carrier-check-') as temp:
    accepted = aligned = 0
    for page in json.loads((arm / 'live-summary.json').read_text()):
        n = page['name']
        src = root / 'pages' / f'{n}.html'
        manifest = root / 'pages' / f'{n}.manifest.json'
        first = grade('grade', src, arm / 'responses' / f'{n}.json', 'lean', manifest)
        assert first == json.loads((arm / 'first-grades' / f'{n}.json').read_text()), f'first changed: {n}'
        rows = {r['id']: r for r in first['rows']}
        fix_answer = arm / 'responses' / f'{n}-fix.json'
        if fix_answer.exists():
            selection = Path(temp) / 'first.json'
            selection.write_text(json.dumps(first, ensure_ascii=False))
            fix = grade('grade-fix', src, selection, fix_answer, manifest)
            rows.update({r['id']: r for r in fix['rows']})
        assert list(rows.values()) == page['rows'], f'merged changed: {n}'
        accepted += len(rows)
        aligned += sum(r['status'] == 'aligned' for r in rows.values())
    assert (accepted, aligned) == (92, 92)
    print(f'ok: {a.arm}: 92 accepted, 92 aligned; meaning is not verified by this check')
