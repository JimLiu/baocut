import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { archiveLocalMac, ignoreMacSigningFile, macSigningOptions, runMac } from './macos-distribution.mjs';

test('bundle signing defers the main executable until its sibling CLI is signed', { skip: process.platform !== 'darwin' }, async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'baocut-sign-order-')));
  const app = path.join(root, 'BaoCut.app');
  try {
    mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
    writeFileSync(path.join(root, 'main.c'), 'int main(void) { return 0; }\n');
    writeFileSync(path.join(app, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict>
      <key>CFBundleExecutable</key><string>BaoCut</string><key>CFBundleIdentifier</key><string>com.baocut.sign-test</string>
      <key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string>
      <key>CFBundleShortVersionString</key><string>1.0.0</string></dict></plist>`);
    for (const name of ['BaoCut', 'baocut-cli']) {
      // Apple Silicon's linker signs by default; this regression needs unsigned siblings.
      execFileSync('clang', [path.join(root, 'main.c'), '-Wl,-no_adhoc_codesign', '-o', path.join(app, 'Contents/MacOS', name)]);
    }
    const { signAsync } = await import('@electron/osx-sign');
    const entitlements = path.resolve(import.meta.dirname, '../build/entitlements.mac.plist');
    const options = { app, platform: 'darwin', identity: '-', identityValidation: false,
      preAutoEntitlements: false, preEmbedProvisioningProfile: false,
      optionsForFile: (file) => macSigningOptions(file, { app, entitlements, local: true }) };
    const main = path.join(app, 'Contents/MacOS/BaoCut');
    await assert.rejects(signAsync({ ...options, ignore: [(file) => file === main ? false : ignoreMacSigningFile(file, app)] }), /baocut-cli/);
    await signAsync({ ...options, ignore: (file) => ignoreMacSigningFile(file, app) });
    execFileSync('codesign', ['--verify', '--deep', '--strict', app]);
    execFileSync(path.join(app, 'Contents/MacOS/baocut-cli'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const lostConnection = 'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."\nThe validate action failed! Error 68.';

test('stapler validation recovers from the observed Apple connection loss without leaking arguments', () => {
  const calls = [], waits = [], warnings = [];
  const args = ['stapler', 'validate', '/private/fixture/BaoCut.app'];
  const output = runMac('xcrun', args, {
    spawn: (command, actualArgs, options) => {
      calls.push({ command, args: actualArgs, options });
      return calls.length === 1 ? { status: 68, stdout: lostConnection, stderr: 'warning\n' }
        : { status: 0, stdout: 'The validate action worked!\n', stderr: '' };
    },
    sleep: (ms) => waits.push(ms), warn: (message) => warnings.push(message),
  });
  assert.equal(output, 'The validate action worked!\n');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(waits, [2000]);
  assert.match(warnings[0], /stapler validate.*attempt 2\/5/);
  assert.ok(!warnings[0].includes('/private/fixture'));
});

test('stapler attachment retries timeouts and connection loss with increasing delays', () => {
  let calls = 0;
  const waits = [];
  assert.equal(runMac('xcrun', ['stapler', 'staple', '/fixture/BaoCut.dmg'], {
    spawn: () => ++calls === 3 ? { status: 0, stdout: 'stapled', stderr: '' }
      : { status: 68, stdout: '', stderr: calls === 1 ? 'NSURLErrorDomain Code=-1001 "timeout"' : lostConnection },
    sleep: (ms) => waits.push(ms), warn: () => {},
  }), 'stapled');
  assert.deepEqual(waits, [2000, 5000]);
});

test('persistent Apple network errors still fail after five attempts with the last diagnostics', () => {
  let calls = 0;
  const waits = [];
  assert.throws(() => runMac('xcrun', ['stapler', 'validate', '/fixture/BaoCut.app'], {
    spawn: () => ({ status: 68, stdout: `failure ${++calls}\n`, stderr: lostConnection }),
    sleep: (ms) => waits.push(ms), warn: () => {},
  }), /after 5 attempts: failure 5/);
  assert.equal(calls, 5);
  assert.deepEqual(waits, [2000, 5000, 10000, 20000]);
});

test('invalid tickets, signature rejection and notarization submission failures are not retried', () => {
  for (const [command, args, status, stderr] of [
    ['xcrun', ['stapler', 'validate', '/fixture/BaoCut.app'], 68, 'The ticket is invalid. Error 68.'],
    ['xcrun', ['stapler', 'validate', '/fixture/BaoCut.app'], 65, lostConnection],
    ['xcrun', ['stapler', 'staple', '/fixture/BaoCut.dmg'], 68, 'NSURLErrorDomain Code=-1202 "untrusted certificate"'],
    ['xcrun', ['notarytool', 'submit', '/fixture/submission.zip'], 68, lostConnection],
    ['codesign', ['--verify', '/fixture/BaoCut.app'], 68, lostConnection],
    ['spctl', ['--assess', '/fixture/BaoCut.app'], 68, lostConnection],
  ]) {
    let calls = 0;
    assert.throws(() => runMac(command, args, {
      spawn: () => { calls++; return { status, stdout: '', stderr }; },
      sleep: () => assert.fail('must not wait'), warn: () => assert.fail('must not retry'),
    }));
    assert.equal(calls, 1);
  }
});

test('command launch errors remain fatal and successful output is unchanged', () => {
  const error = new Error('spawn ENOENT');
  assert.throws(() => runMac('xcrun', ['stapler', 'validate', '/fixture/BaoCut.app'], {
    spawn: () => ({ error, status: null }),
    sleep: () => assert.fail('must not wait'), warn: () => assert.fail('must not retry'),
  }), (actual) => actual === error);
  assert.equal(runMac('codesign', ['-d'], {
    spawn: () => ({ status: 0, stdout: 'out', stderr: 'err' }),
  }), 'outerr');
});

test('local archives verify the extracted bundle and disk image and record checksums without notarization', async () => {
  const output = mkdtempSync(path.join(tmpdir(), 'baocut-local-mac-test-'));
  const calls = [];
  const info = { CFBundleIdentifier: 'com.baocut.app', CFBundleShortVersionString: '3.3.0', CFBundleVersion: '0' };
  const run = (command, args) => {
    calls.push({ command, args });
    if (command === 'plutil') return JSON.stringify(info);
    if (command === 'ditto' && args[0] === '-c') writeFileSync(args.at(-1), 'zip fixture');
    if (command === 'hdiutil' && args[0] === 'create') writeFileSync(args.at(-1), 'dmg fixture');
    return '';
  };
  try {
    const report = await archiveLocalMac({ app: path.join(output, 'mac/BaoCut.app'), output,
      stem: 'BaoCut-3.3.0-x86_64-apple-darwin-local', version: '3.3.0', build: 0, appId: 'com.baocut.app' }, run);
    assert.equal(report.local, true);
    assert.equal(report.notarized, false);
    assert.equal(report.signature, 'ad-hoc');
    const verified = calls.filter((c) => c.command === 'codesign');
    assert.equal(verified.length, 2);
    assert.equal(verified[1].args.at(-1), report.verifiedApp);
    assert.ok(calls.some((c) => c.command === 'hdiutil' && c.args[0] === 'verify'));
    assert.ok(!calls.some((c) => c.command === 'xcrun' || c.command === 'spctl'));
    for (const item of [report.portable, report.installer]) {
      assert.match(item.sha256, /^[a-f0-9]{64}$/);
      assert.equal(item.size, readFileSync(path.join(output, item.file)).length);
      assert.equal(readFileSync(path.join(output, `${item.file}.sha256`), 'utf8'), `${item.sha256}  ${item.file}\n`);
    }
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test('local archives reject a mismatched bundle before making an archive', async () => {
  const output = mkdtempSync(path.join(tmpdir(), 'baocut-local-mac-reject-'));
  try {
    await assert.rejects(archiveLocalMac({ app: '/fixture/BaoCut.app', output, stem: 'fixture',
      version: '3.3.0', build: 0, appId: 'com.baocut.app' }, (command) => {
      assert.equal(command, 'plutil');
      return JSON.stringify({ CFBundleIdentifier: 'another.app' });
    }), /bundle ID, version or build differs/);
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test('only the packaged model-worker can load separately signed runtime libraries', async () => {
  const { macSigningOptions } = await import('./macos-distribution.mjs');
  const app = '/fixture/BaoCut.app';
  const entitlements = path.resolve(import.meta.dirname, '../build/entitlements.mac.plist');
  const options = { app, entitlements };
  const worker = macSigningOptions(`${app}/Contents/Resources/bin/model-worker`, options);
  assert.equal(worker.hardenedRuntime, true);
  assert.match(readFileSync(worker.entitlements, 'utf8'), /<key>com.apple.security.cs.disable-library-validation<\/key><true\/>/);
  for (const file of [app, `${app}/Contents/MacOS/BaoCut`, `${app}/Contents/Resources/bin/engine-host`,
    `${app}/Contents/Frameworks/BaoCut Helper.app`, '/another/model-worker']) {
    const ordinary = macSigningOptions(file, options);
    assert.equal(ordinary.entitlements, entitlements);
    assert.equal(ordinary.hardenedRuntime, true);
    assert.doesNotMatch(readFileSync(ordinary.entitlements, 'utf8'), /disable-library-validation/);
  }
  assert.deepEqual(macSigningOptions(`${app}/Contents/Resources/bin/model-worker`, { ...options, local: true }),
    { entitlements: worker.entitlements, hardenedRuntime: false, timestamp: 'none' });
});

test('release verification rejects the observed model-worker signature even if startup works', async () => {
  const { verifyModelWorkerSignature } = await import('./macos-distribution.mjs');
  const current = readFileSync(path.resolve(import.meta.dirname, '../build/entitlements.model-worker.mac.plist'), 'utf8');
  const old = readFileSync(path.resolve(import.meta.dirname, '../build/entitlements.mac.plist'), 'utf8');
  for (const app of ['/fixture/BaoCut.app', '/fixture/verified-extraction/BaoCut.app']) {
    const check = (plist, details = 'flags=0x10000(runtime)') => verifyModelWorkerSignature(app, (command, args) => {
      assert.equal(command, 'codesign');
      assert.equal(args.at(-1), `${app}/Contents/Resources/bin/model-worker`);
      if (args.includes('--entitlements')) assert.ok(args.includes('--xml'), 'modern codesign defaults to an abstract representation');
      return args.includes('--entitlements') ? plist : details;
    });
    assert.doesNotThrow(() => check(current));
    assert.throws(() => check(old), /missing disable-library-validation/);
    assert.throws(() => check(current.replace('<true/>', '<false/>').replace('<true/>', '<false/>')), /missing disable-library-validation/);
    assert.throws(() => check(current, 'flags=0x0(none)'), /missing hardened runtime/);
  }
});
