import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileHash, validateCandidate, validatePackage } from './windows-release.mjs';

const source = 'a'.repeat(40);
const mac = { version: '3.0.0', build: 60, sourceCommit: source };
const run = { status: 'completed', workflow_id: 7, event: 'workflow_dispatch', head_sha: source, head_repository: { full_name: 'JimLiu/baocut' } };

test('requires native validation for every selected variant and the frozen Mac source', () => {
  const jobs = [{ name: 'Package Windows x64 (cpu)', conclusion: 'success' }, { name: 'Package Windows x64 (cuda)', conclusion: 'failure' }];
  validateCandidate(run, jobs, mac, ['cpu'], 7, 'JimLiu/baocut');
  assert.throws(() => validateCandidate(run, jobs, mac, ['cpu', 'cuda'], 7, 'JimLiu/baocut'), /Native validation/);
  assert.throws(() => validateCandidate({ ...run, head_sha: 'b'.repeat(40) }, jobs, mac, ['cpu'], 7, 'JimLiu/baocut'), /source differs/);
  assert.throws(() => validateCandidate({ ...run, event: 'pull_request' }, jobs, mac, ['cpu'], 7, 'JimLiu/baocut'), /workflow/);
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
  const manifest = { schema: 1, version: '3.0.0', build: 60, target: report.target, variant: 'cpu', app: { url: `https://github.com/jimliu/baocut/releases/download/baocut-v3.0.0-build.60/${installer.file}`, format: 'exe', size: installer.size, sha256: installer.sha256 } };
  writeFileSync(path.join(directory, `${stem}-release.json`), JSON.stringify(report));
  writeFileSync(path.join(directory, feed), JSON.stringify(manifest));
  return { directory, report, manifest, stem };
}

test('checks actual candidate bytes and rejects a modified installer', async () => {
  const f = await fixture();
  try {
    await validatePackage(f.directory, mac, 'baocut-v3.0.0-build.60', 'cpu', 'JimLiu/baocut');
    writeFileSync(path.join(f.directory, f.report.installer.file), 'different-bytes');
    await assert.rejects(validatePackage(f.directory, mac, 'baocut-v3.0.0-build.60', 'cpu', 'JimLiu/baocut'), /checksum differs/);
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
