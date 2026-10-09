import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileHash } from './windows-release.mjs';
import { createMacDraft, downloadMacAsset, findMacRelease, publicReport, publishMacDraft, uploadMacAsset, validateMacPackage } from './macos-release.mjs';

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

test('A newly created draft is found without the public-only by-tag endpoint', () => {
  const tag = 'baocut-v3.0.1-build.61';
  const draft = { id: 61, tag_name: tag, draft: true, assets: [] };
  const get = (endpoint) => {
    if (endpoint.includes('/releases/tags/')) throw new Error('404 Not Found');
    assert.equal(endpoint, 'repos/JimLiu/baocut/releases?per_page=100&page=1');
    return [draft, { id: 60, tag_name: 'baocut-v3.0.0-build.60', draft: false }];
  };
  assert.equal(findMacRelease('JimLiu/baocut', tag, get), draft);
  assert.equal(findMacRelease('JimLiu/baocut', 'missing-tag', get), undefined);
});

test('Release lookup can resume an existing draft beyond the first page', () => {
  const tag = 'baocut-v3.1.1-build.63';
  const draft = { id: 63, tag_name: tag, draft: true, assets: [] };
  const endpoints = [];
  const get = (endpoint) => {
    endpoints.push(endpoint);
    return endpoints.length === 1 ? Array.from({ length: 100 }, (_, id) => ({ id, tag_name: `other-${id}` })) : [draft];
  };
  assert.equal(findMacRelease('JimLiu/baocut', tag, get), draft);
  assert.deepEqual(endpoints, ['repos/JimLiu/baocut/releases?per_page=100&page=1', 'repos/JimLiu/baocut/releases?per_page=100&page=2']);
});

test('Creation, upload and publication use the returned ID when draft lookup is stale', () => {
  const repo = 'JimLiu/baocut';
  const tag = 'baocut-v3.1.1-build.63';
  const report = { version: '3.1.1', build: 63, sourceCommit: expected.sourceCommit };
  const draft = { id: 63, tag_name: tag, target_commitish: report.sourceCommit, draft: true, assets: [] };
  let created = false;
  const calls = [];
  const run = (program, args, options = {}) => {
    assert.equal(program, 'gh');
    // No by-tag lookup or second release-list request may be needed after creation.
    assert.equal(args[0], 'api');
    calls.push({ args, input: options.input && JSON.parse(options.input) });
    if (args[1] === `repos/${repo}/releases`) { created = true; return JSON.stringify(draft); }
    assert.ok(created);
    return '{}';
  };
  assert.equal(findMacRelease(repo, tag, () => []), undefined);
  const release = createMacDraft(repo, tag, report, 'Line one\n\nLine two', run);
  // The list still omits the draft, but the create response lets publication continue.
  assert.equal(findMacRelease(repo, tag, () => []), undefined);
  const file = '/tmp/BaoCut test+archive.zip';
  uploadMacAsset(repo, release.id, file, run);
  publishMacDraft(repo, release.id, run);
  assert.deepEqual(calls, [
    { args: ['api', `repos/${repo}/releases`, '--method', 'POST', '--input', '-'], input: {
      tag_name: tag, target_commitish: report.sourceCommit, name: 'BaoCut 3.1.1 (Build 63) — macOS',
      body: 'Line one\n\nLine two', draft: true, prerelease: false, make_latest: 'false',
    } },
    { args: ['api', `https://uploads.github.com/repos/${repo}/releases/63/assets?name=BaoCut%20test%2Barchive.zip`,
      '--method', 'POST', '--header', 'Content-Type: application/octet-stream', '--input', file], input: undefined },
    { args: ['api', `repos/${repo}/releases/63`, '--method', 'PATCH', '--input', '-'], input: { draft: false, make_latest: 'false' } },
  ]);
});

test('Creation rejects a malformed or mismatched API response and preserves API errors', () => {
  const tag = 'baocut-v3.1.1-build.63';
  const report = { version: '3.1.1', build: 63, sourceCommit: expected.sourceCommit };
  const draft = { id: 63, tag_name: tag, target_commitish: report.sourceCommit, draft: true, assets: [] };
  for (const change of [{ id: undefined }, { id: -1 }, { tag_name: 'other' }, { target_commitish: 'main' }, { draft: false }, { assets: null }]) {
    assert.throws(() => createMacDraft('JimLiu/baocut', tag, report, '', () => JSON.stringify({ ...draft, ...change })), /identity differs/);
  }
  const failure = new Error('HTTP 422: release already exists');
  assert.throws(() => createMacDraft('JimLiu/baocut', tag, report, '', () => { throw failure; }), (error) => error === failure);
});

test('Existing draft assets download by asset ID as binary streams and close on failure', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'baocut-mac-asset-test-'));
  const file = path.join(directory, 'existing.zip');
  const bytes = Buffer.from([0, 255, 128, 13, 10]);
  let descriptor;
  const run = (program, args, options) => {
    assert.equal(program, 'gh');
    assert.deepEqual(args, ['api', 'repos/JimLiu/baocut/releases/assets/123', '--header', 'Accept: application/octet-stream']);
    descriptor = options.stdio[1];
    writeSync(descriptor, bytes);
  };
  try {
    downloadMacAsset('JimLiu/baocut', 123, file, run);
    assert.deepEqual(readFileSync(file), bytes);
    assert.throws(() => writeSync(descriptor, bytes), { code: 'EBADF' });
    assert.throws(() => downloadMacAsset('JimLiu/baocut', 123, path.join(directory, 'failed.zip'), (...args) => {
      run(...args);
      throw new Error('Download failed');
    }), /Download failed/);
    assert.throws(() => writeSync(descriptor, bytes), { code: 'EBADF' });
  } finally { rmSync(directory, { recursive: true }); }
});
