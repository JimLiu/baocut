"""Offline safety and integration tests; never contacts GitHub."""
import copy
import datetime as dt
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cleanup', Path(__file__).with_name('cleanup.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
RealAPI = c.API
T = '2026-10-01T00:00:00Z'
NOW = dt.datetime(2026, 10, 28, tzinfo=c.UTC)


class FakeAPI:
    def __init__(self):
        self.run = dict(id=1, head_sha='a'*40, head_branch='baocut-v3.12.0-build.83',
                        path='.github/workflows/desktop-release.yml', event='push',
                        status='completed', conclusion='success', run_attempt=1, updated_at=T)
        self.artifacts = [dict(id=i+10, name=n, size_in_bytes=100+i, digest='sha256:x',
                              expired=False, updated_at=T, expires_at='2027-01-01T00:00:00Z',
                              workflow_run=dict(id=1, head_sha='a'*40))
                          for i,n in enumerate(sorted(c.NAMES))]
        self.release = dict(id=2, tag_name=self.run['head_branch'], target_commitish='a'*40, draft=False,
                            prerelease=False, updated_at=T, published_at=T)
        self.bodies = {}
        prefix = 'BaoCut-3.12.0-build.83'
        for variant in ['mac', 'cpu', 'cuda', 'vulkan']:
            suffix = '' if variant == 'cpu' else '-'+variant
            if variant == 'mac':
                stem = prefix+'-aarch64-apple-darwin'
                files = [stem+'.dmg', stem+'.zip']
                report = 'app-release.json'
                feed = 'appcast-aarch64-apple-darwin.json'
            else:
                stem = prefix+'-win-x64'+suffix
                files = [stem+'-setup.exe', stem+'.zip']
                report = stem+'-release.json'
                feed = 'appcast-x86_64-pc-windows-msvc'+suffix+'.json'
            facts = []
            for name in files:
                body = ('binary:'+name).encode()
                self.bodies[name] = body
                h = hashlib.sha256(body).hexdigest()
                facts.append(dict(file=name, size=len(body), sha256=h))
                self.bodies[name+'.sha256'] = f'{h}  {name}\n'.encode()
            self.bodies[report] = json.dumps(dict(version='3.12.0', build=83,
                sourceCommit='a'*40, candidateRunId=1, installer=facts[0], portable=facts[1])).encode()
            fact = facts[1] if variant == 'mac' else facts[0]
            self.bodies[feed] = json.dumps(dict(version='3.12.0', build=83,
                app=dict(url=f"https://github.com/{c.REPO}/releases/download/{self.release['tag_name']}/{fact['file']}",
                         sha256=fact['sha256'], size=fact['size']))).encode()
        self.assets = [dict(id=i+100, name=n, size=len(b), state='uploaded', updated_at=T,
                           digest='sha256:'+hashlib.sha256(b).hexdigest())
                       for i,(n,b) in enumerate(self.bodies.items())]
        self.deleted = []
        self.active = []
        self.downloads = []

    def request(self, path, method='GET'):
        if method == 'DELETE':
            self.deleted.append(path)
            self.artifacts = [a for a in self.artifacts if path != f"actions/artifacts/{a['id']}"]
            return True
        if path == 'actions/runs/1':
            return copy.deepcopy(self.run)
        if path.startswith('actions/artifacts/'):
            return next((copy.deepcopy(a) for a in self.artifacts if str(a['id']) == path.split('/')[-1]), None)
        if path.startswith('releases/'):
            return copy.deepcopy(self.release)
        raise AssertionError(path)

    def pages(self, path, key=None):
        if path == 'actions/runs': return copy.deepcopy(self.active)
        if path.endswith('/artifacts'): return copy.deepcopy(self.artifacts)
        if path.endswith('/assets'): return copy.deepcopy(self.assets)
        raise AssertionError(path)

    def asset(self, tag, asset, capture=False):
        # Exercise the real streaming/hash/length checks using local public response bytes.
        self.downloads.append(asset['name'])
        return RealAPI(public_opener=lambda *a, **kw: io.BytesIO(self.bodies[asset['name']])).asset(tag, asset, capture)


class SafetyTests(unittest.TestCase):
    def setUp(self): self.api = FakeAPI()

    def inspect(self, **kwargs):
        with patch('sys.stderr', new=io.StringIO()):
            return c.inspect_run(self.api, 1, kwargs.get('now', NOW), kwargs.get('days', 7),
                                 kwargs.get('protected', set()), kwargs.get('verify', False))

    def assert_kept(self, reason):
        rows = self.inspect()
        self.assertTrue(all(r['action'] == 'KEEP' and reason in r['reason'] for r in rows), rows)
        self.assertEqual(self.api.deleted, [])

    def test_verified_candidate_and_dry_run_has_no_mutation(self):
        rows = self.inspect()
        self.assertEqual({r['action'] for r in rows}, {'DELETE_CANDIDATE'})
        self.assertEqual(len(self.api.downloads), 24)
        self.assertEqual(sum(r['bytes'] for r in rows), 406)
        self.assertEqual(self.api.deleted, [])

    def test_unpublished(self):
        self.api.release = None
        self.assert_kept('unpublished')

    def test_failed_publication_preserves_retry_inputs(self):
        self.api.run['conclusion'] = 'failure'
        self.assert_kept('preserve retry')

    def test_in_progress_pending_waiting_queued(self):
        for status in ['in_progress','pending','waiting','queued','requested']:
            self.api.run['status'] = status
            self.assert_kept('active/waiting')

    def test_manual_producer(self):
        self.api.run['event'] = 'workflow_dispatch'
        self.assert_kept('manual/unknown')

    def test_window_from_last_asset_update(self):
        self.api.assets[0]['updated_at'] = '2026-10-27T00:00:00Z'
        self.assert_kept('rollback window')
        self.assertFalse(self.api.downloads)

    def test_verify_inside_window_keeps(self):
        rows = self.inspect(now=c.timestamp(T)+dt.timedelta(days=1), verify=True)
        self.assertTrue(all(r['action'] == 'KEEP' and 'verified; rollback' in r['reason'] for r in rows))
        self.assertEqual(len(self.api.downloads), 24)

    def test_explicit_pin(self):
        self.assertTrue(all(r['action'] == 'KEEP' for r in self.inspect(protected={1})))

    def test_draft_prerelease(self):
        for field in ['draft','prerelease']:
            self.api.release[field] = True
            self.assert_kept('draft/prerelease')
            self.api.release[field] = False

    def test_missing_checksum(self):
        self.api.assets = [a for a in self.api.assets if not a['name'].endswith('.dmg.sha256')]
        self.assert_kept('incomplete release')

    def test_corrupt_binary(self):
        name = next(n for n in self.api.bodies if n.endswith('.dmg'))
        self.api.bodies[name] = b'x'*len(self.api.bodies[name])
        self.assert_kept('API digest mismatch')

    def test_wrong_sidecar_even_with_valid_api_digest(self):
        a = next(a for a in self.api.assets if a['name'].endswith('.dmg.sha256'))
        body = self.api.bodies[a['name']].replace(b'  BaoCut', b'  NooCut')
        self.api.bodies[a['name']] = body
        a['digest'] = 'sha256:'+hashlib.sha256(body).hexdigest()
        self.assert_kept('sidecar mismatch')

    def test_wrong_provenance(self):
        a = next(a for a in self.api.assets if a['name'] == 'app-release.json')
        self.api.bodies[a['name']] = self.api.bodies[a['name']].replace(b'"candidateRunId": 1', b'"candidateRunId": 2')
        a['digest'] = 'sha256:'+hashlib.sha256(self.api.bodies[a['name']]).hexdigest()
        self.assert_kept('candidate run mismatch')

    def test_repeated_execution_only_artifact_endpoints(self):
        rows = self.inspect()
        with patch.object(c, 'source_guard'), patch('sys.stdout', new=io.StringIO()):
            self.assertEqual(c.execute(self.api, rows, {}, set(), 7), 406)
            self.assertEqual(c.execute(self.api, rows, {}, set(), 7), 0)
        self.assertEqual(len(self.api.deleted), 4)
        self.assertTrue(all(p.startswith('actions/artifacts/') for p in self.api.deleted))

    def test_rerun_before_delete_aborts(self):
        rows = self.inspect()
        self.api.run['run_attempt'] = 2
        with patch.object(c, 'source_guard'), self.assertRaisesRegex(ValueError, 'rerun/changed'):
            c.execute(self.api, rows, {}, set(), 7)
        self.assertEqual(self.api.deleted, [])

    def test_active_unrelated_publisher_aborts(self):
        rows = self.inspect()
        self.api.active = [dict(id=99,status='waiting')]
        with patch.object(c, 'source_guard'), self.assertRaisesRegex(ValueError, 'non-completed'):
            c.execute(self.api, rows, {}, set(), 7)
        self.assertEqual(self.api.deleted, [])

    def test_completed_failed_manual_publisher_blocks_unknown_dependency(self):
        self.api.active = [dict(id=98,status='completed',conclusion='failure',
                               path='.github/workflows/desktop-windows-publish.yml')]
        with self.assertRaisesRegex(ValueError,'unknown candidate_run_id'):
            c.quiet(self.api)

    def test_changed_release_aborts(self):
        rows = self.inspect()
        self.api.assets[0]['id'] += 999
        with patch.object(c, 'source_guard'), self.assertRaisesRegex(ValueError, 'release changed'):
            c.execute(self.api, rows, {}, set(), 7)
        self.assertEqual(self.api.deleted, [])

    def test_api_mutation_allowlist(self):
        for path in ['releases/2','actions/runs/1','actions/runs/1/logs','actions/artifacts/1/zip']:
            with self.assertRaisesRegex(ValueError, 'unsafe endpoint'):
                c.API().request(path, 'DELETE')

    def test_delete_requires_all_explicit_guards(self):
        with patch.dict(c.os.environ, {}, clear=True), self.assertRaisesRegex(ValueError, 'delete requires'):
            c.main(['--run','1','--delete','--report','unused.json'])

    def test_default_main_is_dry_run(self):
        with tempfile.TemporaryDirectory() as tmp, patch('fcntl.flock'), patch.object(c, 'API', return_value=self.api), \
                patch.object(c, 'source_guard'), patch('sys.stdout', new=io.StringIO()):
            out = Path(tmp)/'report.json'
            self.assertEqual(c.main(['--run','1','--report',str(out)]),0)
            report = json.loads(out.read_text())
            self.assertEqual(report['mode'],'dry-run')
            self.assertTrue(all(r['action'] == 'DELETE_CANDIDATE' for r in report['items']))
            self.assertEqual(self.api.deleted, [])

    def test_global_active_run_reports_reason_for_each_artifact(self):
        self.api.active = [dict(id=99,status='queued')]
        with tempfile.TemporaryDirectory() as tmp, patch('fcntl.flock'), patch.object(c, 'API', return_value=self.api), \
                patch.object(c, 'source_guard'), patch('sys.stdout', new=io.StringIO()):
            out = Path(tmp)/'report.json'
            self.assertEqual(c.main(['--run','1','--report',str(out)]),2)
            report = json.loads(out.read_text())
            self.assertEqual(len(report['items']),4)
            self.assertEqual(report['estimated_reclaimable_bytes'],0)
            self.assertTrue(all('99' in r['reason'] for r in report['items']))

    def test_expired_and_unknown_artifact_set(self):
        self.api.artifacts[0]['expired'] = True
        self.assert_kept('expired')
        self.api.artifacts[0]['expired'] = False
        self.api.artifacts[0]['name'] = 'unexpected'
        self.assert_kept('unknown artifact set')

    def test_download_failure_keeps(self):
        with patch.object(self.api, 'asset', side_effect=OSError('network unavailable')):
            self.assert_kept('network unavailable')

    def test_mutation_during_verification_keeps(self):
        original = self.api.asset
        def mutate(*args, **kwargs):
            result = original(*args, **kwargs)
            self.api.release['updated_at'] = '2026-10-02T00:00:00Z'
            return result
        with patch.object(self.api, 'asset', side_effect=mutate):
            self.assert_kept('changed during verification')

    def test_rerun_during_verification_keeps(self):
        original = self.api.asset
        def mutate(*args, **kwargs):
            result = original(*args, **kwargs)
            self.api.run['run_attempt'] = 2
            return result
        with patch.object(self.api, 'asset', side_effect=mutate):
            self.assert_kept('run changed during verification')

    def test_empty_repeated_run_has_zero_candidates(self):
        self.api.artifacts = []
        self.assertEqual(self.inspect(), [])

    def test_partial_deletion_can_resume_after_fresh_full_verification(self):
        self.api.artifacts.pop()
        rows = self.inspect()
        self.assertEqual(len(rows),3)
        self.assertEqual({r['action'] for r in rows},{'DELETE_CANDIDATE'})
        self.assertEqual(len(self.api.downloads),24)

    def test_release_target_commit_changed(self):
        self.api.release['target_commitish'] = 'b'*40
        self.assert_kept('target commit mismatch')

    def test_source_guard_blocks_new_workflow(self):
        a = c.API()
        with patch.object(a,'request',return_value=[dict(type='file',path='.github/workflows/new.yml',sha='x')]):
            with self.assertRaisesRegex(ValueError,'tooling changed'):
                c.source_guard(a,{})


class PaginationTests(unittest.TestCase):
    def test_multiple_pages(self):
        a = c.API()
        pages = [{'total_count':102, 'artifacts':[dict(id=i) for i in range(100)]},
                 {'total_count':102, 'artifacts':[dict(id=100),dict(id=101)]}]
        with patch.object(a, 'request', side_effect=pages) as request:
            self.assertEqual(len(a.pages('actions/artifacts','artifacts')),102)
            self.assertIn('page=2', request.call_args.args[0])

    def test_incomplete_cap_or_permission_failure_aborts(self):
        a = c.API()
        with patch.object(a, 'request', return_value=dict(total_count=1001,workflow_runs=[])):
            with self.assertRaisesRegex(ValueError, 'incomplete pagination'):
                a.pages('actions/runs','workflow_runs')

    def test_duplicate_and_changing_pages_abort(self):
        for total, last, reason in [(101,0,'duplicate'),(102,100,'list changed')]:
            a = c.API()
            pages = [dict(total_count=101, artifacts=[dict(id=i) for i in range(100)]),
                     dict(total_count=total, artifacts=[dict(id=last)])]
            with patch.object(a, 'request', side_effect=pages), self.assertRaisesRegex(ValueError,reason):
                a.pages('actions/artifacts','artifacts')


if __name__ == '__main__': unittest.main()
