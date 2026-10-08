#!/usr/bin/env python3
"""Export model-facing cases and a separate, unscored review sheet; no API calls."""
import argparse
import csv
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True, help='New output directory outside the repository')
    args = parser.parse_args()
    dataset = json.loads(Path(__file__).with_name('cases.json').read_text())
    assert dataset['schema'] == 'subtitle-multilingual-cases/1'
    cases = dataset['cases']
    assert len({c['id'] for c in cases}) == len(cases)
    tasks = []
    review = []
    for case in cases:
        for stage in ('polish', 'translation'):
            spec = case[stage]
            task_id = f"{case['id']}-{stage}"
            target = case['sourceLang'] if stage == 'polish' else case['targetLang']
            source = spec['input'] if stage == 'polish' else case['source']
            tasks.append({'id': task_id, 'stage': stage, 'sourceLang': case['sourceLang'],
                          'targetLang': target, 'system': spec['instruction'] + ' Return only the resulting text.',
                          'user': f"Source language: {case['sourceLang']}\nTarget language: {target}\nText:\n{source}"})
            review.append([task_id, source, spec['reference'],
                           '; '.join(case['translation']['requiredFacts']),
                           spec.get('counterexample', ''), '', '', ''])
    # Refuse accidental replacement of earlier model collection/evaluation output.
    args.out.mkdir(parents=True, exist_ok=False)
    (args.out / 'tasks.jsonl').write_text(''.join(json.dumps(t, ensure_ascii=False) + '\n' for t in tasks))
    with (args.out / 'review.csv').open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        writer.writerow(['id', 'source', 'reference', 'required_facts', 'counterexample',
                         'actual_response', 'semantic_verdict', 'notes'])
        writer.writerows(review)
    print(f"ok: {len(cases)} scenarios, {len(tasks)} tasks, {len({c['sourceLang'] for c in cases})} source languages")


if __name__ == '__main__':
    main()
