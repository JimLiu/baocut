import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileHash, packageArchives, validateCandidate, validatePackage } from './windows-release.mjs';

const source = 'a'.repeat(40);
const mac = { version: '3.0.0', build: 60, sourceCommit: source };
const run = { status: 'completed', workflow_id: 7, event: 'workflow_dispatch', head_sha: source, head_repository: { full_name: 'JimLiu/baocut' } };

test('requires native validation for every selected variant and the frozen Mac source', () => {
  const jobs = [{ name: 'Package Windows x64 (cpu)', conclusion: 'success' }, { name: 'Package Windows x64 (cuda)', conclusion: 'failure' }];
  validateCandidate(run, jobs, mac, ['cpu'], 7, 'JimLiu/baocut');
  validateCandidate({ ...run, status: 'in_progress' }, jobs, mac, ['cpu'], 7, 'JimLiu/baocut');
  assert.throws(() => validateCandidate({ ...run, status: 'queued' }, jobs, mac, ['cpu'], 7, 'JimLiu/baocut'), /not started/);
  assert.throws(() => validateCandidate(run, jobs, mac, ['cpu', 'cuda'], 7, 'JimLiu/baocut'), /Native validation/);
  assert.throws(() => validateCandidate({ ...run, event: 'pull_request' }, jobs, mac, ['cpu'], 7, 'JimLiu/baocut'), /workflow/);
});

test('accepts the tag orchestrator only with the exact tag, source and successful reusable Windows jobs', () => {
  const policy = { manual: 7, automatic: 8 };
  const automatic = { ...run, workflow_id: 8, event: 'push', head_branch: 'baocut-v3.0.0-build.60' };
  const jobs = ['cpu', 'cuda', 'vulkan'].map((variant) => ({ name: `windows / Package Windows x64 (${variant})`, conclusion: 'success' }));
  validateCandidate(automatic, jobs, mac, ['cpu', 'cuda', 'vulkan'], policy, 'JimLiu/baocut');
  assert.throws(() => validateCandidate({ ...automatic, head_branch: 'baocut-v3.0.0-build.61' }, jobs, mac, ['cpu'], policy, 'JimLiu/baocut'), /tag or source differs/);
  assert.throws(() => validateCandidate({ ...automatic, head_sha: 'b'.repeat(40) }, jobs, mac, ['cpu'], policy, 'JimLiu/baocut'), /tag or source differs/);
  assert.throws(() => validateCandidate({ ...automatic, workflow_id: 9 }, jobs, mac, ['cpu'], policy, 'JimLiu/baocut'), /workflow/);
  assert.throws(() => validateCandidate({ ...automatic, event: 'pull_request' }, jobs, mac, ['cpu'], policy, 'JimLiu/baocut'), /workflow/);
  assert.throws(() => validateCandidate(automatic, jobs.filter((job) => !job.name.includes('cuda')), mac, ['cpu', 'cuda', 'vulkan'], policy, 'JimLiu/baocut'), /Native validation/);
});

async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'baocut-win-release-test-'));
  const stem = 'BaoCut-3.0.0-build.60-win-x64';
  const installer = { file: `${stem}-setup.exe`, format: 'exe' };
  const portable = { file: `${stem}.zip`, format: 'zip' };
  for (const facts of [installer, portable]) {
    writeFileSync(path.join(directory, facts.file), 'candidate-bytes');
    facts.size = 15;
    facts.sha256 = await fileHash(path.join(directory, facts.file));
  }
  const feed = 'appcast-x86_64-pc-windows-msvc.json';
  const report = { schema: 1, version: '3.0.0', build: 60, appId: 'com.baocut.app', target: 'x86_64-pc-windows-msvc', variant: 'cpu', unsigned: true, installer, portable, feed };
  const manifest = { schema: 1, version: '3.0.0', build: 60, target: report.target, variant: 'cpu', notes: 'Caption fixes.', app: { url: `https://github.com/jimliu/baocut/releases/download/baocut-v3.0.0-build.60/${installer.file}`, format: 'exe', size: installer.size, sha256: installer.sha256 } };
  writeFileSync(path.join(directory, `${stem}-release.json`), JSON.stringify(report));
  writeFileSync(path.join(directory, feed), JSON.stringify(manifest));
  return { directory, report, manifest, stem };
}

test('checks actual candidate bytes and rejects a modified installer', async () => {
  const f = await fixture();
  try {
    await validatePackage(f.directory, mac, 'baocut-v3.0.0-build.60', 'cpu', 'JimLiu/baocut', run);
    await assert.rejects(validatePackage(f.directory, mac, 'baocut-v3.0.0-build.60', 'cpu', 'JimLiu/baocut', { ...run, head_sha: 'b'.repeat(40) }), /source differs/);
    writeFileSync(path.join(f.directory, f.report.installer.file), 'different-bytes');
    await assert.rejects(validatePackage(f.directory, mac, 'baocut-v3.0.0-build.60', 'cpu', 'JimLiu/baocut'), /checksum differs/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('Windows publication rejects a candidate with missing update notes', async () => {
  const f = await fixture();
  try {
    delete f.manifest.notes;
    writeFileSync(path.join(f.directory, f.report.feed), JSON.stringify(f.manifest));
    await assert.rejects(validatePackage(f.directory, mac, 'baocut-v3.0.0-build.60', 'cpu', 'JimLiu/baocut', run), /non-empty English notes/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('rejects a wrong release URL, app ID or unsafe artifact filename', async () => {
  const f = await fixture();
  try {
    f.manifest.app.url = f.manifest.app.url.replace('/jimliu/', '/other/');
    writeFileSync(path.join(f.directory, f.report.feed), JSON.stringify(f.manifest));
    await assert.rejects(validatePackage(f.directory, mac, 'baocut-v3.0.0-build.60', 'cpu', 'JimLiu/baocut'), /does not point/);
    f.report.appId = 'com.jimliu.baocut';
    writeFileSync(path.join(f.directory, `${f.stem}-release.json`), JSON.stringify(f.report));
    await assert.rejects(validatePackage(f.directory, mac, 'baocut-v3.0.0-build.60', 'cpu', 'JimLiu/baocut'), /package identity/);
    f.report.appId = 'com.baocut.app';
    f.report.installer.file = '../secret.exe';
    writeFileSync(path.join(f.directory, `${f.stem}-release.json`), JSON.stringify(f.report));
    await assert.rejects(validatePackage(f.directory, mac, 'baocut-v3.0.0-build.60', 'cpu', 'JimLiu/baocut'), /artifact name/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('An optional standalone CLI archive must be checked on the runner and match the feed cli entry', async () => {
  const f = await fixture();
  const tag = 'baocut-v3.0.0-build.60';
  const writeFeed = () => writeFileSync(path.join(f.directory, f.report.feed), JSON.stringify(f.manifest));
  const writeReport = () => writeFileSync(path.join(f.directory, `${f.stem}-release.json`), JSON.stringify(f.report));
  try {
    // A feed cli entry without the archive is refused.
    f.manifest.cli = { format: 'zip', url: 'https://example.com/x.zip', size: 1, sha256: 'e'.repeat(64) };
    writeFeed();
    await assert.rejects(validatePackage(f.directory, mac, tag, 'cpu', 'JimLiu/baocut', run), /does not have/);
    const file = 'BaoCut-CLI-3.0.0-build.60-x86_64-pc-windows-msvc.zip';
    writeFileSync(path.join(f.directory, file), 'test cli contents');
    const sha256 = await fileHash(path.join(f.directory, file));
    f.report.cli = { format: 'zip', file, size: 17, sha256, notarized: false, notarySubmissionId: null, signature: 'none', node: '24.22.1', unpackedBytes: 100, checked: true };
    // The packager writes the URL from the lowercase download base; the repository name compares without case.
    f.manifest.cli = { format: 'zip', url: `https://github.com/jimliu/baocut/releases/download/${tag}/${file}`, size: 17, sha256 };
    writeReport();
    writeFeed();
    const item = await validatePackage(f.directory, mac, tag, 'cpu', 'JimLiu/baocut', run);
    assert.deepEqual(packageArchives(item.report).map((facts) => facts.file), [f.report.installer.file, f.report.portable.file, file]);
    f.manifest.cli.url = f.manifest.cli.url.replace('build.60/', 'build.59/');
    writeFeed();
    await assert.rejects(validatePackage(f.directory, mac, tag, 'cpu', 'JimLiu/baocut', run), /standalone CLI archive/);
    f.manifest.cli.url = f.manifest.cli.url.replace('build.59/', 'build.60/');
    writeFeed();
    f.report.cli.checked = false;
    writeReport();
    await assert.rejects(validatePackage(f.directory, mac, tag, 'cpu', 'JimLiu/baocut', run), /not checked/);
    f.report.cli.checked = true;
    writeReport();
    writeFileSync(path.join(f.directory, file), 'other cli contents');
    await assert.rejects(validatePackage(f.directory, mac, tag, 'cpu', 'JimLiu/baocut', run), /hash or size differs/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('A variant package names its standalone CLI archive with the variant', async () => {
  const f = await fixture();
  try {
    f.report.cli = { format: 'zip', file: 'BaoCut-CLI-3.0.0-build.60-x86_64-pc-windows-msvc.zip', size: 1, sha256: 'e'.repeat(64), checked: true };
    for (const variant of ['cuda']) {
      const stem = `${f.stem}-${variant}`;
      for (const facts of [f.report.installer, f.report.portable]) {
        facts.file = facts.file.replace(f.stem, stem);
        writeFileSync(path.join(f.directory, facts.file), 'candidate-bytes');
      }
      f.report.variant = variant;
      f.report.feed = `appcast-x86_64-pc-windows-msvc-${variant}.json`;
      f.manifest.variant = variant;
      f.manifest.app.url = f.manifest.app.url.replace(f.stem, stem);
      writeFileSync(path.join(f.directory, `${stem}-release.json`), JSON.stringify(f.report));
      writeFileSync(path.join(f.directory, f.report.feed), JSON.stringify(f.manifest));
      await assert.rejects(validatePackage(f.directory, mac, 'baocut-v3.0.0-build.60', variant, 'JimLiu/baocut', run), /Unexpected standalone CLI archive facts/);
    }
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});
