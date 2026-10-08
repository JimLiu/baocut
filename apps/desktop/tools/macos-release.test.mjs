import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileHash } from './windows-release.mjs';
import { publicReport, validateMacPackage } from './macos-release.mjs';

const expected = { sourceCommit: 'a'.repeat(40), signingSha1: 'C'.repeat(40) };
async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'baocut-mac-release-test-'));
  const report = { schema: 1, product: 'BaoCut', appId: 'com.baocut.app', version: '3.0.0', build: 61,
    target: 'aarch64-apple-darwin', ...expected, notarized: true, unsigned: false,
    notarySubmissionId: 'b'.repeat(36), dmgNotarySubmissionId: 'c'.repeat(36) };
  for (const [kind, format] of [['portable', 'zip'], ['installer', 'dmg']]) {
    const file = `BaoCut-3.0.0-build.61-aarch64-apple-darwin.${format}`;
    const bytes = Buffer.from(`test ${format} contents`);
    writeFileSync(path.join(directory, file), bytes);
    const sha256 = await fileHash(path.join(directory, file));
    report[kind] = { format, file, size: bytes.length, sha256 };
    writeFileSync(path.join(directory, `${file}.sha256`), `${sha256}  ${file}\n`);
  }
  const feed = { schema: 1, target: report.target, version: report.version, build: report.build, date: '2026-10-08', notes: '', notesLocalized: {},
    app: { format: 'zip', url: `https://github.com/jimliu/baocut/releases/download/baocut-v3.0.0-build.61/${report.portable.file}`,
      size: report.portable.size, sha256: report.portable.sha256 } };
  writeFileSync(path.join(directory, 'app-release.json'), JSON.stringify(report));
  writeFileSync(path.join(directory, 'appcast-aarch64-apple-darwin.json'), JSON.stringify(feed));
  return { directory, report, feed };
}

test('Mac publication rejects tampered archives, checksum files and update URLs', async () => {
  const { directory, report, feed } = await fixture();
  try {
    assert.equal((await validateMacPackage(directory, expected)).tag, 'baocut-v3.0.0-build.61');
    const file = path.join(directory, report.portable.file);
    const original = readFileSync(file);
    writeFileSync(file, Buffer.alloc(original.length));
    await assert.rejects(validateMacPackage(directory, expected), /hash or size/);
    writeFileSync(file, original);
    writeFileSync(`${file}.sha256`, 'incorrect\n');
    await assert.rejects(validateMacPackage(directory, expected), /checksum file/);
    writeFileSync(`${file}.sha256`, `${report.portable.sha256}  ${report.portable.file}\n`);
    feed.app.url = feed.app.url.replace('baocut-v3.0.0-build.61', 'baocut-v3.0.0-build.60');
    writeFileSync(path.join(directory, 'appcast-aarch64-apple-darwin.json'), JSON.stringify(feed));
    await assert.rejects(validateMacPackage(directory, expected), /another release/);
  } finally { rmSync(directory, { recursive: true }); }
});

test('Mac publication requires matching signer/source, notarization and safe artifact names', async () => {
  for (const mutate of [
    (r) => { r.signingSha1 = 'D'.repeat(40); },
    (r) => { r.sourceCommit = 'd'.repeat(40); },
    (r) => { r.notarized = false; },
    (r) => { r.installer.file = '../outside.dmg'; },
    (r) => { r.target = 'x86_64-pc-windows-msvc'; },
  ]) {
    const { directory, report } = await fixture();
    try {
      mutate(report);
      writeFileSync(path.join(directory, 'app-release.json'), JSON.stringify(report));
      await assert.rejects(validateMacPackage(directory, expected));
    } finally { rmSync(directory, { recursive: true }); }
  }
});

test('Public report excludes local extraction paths and unexpected credential fields', async () => {
  const { directory, report } = await fixture();
  try {
    const clean = publicReport({ ...report, verifiedApp: '/private/local/path', credentials: 'private test data',
      portable: { ...report.portable, privateKey: 'private test data' } });
    assert.equal(clean.verifiedApp, undefined);
    assert.equal(clean.credentials, undefined);
    assert.equal(clean.portable.privateKey, undefined);
    assert.deepEqual(clean.installer, report.installer);
  } finally { rmSync(directory, { recursive: true }); }
});
