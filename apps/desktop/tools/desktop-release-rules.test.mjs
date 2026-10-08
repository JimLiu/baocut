import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseReleaseTag, validateReleaseRef, validateTagVersion } from './desktop-release-rules.mjs';

test('accepts canonical stable desktop release tags and rejects unrelated or malformed tags', () => {
  assert.deepEqual(parseReleaseTag('baocut-v3.0.1-build.61'), { tag: 'baocut-v3.0.1-build.61', version: '3.0.1', build: 61 });
  for (const tag of ['v3.0.1', 'skill-v1.1.4', 'baocut-v03.0.1-build.61', 'baocut-v3.0.1-build.061',
    'baocut-v3.0.1-build.0', 'baocut-v3.0.1-rc.1-build.61', 'baocut-v3.0.1-build.61/other', 'baocut-v3.0.1-build.9007199254740993']) {
    assert.throws(() => parseReleaseTag(tag));
  }
});

test('rejects version mismatches, reused builds on any platform and version regressions', () => {
  const tag = 'baocut-v3.0.1-build.61';
  validateTagVersion(tag, ['3.0.1', '3.0.1'], [{ version: '3.0.0', build: 60 }]);
  assert.throws(() => validateTagVersion(tag, ['3.0.1', '3.0.0'], []), /version differs/);
  assert.throws(() => validateTagVersion(tag, ['3.0.1'], [{ version: '3.0.0', build: 60 }, { version: '3.0.1', build: 61 }]), /build must increase/);
  assert.throws(() => validateTagVersion(tag, ['3.0.1'], [{ version: '3.1.0', build: 60 }]), /go backwards/);
});

test('publication allows main or the exact release tag, never another branch or tag', () => {
  const tag = 'baocut-v3.0.1-build.61';
  validateReleaseRef('refs/heads/main', tag);
  validateReleaseRef(`refs/tags/${tag}`, tag);
  for (const ref of ['refs/heads/feature', 'refs/tags/baocut-v3.0.0-build.60', 'refs/pull/1/merge']) {
    assert.throws(() => validateReleaseRef(ref, tag), /ref differs/);
  }
});

test('tag planning checks actual git ancestry before allowing the signing jobs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'baocut-tag-plan-test-'));
  const source = path.join(root, 'source');
  const origin = path.join(root, 'origin.git');
  mkdirSync(source);
  function git(args, cwd = source) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  const entry = path.resolve('apps/desktop/tools/desktop-release-rules.mjs');
  try {
    git(['init', '--bare', origin], root);
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Release test']);
    git(['config', 'user.email', 'release-test@example.invalid']);
    git(['remote', 'add', 'origin', origin]);
    mkdirSync(path.join(source, 'apps/desktop/releases'), { recursive: true });
    writeFileSync(path.join(source, 'package.json'), JSON.stringify({ version: '3.0.1' }));
    writeFileSync(path.join(source, 'apps/desktop/package.json'), JSON.stringify({ version: '3.0.1' }));
    writeFileSync(path.join(source, 'package-lock.json'), JSON.stringify({ version: '3.0.1', packages: { '': { version: '3.0.1' }, 'apps/desktop': { version: '3.0.1' } } }));
    for (const target of ['aarch64-apple-darwin', 'x86_64-pc-windows-msvc', 'x86_64-pc-windows-msvc-cuda', 'x86_64-pc-windows-msvc-vulkan']) {
      writeFileSync(path.join(source, `apps/desktop/releases/appcast-${target}.json`), JSON.stringify({ version: '3.0.0', build: 60 }));
    }
    git(['add', '.']);
    git(['commit', '-m', 'Release source']);
    git(['push', 'origin', 'main']);
    const tag = 'baocut-v3.0.1-build.61';
    git(['tag', '-a', tag, '-m', 'Release test']);
    const output = path.join(root, 'outputs');
    const env = { ...process.env, GITHUB_REPOSITORY: 'JimLiu/baocut', GITHUB_EVENT_NAME: 'push', GITHUB_REF: `refs/tags/${tag}`,
      GITHUB_SHA: git(['rev-parse', 'HEAD']), GITHUB_OUTPUT: output };
    const accepted = spawnSync(process.execPath, [entry], { cwd: source, env, encoding: 'utf8' });
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(readFileSync(output, 'utf8'), /build=61\n/);
    // A second valid-looking tag on an unmerged branch must never reach signing.
    git(['checkout', '-b', 'unmerged']);
    writeFileSync(path.join(source, 'unmerged.txt'), 'Not part of main');
    git(['add', 'unmerged.txt']);
    git(['commit', '-m', 'Unmerged source']);
    const other = 'baocut-v3.0.1-build.62';
    git(['tag', other]);
    const rejected = spawnSync(process.execPath, [entry], { cwd: source,
      env: { ...env, GITHUB_SHA: git(['rev-parse', 'HEAD']), GITHUB_REF: `refs/tags/${other}` }, encoding: 'utf8' });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /git failed/);
    assert.doesNotMatch(readFileSync(output, 'utf8'), /build=62/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
