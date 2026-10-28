#!/usr/bin/env python3
"""Conservative, opt-in cleanup of BaoCut automatic release artifacts (stdlib only)."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

REPO = 'JimLiu/baocut'
NAMES = {'baocut-desktop-macos-arm64', *(
    f'baocut-desktop-windows-x64-{v}' for v in ('cpu', 'cuda', 'vulkan'))}
UTC = dt.timezone.utc


def timestamp(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


class API:
    def __init__(self, token=None, public_opener=None):
        self.token = token
        self.public_opener = public_opener or urllib.request.urlopen

    def request(self, path, method='GET'):
        # Only this method can mutate, and only the artifact endpoint is allowed.
        require(method == 'GET' or (method == 'DELETE' and
                re.fullmatch(r'actions/artifacts/[0-9]+', path)), 'unsafe endpoint')
        headers = {'Accept': 'application/vnd.github+json',
                   'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'baocut-artifact-cleanup'}
        if self.token:
            headers['Authorization'] = 'Bearer ' + self.token
        req = urllib.request.Request(f'https://api.github.com/repos/{REPO}/{path}',
                                     headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                return json.load(response) if method == 'GET' else True
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            raise RuntimeError(f'API {method} {path}: HTTP {error.code}') from None

    def pages(self, path, key=None):
        result, page = [], 1
        expected = None
        while True:
            sep = '&' if '?' in path else '?'
            data = self.request(f'{path}{sep}per_page=100&page={page}')
            require(data is not None, 'pagination endpoint missing')
            batch = data[key] if key else data
            if key and 'total_count' in data:
                require(expected in (None, data['total_count']), 'list changed during pagination')
                expected = data['total_count']
            result.extend(batch)
            if len(batch) < 100:
                break
            page += 1
            require(page <= 10000, 'pagination limit reached')
        require(len({x['id'] for x in result}) == len(result), 'duplicate IDs during pagination')
        require(expected is None or len(result) == expected, 'incomplete pagination (including search cap)')
        return result

    def asset(self, tag, asset, capture=False):
        # Public read-back without credentials; never forward an API token to redirects.
        name = asset['name']
        require('/' not in name and '\\' not in name and name not in ('.', '..'), 'unsafe asset name')
        url = (f'https://github.com/{REPO}/releases/download/' +
               urllib.parse.quote(tag, safe='') + '/' + urllib.parse.quote(name, safe=''))
        h, size, chunks = hashlib.sha256(), 0, []
        with self.public_opener(url, timeout=60) as response:
            while block := response.read(1024 * 1024):
                h.update(block)
                size += len(block)
                require(size <= asset['size'], 'asset larger than metadata')
                if capture:
                    require(size <= 2 * 1024 * 1024, 'metadata file too large')
                    chunks.append(block)
        require(size == asset['size'] and size > 0, f'asset size mismatch: {name}')
        digest = h.hexdigest()
        require(asset.get('digest') == 'sha256:' + digest, f'API digest mismatch/missing: {name}')
        return digest, b''.join(chunks)


def run_fingerprint(run):
    return {k: run.get(k) for k in ('id', 'head_sha', 'head_branch', 'status', 'conclusion',
                                   'run_attempt', 'updated_at', 'path', 'event')}


def release_fingerprint(release, assets):
    return {'release': {k: release.get(k) for k in
            ('id', 'tag_name', 'target_commitish', 'draft', 'prerelease', 'updated_at', 'published_at')},
            'assets': sorted(({k: a.get(k) for k in
                ('id', 'name', 'size', 'digest', 'state', 'updated_at')} for a in assets),
                key=lambda a: a['id'])}


def artifact_fingerprint(a):
    return {k: a.get(k) for k in ('id', 'name', 'size_in_bytes', 'digest', 'expired',
                                 'updated_at', 'workflow_run')}


def verify_release(api, run, release, assets):
    """Read every public asset, hash binaries and check all eight sidecars + provenance."""
    match = re.fullmatch(r'baocut-v(\d+\.\d+\.\d+)-build\.([1-9]\d*)', run['head_branch'])
    require(match, 'unrecognized release tag')
    version, build = match[1], int(match[2])
    prefix = f'BaoCut-{version}-build.{build}'
    binaries = [f'{prefix}-aarch64-apple-darwin.{ext}' for ext in ('dmg', 'zip')]
    reports = ['app-release.json']
    feeds = ['appcast-aarch64-apple-darwin.json']
    report_files = {'app-release.json': tuple(binaries)}
    feed_files = {feeds[0]: binaries[1]}
    for variant in ('cpu', 'cuda', 'vulkan'):
        suffix = '' if variant == 'cpu' else '-' + variant
        stem = f'{prefix}-win-x64{suffix}'
        binaries += [stem + '-setup.exe', stem + '.zip']
        reports.append(stem + '-release.json')
        feeds.append(f'appcast-x86_64-pc-windows-msvc{suffix}.json')
        report_files[reports[-1]] = (stem + '-setup.exe', stem + '.zip')
        feed_files[feeds[-1]] = stem + '-setup.exe'
    required = set(binaries + reports + feeds + [n + '.sha256' for n in binaries])
    by_name = {a['name']: a for a in assets}
    require(len(by_name) == len(assets), 'duplicate release names')
    require(required <= by_name.keys(), 'incomplete release files/checksums/feeds')
    hashes, content = {}, {}
    def download(name):
        a = by_name[name]
        require(a['state'] == 'uploaded', 'asset still uploading')
        print(f"VERIFY {release['tag_name']}/{name} ({a['size']} bytes)", file=sys.stderr, flush=True)
        digest, body = api.asset(release['tag_name'], a, capture=name not in binaries)
        return name, digest, body
    with ThreadPoolExecutor(max_workers=4) as pool:
        for name, digest, body in pool.map(download, sorted(required)):
            hashes[name] = digest
            if name not in binaries:
                content[name] = body.decode('utf-8-sig')
    for name in binaries:
        require(content[name + '.sha256'].strip() == f'{hashes[name]}  {name}',
                f'checksum sidecar mismatch: {name}')
    for name in reports:
        report = json.loads(content[name])
        require(report['version'] == version and report['build'] == build and
                report['sourceCommit'] == run['head_sha'], 'release provenance mismatch')
        require(report.get('candidateRunId') == run['id'], 'candidate run mismatch')
        for kind, expected_file in zip(('installer', 'portable'), report_files[name]):
            facts = report[kind]
            require(facts['file'] == expected_file and hashes[facts['file']] == facts['sha256'] and
                    by_name[facts['file']]['size'] == facts['size'], 'report binary mismatch')
    for name in feeds:
        feed = json.loads(content[name])
        app = feed['app']
        file = urllib.parse.unquote(urllib.parse.urlparse(app['url']).path.rsplit('/', 1)[-1])
        expected_url = f"https://github.com/{REPO}/releases/download/{release['tag_name']}/{file}"
        require(app['url'].lower() == expected_url.lower() and file == feed_files[name] and
                feed['version'] == version and feed['build'] == build and
                app['sha256'] == hashes[file] and app['size'] == by_name[file]['size'],
                'update feed mismatch')
    return {'binary_count': len(binaries), 'verified_assets': len(required),
            'hashes': hashes, 'association': 'automatic tag run + sourceCommit + Windows candidateRunId'}


def quiet(api):
    # No status filter: enumerate ALL runs so waiting/requested/pending are also protected.
    runs = api.pages('actions/runs', 'workflow_runs')
    active = [r['id'] for r in runs if r['status'] != 'completed']
    require(not active, f'non-completed repository runs may consume artifacts: {active}')
    unresolved = [r['id'] for r in runs if
                  r.get('path') == '.github/workflows/desktop-windows-publish.yml' and
                  r.get('conclusion') != 'success']
    require(not unresolved,
            f'failed manual publishers have unknown candidate_run_id; resolve retries first: {unresolved}')


def source_guard(api, guard):
    files = api.request('contents/.github/workflows?ref=main')
    require(files is not None, 'workflow inventory unavailable')
    actual = {f['path']: f['sha'] for f in files if f['type'] == 'file'}
    for path in guard:
        if not path.startswith('.github/workflows/'):
            f = api.request('contents/' + path + '?ref=main')
            require(f is not None, 'publication tooling unavailable')
            actual[path] = f['sha']
    require(actual.keys() == guard.keys() and all(actual[k] in guard[k] for k in actual),
            'workflow/publication tooling changed; audit dependencies and refresh guard')


def inspect_run(api, run_id, now, days, protected, verify=False):
    run = api.request(f'actions/runs/{run_id}')
    require(run is not None, 'run missing or inaccessible')
    artifacts = api.pages(f'actions/runs/{run_id}/artifacts', 'artifacts')
    rows = [dict(id=a['id'], name=a['name'], bytes=a['size_in_bytes'], run_id=run_id,
                 action='KEEP', reason='not evaluated', artifact=artifact_fingerprint(a)) for a in artifacts]
    try:
        require(run_id not in protected, 'explicitly protected run')
        require(run['status'] == 'completed', 'run still active/waiting')
        require(run['conclusion'] == 'success', 'failed/cancelled publication; preserve retry inputs')
        require(run['path'] == '.github/workflows/desktop-release.yml' and run['event'] == 'push',
                'manual/unknown producer; dependency cannot be proven')
        names = {a['name'] for a in artifacts}
        require(names <= NAMES and len(names) == len(artifacts), 'unknown artifact set or duplicate names')
        for a in artifacts:
            require(a['workflow_run']['id'] == run_id and
                    a['workflow_run']['head_sha'] == run['head_sha'], 'artifact source mismatch')
            require(not a['expired'] and timestamp(a['expires_at']) > now, 'expired artifact set')
        tag = run['head_branch']
        release = api.request('releases/tags/' + urllib.parse.quote(tag, safe=''))
        require(release is not None, 'unpublished or inaccessible release')
        require(not release['draft'] and not release['prerelease'], 'draft/prerelease protected')
        require(release.get('target_commitish') == run['head_sha'], 'release target commit mismatch')
        assets = api.pages(f"releases/{release['id']}/assets")
        newest = max(timestamp(t) for t in [run['updated_at'], release['published_at'],
                     release['updated_at']] + [a['updated_at'] for a in artifacts + assets])
        eligible_at = newest + dt.timedelta(days=days)
        in_window = now < eligible_at
        if in_window and not verify:
            raise ValueError('rollback window until ' + eligible_at.isoformat())
        evidence = verify_release(api, run, release, assets)
        # Detect release mutation during large downloads before accepting evidence.
        after = api.request(f"releases/{release['id']}")
        require(after is not None and release_fingerprint(after, api.pages(f"releases/{release['id']}/assets"))
                == release_fingerprint(release, assets), 'release changed during verification')
        current_run = api.request(f'actions/runs/{run_id}')
        require(current_run is not None and run_fingerprint(current_run) == run_fingerprint(run),
                'run changed during verification')
        current_artifacts = api.pages(f'actions/runs/{run_id}/artifacts', 'artifacts')
        require(sorted((artifact_fingerprint(a) for a in current_artifacts), key=lambda a: a['id']) ==
                sorted((artifact_fingerprint(a) for a in artifacts), key=lambda a: a['id']),
                'artifacts changed during verification')
        for row in rows:
            row.update(action='KEEP' if in_window else 'DELETE_CANDIDATE',
                       reason=('verified; rollback window until ' + eligible_at.isoformat()) if in_window else
                       'successful automatic publication; public binaries/checksums/provenance verified; rollback window elapsed',
                       run=run_fingerprint(run), release=release_fingerprint(release, assets), evidence=evidence)
    except (ValueError, KeyError, RuntimeError, OSError) as error:
        for row in rows:
            row.update(action='KEEP', reason=str(error))
    return rows


def execute(api, rows, guard, protected, days):
    deleted = 0
    for row in rows:
        if row['action'] != 'DELETE_CANDIDATE':
            continue
        source_guard(api, guard)
        quiet(api)
        current = api.request(f"actions/artifacts/{row['id']}")
        if current is None:
            print(json.dumps({'id': row['id'], 'action': 'SKIP_ABSENT_OR_INACCESSIBLE'}), flush=True)
            continue
        require(artifact_fingerprint(current) == row['artifact'], 'artifact changed; abort')
        run = api.request(f"actions/runs/{row['run_id']}")
        require(run is not None and run_fingerprint(run) == row['run'], 'run rerun/changed; abort')
        require(row['run_id'] not in protected, 'run protected')
        release_id = row['release']['release']['id']
        release = api.request(f'releases/{release_id}')
        assets = api.pages(f'releases/{release_id}/assets')
        require(release is not None and release_fingerprint(release, assets) == row['release'],
                'release changed; abort')
        # No retry of DELETE on ambiguous failures. Next invocation reads server state again.
        accepted = api.request(f"actions/artifacts/{row['id']}", 'DELETE')
        if accepted:
            deleted += row['bytes']
        print(json.dumps({'id': row['id'], 'action': 'DELETED' if accepted else 'SKIP_ABSENT_OR_INACCESSIBLE',
                          'estimated_bytes': row['bytes'] if accepted else 0}), flush=True)
    return deleted


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run', type=int, action='append', required=True)
    p.add_argument('--rollback-days', type=int, default=7)
    p.add_argument('--protect-run', type=int, action='append', default=[])
    p.add_argument('--verify-within-window', action='store_true')
    p.add_argument('--delete', action='store_true')
    p.add_argument('--confirm-repo')
    p.add_argument('--maintenance-window', action='store_true',
                   help='Assert new dispatches/reruns/publishers are frozen for this invocation')
    p.add_argument('--report', type=Path, required=True)
    args = p.parse_args(argv)
    require(args.rollback_days >= 1, 'rollback-days must be >= 1')
    require(all(n > 0 for n in args.run + args.protect_run), 'run IDs must be positive')
    token = os.getenv('GH_TOKEN') or os.getenv('GITHUB_TOKEN')
    if args.delete:
        require(token and args.confirm_repo == REPO and args.maintenance_window,
                'delete requires token, --confirm-repo JimLiu/baocut and --maintenance-window')
    # Advisory local lock; remote writers must be frozen by the operator for deletion.
    import fcntl
    with open(Path(__file__).with_name('.cleanup.lock'), 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        api = API(token)
        guard = json.loads(Path(__file__).with_name('source-guard.json').read_text())
        rows, blocked = [], None
        try:
            source_guard(api, guard)
            quiet(api)
        except Exception as error:
            blocked = 'global preflight failed; no deletion: ' + str(error)
        for run_id in sorted(set(args.run)):
            if blocked:
                artifacts = api.pages(f'actions/runs/{run_id}/artifacts', 'artifacts')
                rows += [dict(id=a['id'], name=a['name'], bytes=a['size_in_bytes'],
                              run_id=run_id, action='KEEP', reason=blocked) for a in artifacts]
            else:
                rows += inspect_run(api, run_id, dt.datetime.now(UTC), args.rollback_days,
                                    set(args.protect_run), args.verify_within_window)
        if blocked is None:
            try:
                source_guard(api, guard)
                quiet(api)
            except Exception as error:
                blocked = 'global postflight failed; no deletion: ' + str(error)
                for row in rows:
                    row.update(action='KEEP', reason=blocked)
        report = {'repository': REPO, 'mode': 'delete' if args.delete else 'dry-run',
                  'checked_at': dt.datetime.now(UTC).isoformat(), 'rollback_days': args.rollback_days,
                  'items': rows, 'estimated_reclaimable_bytes': sum(
                      r['bytes'] for r in rows if r['action'] == 'DELETE_CANDIDATE')}
        args.report.write_text(json.dumps(report, indent=2) + '\n')
        for row in rows:
            print(f"{row['action']} {row['id']} {row['name']} {row['bytes']} bytes: {row['reason']}", flush=True)
        print(f"Estimated reclaimable: {report['estimated_reclaimable_bytes']} bytes", flush=True)
        if args.delete:
            require(blocked is None, blocked)
            print(f"Estimated deleted: {execute(api, rows, guard, set(args.protect_run), args.rollback_days)} bytes")
    return 2 if blocked else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'ABORT: {type(error).__name__}: {error}', file=sys.stderr)
        sys.exit(2)
